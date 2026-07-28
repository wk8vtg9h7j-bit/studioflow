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
export type StudioForSync = Pick<
  Studio,
  | "id"
  | "name"
  | "timezone"
  | "google_calendar_id"
  | "google_refresh_token"
  | "google_token_status"
>;

// The session fields needed to render a calendar event.
type SessionForSync = Pick<
  Session,
  | "id"
  | "title"
  | "starts_at"
  | "ends_at"
  | "capacity"
  | "room"
  | "notes"
  | "status"
  | "google_event_id"
>;

// One attendee: the booking id (so we can key its calendar block), the display
// name, and when the seat was booked.
type RosterEntry = {
  id: string;
  name: string;
  booked_at: string | null;
};

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

// Format a booking timestamp in the studio's local timezone for the roster
// lines. Best-effort: on any parse issue fall back to the raw ISO string.
function formatBookedAt(iso: string | null, timezone: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// Google Calendar events use a fixed palette keyed by colorId "1".."11"
// (Lavender, Sage, Grape, Flamingo, Banana, Tangerine, Peacock, Graphite,
// Blueberry, Basil, Tomato) — arbitrary hex is not accepted. To give each class
// at each studio its own colour, we hash a stable key (studio id + class title)
// onto the palette. The same class at the same studio always resolves to the
// same colour; different classes/studios land on visually distinct colours.
// Graphite (8) is skipped as it reads as a dull "no colour" grey.
const EVENT_COLOR_IDS = ["1", "2", "3", "4", "5", "6", "7", "9", "10", "11"];

function colorIdForSession(
  studio: StudioForSync,
  session: SessionForSync,
): string {
  const key = `${studio.id}|${session.title?.trim() ?? ""}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return EVENT_COLOR_IDS[hash % EVENT_COLOR_IDS.length];
}

// Map ONE booking onto a Google event body — Acuity-style, one block per
// person. Times are stored UTC (ISO) and we hand Google the studio's IANA
// timezone so the event lands at the right local wall-clock time. The event is
// titled "{Name}: {Class}" and carries both the session id and the booking id
// in extended properties so we can reconcile per-attendee blocks precisely.
function bookingEventBody(
  studio: StudioForSync,
  session: SessionForSync,
  entry: RosterEntry,
): calendar_v3.Schema$Event {
  const className = session.title?.trim() || `${studio.name} class`;
  const summary = `${entry.name}: ${className}`;
  const location = session.room ? `${studio.name} — ${session.room}` : studio.name;

  const descriptionParts: string[] = [];
  descriptionParts.push(className);
  if (session.room) descriptionParts.push(`Room: ${session.room}`);
  const when = formatBookedAt(entry.booked_at, studio.timezone);
  if (when) descriptionParts.push(`Booked ${when}`);
  if (session.notes) {
    descriptionParts.push("");
    descriptionParts.push(session.notes);
  }
  descriptionParts.push("");
  descriptionParts.push(`StudioFlow session ${session.id}`);

  return {
    summary,
    location,
    description: descriptionParts.join("\n"),
    colorId: colorIdForSession(studio, session),
    start: { dateTime: session.starts_at, timeZone: studio.timezone },
    end: { dateTime: session.ends_at, timeZone: studio.timezone },
    // Stable extended properties let us re-link each attendee block to its
    // session and booking even if we hold no direct id on the row.
    extendedProperties: {
      private: {
        studioflow_session_id: session.id,
        studioflow_booking_id: entry.id,
      },
    },
  };
}

// Load the active roster for a session: everyone currently holding a seat
// (booked or already attended), oldest booking first, resolving each display
// name from the walk-in customers.name or the member's profile full_name.
// Read-only — never mutates bookings.
async function loadRoster(sessionId: string): Promise<RosterEntry[]> {
  try {
    const service = createServiceClient();
    const { data } = await service
      .from("bookings")
      .select(
        "id,booked_at,status,customer:customers(name,profile:profiles(full_name))",
      )
      .eq("session_id", sessionId)
      .in("status", ["booked", "attended"])
      .order("booked_at", { ascending: true });

    type Row = {
      id: string;
      booked_at: string | null;
      customer: {
        name: string | null;
        profile: { full_name: string | null } | null;
      } | null;
    };

    return ((data ?? []) as unknown as Row[]).map((row) => {
      const c = row.customer;
      const name =
        c?.name?.trim() || c?.profile?.full_name?.trim() || "Member";
      return { id: row.id, name, booked_at: row.booked_at };
    });
  } catch {
    // Roster is a display nicety — never let it block the sync.
    return [];
  }
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

// Push a single session to the studio's calendar as ONE event per booking
// (Acuity-style, a block per attendee). Reconciles the live roster against the
// events already on the calendar for this session:
//   - list existing blocks by the session's extended property
//   - delete any legacy session-level block (no booking id) and clear the id
//   - cancelled/completed session  -> delete every mirrored block
//   - otherwise, per active booking -> update in place or insert
//   - delete blocks whose booking is no longer active
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

    // Every event we've ever mirrored for this session carries
    // studioflow_session_id. Fetch them so we can reconcile precisely.
    const existing = await calendar.events.list({
      calendarId,
      privateExtendedProperty: [`studioflow_session_id=${session.id}`],
      singleEvents: true,
      showDeleted: false,
      maxResults: 250,
    });

    const eventsByBooking = new Map<string, calendar_v3.Schema$Event>();
    const legacyEvents: calendar_v3.Schema$Event[] = [];
    for (const ev of existing.data.items ?? []) {
      const bookingId = ev.extendedProperties?.private?.studioflow_booking_id;
      if (bookingId) eventsByBooking.set(bookingId, ev);
      else legacyEvents.push(ev);
    }

    // Remove any old one-event-per-session block; clear the stale id on the row.
    for (const ev of legacyEvents) {
      if (ev.id) {
        await calendar.events.delete({ calendarId, eventId: ev.id });
      }
    }
    if (session.google_event_id) {
      await service
        .from("sessions")
        .update({ google_event_id: null })
        .eq("id", session.id);
    }

    // Cancelled/completed: remove every mirrored attendee block.
    if (isCancelled) {
      for (const ev of eventsByBooking.values()) {
        if (ev.id) await calendar.events.delete({ calendarId, eventId: ev.id });
      }
      await logSync(studio.id, session.id, "delete", true, "session closed");
      await stampSynced(studio.id);
      return { ok: true, action: "delete", eventId: null, message: null };
    }

    // Reconcile the live roster against existing blocks. Each booking gets its
    // own event; when a booking is cancelled its block is removed.
    const roster = await loadRoster(session.id);
    const activeIds = new Set(roster.map((entry) => entry.id));

    for (const entry of roster) {
      const found = eventsByBooking.get(entry.id);
      if (found?.id) {
        await calendar.events.update({
          calendarId,
          eventId: found.id,
          requestBody: bookingEventBody(studio, session, entry),
        });
      } else {
        await calendar.events.insert({
          calendarId,
          requestBody: bookingEventBody(studio, session, entry),
        });
      }
    }

    // Drop blocks whose booking is no longer active.
    for (const [bookingId, ev] of eventsByBooking) {
      if (!activeIds.has(bookingId) && ev.id) {
        await calendar.events.delete({ calendarId, eventId: ev.id });
      }
    }

    await logSync(
      studio.id,
      session.id,
      "update",
      true,
      `${roster.length} bookings`,
    );
    await stampSynced(studio.id);
    return {
      ok: true,
      action: roster.length > 0 ? "update" : "delete",
      eventId: null,
      message: null,
    };
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
      "id,title,starts_at,ends_at,capacity,room,notes,status,google_event_id,studio_id",
    )
    .eq("id", sessionId)
    .single();

  if (!session) {
    return { ok: false, action: "skip", eventId: null, message: "no session" };
  }

  const { data: studio } = await service
    .from("studios")
    .select(
      "id,name,timezone,google_calendar_id,google_refresh_token,google_token_status",
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

// Alias used by the on-demand sync + repair routes. A session's calendar event
// is the reconciled reflection of its booking state, so mirroring the session
// is exactly what "reconcile bookings" means here. Kept as a named export so the
// google route handlers can call it directly.
export async function reconcileSessionBookings(
  sessionId: string,
): Promise<SyncResult> {
  return syncSessionById(sessionId);
}

// ============================================================================
// Legacy event cleanup
//
// Early builds wrote ONE session-level calendar event per class, titled
// `${studio.name} - ${number}` (the "orange" blocks). The current model writes
// ONE event PER BOOKING, titled `${name}: ${class}` (the green/purple blocks).
// Both formats can coexist on the same calendar, and the old session-level
// blocks are orphans the reconcile pass can't reach (they don't carry the
// studioflow_session_id extended property, and past/out-of-window sessions are
// never reconciled).
//
// This finds and (optionally) deletes ONLY the legacy session-level blocks:
//   - title matches `^<studio name> - <digits>`  (the old format), AND
//   - title does NOT contain ": "                (never a per-person block).
// The per-person `${name}: ${class}` events are always preserved, as are all
// bookings. Deletion only happens when `apply` is true; otherwise this is a
// dry run that reports what WOULD be removed.
// ============================================================================
export type LegacyCleanupResult = {
  studio: string;
  calendarId: string | null;
  scanned: number;
  matched: number;
  deleted: number;
  applied: boolean;
  sampleTitles: string[];
  error?: string;
};

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Does this event summary look like a legacy session-level block for `studio`?
function isLegacySessionTitle(summary: string, studioName: string): boolean {
  const title = summary.trim();
  // Per-person blocks always contain ": " (name: class). Never touch those.
  if (title.includes(": ")) return false;
  // Old format: "<Studio Name> - <number>" possibly with a trailing time.
  const pattern = new RegExp(`^${escapeRegExp(studioName)}\\s*-\\s*\\d+`, "i");
  return pattern.test(title);
}

export async function cleanupLegacyEventsForStudio(
  studio: StudioForSync,
  opts: { apply: boolean; windowPastDays?: number; windowFutureDays?: number },
): Promise<LegacyCleanupResult> {
  const result: LegacyCleanupResult = {
    studio: studio.name,
    calendarId: studio.google_calendar_id,
    scanned: 0,
    matched: 0,
    deleted: 0,
    applied: opts.apply,
    sampleTitles: [],
  };

  if (!studio.google_calendar_id || !studio.google_refresh_token) {
    result.error = "studio not connected";
    return result;
  }

  const calendarId = studio.google_calendar_id;
  const pastDays = opts.windowPastDays ?? 120;
  const futureDays = opts.windowFutureDays ?? 180;
  const now = Date.now();
  const timeMin = new Date(now - pastDays * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now + futureDays * 24 * 60 * 60 * 1000).toISOString();

  let calendar: calendar_v3.Calendar;
  try {
    calendar = calendarForStudio(studio);
  } catch (err) {
    result.error = err instanceof Error ? err.message : "auth failed";
    return result;
  }

  try {
    let pageToken: string | undefined = undefined;
    do {
      const list: { data: calendar_v3.Schema$Events } =
        await calendar.events.list({
          calendarId,
          timeMin,
          timeMax,
          singleEvents: true,
          showDeleted: false,
          maxResults: 250,
          pageToken,
        });

      const items = list.data.items ?? [];
      for (const ev of items) {
        result.scanned++;
        const summary = ev.summary ?? "";
        if (!ev.id || !isLegacySessionTitle(summary, studio.name)) continue;

        result.matched++;
        if (result.sampleTitles.length < 20) {
          result.sampleTitles.push(summary.trim());
        }

        if (opts.apply) {
          try {
            await calendar.events.delete({ calendarId, eventId: ev.id });
            result.deleted++;
          } catch {
            // Skip individual delete failures; keep going.
          }
        }
      }

      pageToken = list.data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (err) {
    result.error = err instanceof Error ? err.message : "list failed";
  }

  return result;
}
