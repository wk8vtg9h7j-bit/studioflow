// ============================================================================
// Per-studio Google Calendar sync service. Each studio owns one Google Calendar
// (studios.google_calendar_id) authorized by a stored, encrypted refresh token
// (studios.google_refresh_token). This module:
//   1. builds an authed Calendar client for a studio from that refresh token,
//   2. mirrors a session to the studio's calendar (create / update / delete),
//      keyed by sessions.google_event_id, and
//   3. records every attempt in google_sync_log and stamps
//      studios.google_last_synced_at.
//
// All DB access here uses the service-role client: sync runs from route
// handlers / cron with no user session, and must read the encrypted token and
// write event ids regardless of RLS.
// ============================================================================
import { calendar_v3, google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { createServiceClient } from "@/lib/supabase/server";
import { createOAuthClient } from "./oauth";
import { decryptToken } from "./crypto";
import type { Session, Studio } from "@/lib/types";

// The studio fields the sync needs. Callers may pass a full Studio row or just
// this subset (e.g. the connect callback before the row is fully hydrated).
type StudioForSync = Pick<
  Studio,
  | "id"
  | "name"
  | "timezone"
  | "google_calendar_id"
  | "google_refresh_token"
  | "google_token_status"
  | "google_account_email"
>;

// The session fields needed to render a calendar event.
type SessionForSync = Pick<
  Session,
  | "id"
  | "title"
  | "starts_at"
  | "ends_at"
  | "room"
  | "notes"
  | "status"
  | "google_event_id"
  | "filler_seats"
>;

export class StudioNotConnectedError extends Error {
  constructor(studioId: string) {
    super(`Studio ${studioId} is not connected to Google Calendar`);
    this.name = "StudioNotConnectedError";
  }
}

// Build an OAuth2 client primed with the studio's refresh token. googleapis
// transparently exchanges it for a short-lived access token on the first API
// call, so we don't pre-fetch one here.
export function authedClientForStudio(studio: StudioForSync): OAuth2Client {
  if (!studio.google_refresh_token) {
    throw new StudioNotConnectedError(studio.id);
  }
  const client = createOAuthClient();
  client.setCredentials({
    refresh_token: decryptToken(studio.google_refresh_token),
  });
  return client;
}

export function calendarForStudio(
  studio: StudioForSync,
): calendar_v3.Calendar {
  const auth = authedClientForStudio(studio);
  return google.calendar({ version: "v3", auth });
}

// Map a session onto the Google event body. Times are stored UTC (ISO) and we
// hand Google the studio's IANA timezone so the event lands at the right local
// wall-clock time on the studio's calendar.
function eventBody(
  studio: StudioForSync,
  session: SessionForSync,
): calendar_v3.Schema$Event {
  const baseSummary = session.title?.trim() || `${studio.name} class`;
  const isFilled = (session.filler_seats ?? 0) > 0;
  const summary = isFilled ? `FILLED · ${baseSummary}` : baseSummary;
  const descriptionParts: string[] = [];
  if (session.room) descriptionParts.push(`Room: ${session.room}`);
  if (session.notes) descriptionParts.push(session.notes);
  if (isFilled) {
    descriptionParts.push(
      `Filled by: ${studio.google_account_email ?? "info@rechargeddanang.com"}`,
    );
    descriptionParts.push(`Held seats: ${session.filler_seats}`);
  }
  descriptionParts.push(`StudioFlow session ${session.id}`);

  return {
    summary,
    description: descriptionParts.join("\n"),
    start: { dateTime: session.starts_at, timeZone: studio.timezone },
    end: { dateTime: session.ends_at, timeZone: studio.timezone },
    // A stable extended property lets us re-link an event to its session even
    // if google_event_id were ever lost.
    extendedProperties: {
      private: { studioflow_session_id: session.id },
    },
  };
}

// Append a row to google_sync_log. Best-effort: a logging failure must never
// mask the real sync result.
async function logSync(
  studioId: string,
  sessionId: string | null,
  action: string,
  ok: boolean,
  message: string | null,
): Promise<void> {
  try {
    const service = createServiceClient();
    await service.from("google_sync_log").insert({
      studio_id: studioId,
      session_id: sessionId,
      action,
      ok,
      message,
    });
  } catch {
    // swallow — logging is auxiliary
  }
}

async function stampSynced(studioId: string): Promise<void> {
  const service = createServiceClient();
  await service
    .from("studios")
    .update({ google_last_synced_at: new Date().toISOString() })
    .eq("id", studioId);
}

export type SyncResult = {
  ok: boolean;
  action: "create" | "update" | "delete" | "skip";
  eventId: string | null;
  message: string | null;
};

// Push a single session to the studio's calendar. Decides create/update/delete
// from the session status and whether we already hold a google_event_id:
//   - cancelled session with an event  -> delete the event, clear the id
//   - scheduled/completed, no event id  -> create, store the new id
//   - scheduled/completed, has event id -> update in place
// Writes google_sync_log and (on success) stamps google_last_synced_at.
export async function syncSessionToStudio(
  studio: StudioForSync,
  session: SessionForSync,
): Promise<SyncResult> {
  if (
    studio.google_token_status !== "connected" ||
    !studio.google_refresh_token ||
    !studio.google_calendar_id
  ) {
    return {
      ok: false,
      action: "skip",
      eventId: session.google_event_id,
      message: "studio not connected",
    };
  }

  const calendarId = studio.google_calendar_id;
  const service = createServiceClient();

  try {
    const calendar = calendarForStudio(studio);
    const isCancelled =
      session.status === "cancelled" || session.status === "completed";

    // Cancelled/completed: remove the mirrored event if one exists.
    if (isCancelled) {
      if (!session.google_event_id) {
        return { ok: true, action: "skip", eventId: null, message: null };
      }
      await calendar.events.delete({
        calendarId,
        eventId: session.google_event_id,
      });
      await service
        .from("sessions")
        .update({ google_event_id: null })
        .eq("id", session.id);
      await logSync(studio.id, session.id, "delete", true, null);
      await stampSynced(studio.id);
      return { ok: true, action: "delete", eventId: null, message: null };
    }

    // Update an existing event in place.
    if (session.google_event_id) {
      const res = await calendar.events.update({
        calendarId,
        eventId: session.google_event_id,
        requestBody: eventBody(studio, session),
      });
      await logSync(studio.id, session.id, "update", true, null);
      await stampSynced(studio.id);
      return {
        ok: true,
        action: "update",
        eventId: res.data.id ?? session.google_event_id,
        message: null,
      };
    }

    // Create a new event and persist its id back on the session.
    const res = await calendar.events.insert({
      calendarId,
      requestBody: eventBody(studio, session),
    });
    const eventId = res.data.id ?? null;
    if (eventId) {
      await service
        .from("sessions")
        .update({ google_event_id: eventId })
        .eq("id", session.id);
    }
    await logSync(studio.id, session.id, "create", true, null);
    await stampSynced(studio.id);
    return { ok: true, action: "create", eventId, message: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown sync error";
    await logSync(studio.id, session.id, "error", false, message);
    return {
      ok: false,
      action: "skip",
      eventId: session.google_event_id,
      message,
    };
  }
}

// Convenience: load a studio + session by id (service client) and sync. Used by
// the booking/session mutation paths and the cron endpoint.
export async function syncSessionById(sessionId: string): Promise<SyncResult> {
  const service = createServiceClient();
  const { data: session } = await service
    .from("sessions")
    .select(
      "id,title,starts_at,ends_at,room,notes,status,google_event_id,studio_id,filler_seats",
    )
    .eq("id", sessionId)
    .single();

  if (!session) {
    return { ok: false, action: "skip", eventId: null, message: "no session" };
  }

  const { data: studio } = await service
    .from("studios")
    .select(
      "id,name,timezone,google_calendar_id,google_refresh_token,google_token_status,google_account_email",
    )
    .eq("id", (session as { studio_id: string }).studio_id)
    .single();

  if (!studio) {
    return { ok: false, action: "skip", eventId: null, message: "no studio" };
  }

  return syncSessionToStudio(
    studio as StudioForSync,
    session as SessionForSync,
  );
}
