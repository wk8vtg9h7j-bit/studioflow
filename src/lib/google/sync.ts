// ============================================================================
// Google Calendar sync.
//
// Calendar layout intentionally mirrors the studio's previous workflow:
//   • one Google event for each occupied spot/customer,
//   • Hideaway and Downtown use their two established Google colors,
//   • filler seats are individual "Filled by info@" events,
//   • no aggregate "1/4 booked" class event is created.
//
// Old aggregate StudioFlow session events are removed as sessions are reconciled.
// Existing legacy per-booking events are discovered by their "StudioFlow booking"
// marker and reused, avoiding duplicate customer events.
// ============================================================================
import { calendar_v3, google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { createServiceClient } from "@/lib/supabase/server";
import { createOAuthClient } from "./oauth";
import { decryptToken } from "./crypto";
import type { BookingStatus, SessionStatus, Studio } from "@/lib/types";

type StudioForSync = Pick<
  Studio,
  | "id"
  | "name"
  | "slug"
  | "timezone"
  | "google_calendar_id"
  | "google_refresh_token"
  | "google_token_status"
  | "google_account_email"
>;

type SessionForSync = {
  id: string;
  title: string | null;
  starts_at: string;
  ends_at: string;
  room: string | null;
  notes: string | null;
  status: SessionStatus;
  google_event_id: string | null;
  google_filler_event_ids: string[] | null;
  filler_seats: number;
  capacity: number;
  class_type_name: string | null;
  instructor_name: string | null;
};

type BookingForSync = {
  id: string;
  status: BookingStatus;
  spots_count: number;
  google_event_ids: string[] | null;
  name: string;
  email: string | null;
  phone: string | null;
};

export class StudioNotConnectedError extends Error {
  constructor(studioId: string) {
    super(`Studio ${studioId} is not connected to Google Calendar`);
    this.name = "StudioNotConnectedError";
  }
}

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
  return google.calendar({
    version: "v3",
    auth: authedClientForStudio(studio),
  });
}

function errorCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const code = Number((error as { code?: unknown }).code);
  return Number.isFinite(code) ? code : null;
}

function eventColorId(studio: StudioForSync): string {
  // These are the two colors already used by the old StudioFlow booking events:
  // Hideaway = green, Downtown = purple.
  return studio.slug === "downtown-pilates" ? "3" : "10";
}

function sessionName(session: SessionForSync): string {
  return (
    session.title?.trim() ||
    session.class_type_name?.trim() ||
    "Pilates class"
  );
}

function bookingEventBody(
  studio: StudioForSync,
  session: SessionForSync,
  booking: BookingForSync,
  spotIndex: number,
): calendar_v3.Schema$Event {
  const name =
    spotIndex === 0
      ? booking.name
      : `${booking.name} guest ${spotIndex}`;
  const description: string[] = [];

  if (session.instructor_name) {
    description.push(`Instructor: ${session.instructor_name}`);
  }
  if (booking.email) description.push(`Email: ${booking.email}`);
  if (booking.phone) description.push(`Phone: ${booking.phone}`);
  if (booking.spots_count > 1) {
    description.push(`Spot ${spotIndex + 1} of ${booking.spots_count}`);
  }
  description.push(`StudioFlow booking ${booking.id}`);

  return {
    summary: `${name}: ${sessionName(session)}`,
    description: description.join("\n"),
    colorId: eventColorId(studio),
    start: { dateTime: session.starts_at, timeZone: studio.timezone },
    end: { dateTime: session.ends_at, timeZone: studio.timezone },
    extendedProperties: {
      private: {
        studioflow_booking_id: booking.id,
        studioflow_session_id: session.id,
        studioflow_spot: String(spotIndex + 1),
      },
    },
  };
}

function fillerEventBody(
  studio: StudioForSync,
  session: SessionForSync,
  spotIndex: number,
): calendar_v3.Schema$Event {
  const account = studio.google_account_email ?? "info@rechargeddanang.com";
  const description: string[] = [];
  if (session.instructor_name) {
    description.push(`Instructor: ${session.instructor_name}`);
  }
  description.push(`Filled by: ${account}`);
  description.push(`Held spot ${spotIndex + 1} of ${session.filler_seats}`);
  description.push(`StudioFlow fill ${session.id}`);

  return {
    summary: `${account}: ${sessionName(session)} (FILLED)`,
    description: description.join("\n"),
    colorId: eventColorId(studio),
    start: { dateTime: session.starts_at, timeZone: studio.timezone },
    end: { dateTime: session.ends_at, timeZone: studio.timezone },
    extendedProperties: {
      private: {
        studioflow_session_id: session.id,
        studioflow_fill_spot: String(spotIndex + 1),
      },
    },
  };
}

async function safeDelete(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  eventId: string,
): Promise<void> {
  try {
    await calendar.events.delete({ calendarId, eventId });
  } catch (error) {
    if (errorCode(error) !== 404 && errorCode(error) !== 410) throw error;
  }
}

async function upsertEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  eventId: string,
  body: calendar_v3.Schema$Event,
): Promise<string> {
  try {
    const updated = await calendar.events.update({
      calendarId,
      eventId,
      requestBody: body,
    });
    return updated.data.id ?? eventId;
  } catch (error) {
    if (errorCode(error) !== 404 && errorCode(error) !== 410) throw error;
  }

  try {
    const inserted = await calendar.events.insert({
      calendarId,
      requestBody: { ...body, id: eventId },
    });
    return inserted.data.id ?? eventId;
  } catch (error) {
    if (errorCode(error) !== 409) throw error;
    const updated = await calendar.events.update({
      calendarId,
      eventId,
      requestBody: body,
    });
    return updated.data.id ?? eventId;
  }
}

async function findLegacyBookingEventIds(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  bookingId: string,
  session: SessionForSync,
): Promise<string[]> {
  const result = await calendar.events.list({
    calendarId,
    timeMin: session.starts_at,
    timeMax: session.ends_at,
    q: bookingId,
    singleEvents: true,
    maxResults: 10,
  });

  const marker = `StudioFlow booking ${bookingId}`;
  return (result.data.items ?? [])
    .filter((event) => event.id && event.description?.includes(marker))
    .map((event) => event.id as string);
}

async function logSync(
  studioId: string,
  sessionId: string,
  action: string,
  ok: boolean,
  message: string | null,
): Promise<void> {
  // Success rows were growing this table by millions of records and added a
  // write to every sync. Keep only failures; successful sync state already
  // lives on bookings/sessions.
  if (ok) return;

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
    // Logging should never break a booking or calendar update.
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

export async function syncSessionById(sessionId: string): Promise<SyncResult> {
  const service = createServiceClient();

  const { data: sessionData, error: sessionError } = await service
    .from("sessions")
    .select(
      "id,title,starts_at,ends_at,room,notes,status,google_event_id,google_filler_event_ids,filler_seats,capacity,studio_id,class_type:class_types(name),instructor:instructors(display_name)",
    )
    .eq("id", sessionId)
    .single();

  if (sessionError || !sessionData) {
    return {
      ok: false,
      action: "skip",
      eventId: null,
      message: sessionError?.message ?? "no session",
    };
  }

  const sessionRow = sessionData as unknown as {
    id: string;
    title: string | null;
    starts_at: string;
    ends_at: string;
    room: string | null;
    notes: string | null;
    status: SessionStatus;
    google_event_id: string | null;
    google_filler_event_ids: string[] | null;
    filler_seats: number | null;
    capacity: number;
    studio_id: string;
    class_type: { name: string | null } | null;
    instructor: { display_name: string | null } | null;
  };

  const session: SessionForSync = {
    id: sessionRow.id,
    title: sessionRow.title,
    starts_at: sessionRow.starts_at,
    ends_at: sessionRow.ends_at,
    room: sessionRow.room,
    notes: sessionRow.notes,
    status: sessionRow.status,
    google_event_id: sessionRow.google_event_id,
    google_filler_event_ids: sessionRow.google_filler_event_ids,
    filler_seats: sessionRow.filler_seats ?? 0,
    capacity: sessionRow.capacity,
    class_type_name: sessionRow.class_type?.name ?? null,
    instructor_name: sessionRow.instructor?.display_name ?? null,
  };

  const { data: studioData, error: studioError } = await service
    .from("studios")
    .select(
      "id,name,slug,timezone,google_calendar_id,google_refresh_token,google_token_status,google_account_email",
    )
    .eq("id", sessionRow.studio_id)
    .single();

  if (studioError || !studioData) {
    return {
      ok: false,
      action: "skip",
      eventId: null,
      message: studioError?.message ?? "no studio",
    };
  }

  const studio = studioData as StudioForSync;
  if (
    studio.google_token_status !== "connected" ||
    !studio.google_refresh_token ||
    !studio.google_calendar_id
  ) {
    return {
      ok: false,
      action: "skip",
      eventId: null,
      message: "studio not connected",
    };
  }

  const calendar = calendarForStudio(studio);
  const calendarId = studio.google_calendar_id;

  try {
    // Remove the newer aggregate class card ("Foundation Flow · 1/4 booked").
    // The desired calendar layout is one event per occupied spot instead.
    if (session.google_event_id) {
      await safeDelete(calendar, calendarId, session.google_event_id);
      await service
        .from("sessions")
        .update({ google_event_id: null })
        .eq("id", session.id);
    }

    const { data: bookingRows, error: bookingError } = await service
      .from("bookings")
      .select(
        "id,status,spots_count,google_event_ids,customer:customers(name,email,phone,profile:profiles(full_name,email,phone))",
      )
      .eq("session_id", session.id)
      .order("booked_at", { ascending: true });

    if (bookingError) throw bookingError;

    const bookings: BookingForSync[] = (bookingRows ?? []).map((row) => {
      const item = row as unknown as {
        id: string;
        status: BookingStatus;
        spots_count: number | null;
        google_event_ids: string[] | null;
        customer:
          | {
              name: string | null;
              email: string | null;
              phone: string | null;
              profile:
                | {
                    full_name: string | null;
                    email: string | null;
                    phone: string | null;
                  }
                | null;
            }
          | null;
      };
      const customer = item.customer;
      return {
        id: item.id,
        status: item.status,
        spots_count: Math.max(item.spots_count ?? 1, 1),
        google_event_ids: item.google_event_ids,
        name:
          customer?.profile?.full_name ||
          customer?.name ||
          customer?.profile?.email ||
          customer?.email ||
          "Member",
        email: customer?.profile?.email ?? customer?.email ?? null,
        phone: customer?.profile?.phone ?? customer?.phone ?? null,
      };
    });

    let created = 0;
    let updated = 0;
    let deleted = 0;
    let firstEventId: string | null = null;
    const sessionActive = session.status === "scheduled";

    for (const booking of bookings) {
      const shouldShow =
        sessionActive &&
        (booking.status === "booked" ||
          booking.status === "attended" ||
          booking.status === "no_show");

      let ids = [...(booking.google_event_ids ?? [])];

      // Older booking events existed in Google before we started persisting
      // booking-level event IDs. Discover them for BOTH active and cancelled
      // bookings. Without this, a cancellation with google_event_ids = null
      // could leave the old Google event behind indefinitely.
      if (ids.length === 0) {
        ids = await findLegacyBookingEventIds(
          calendar,
          calendarId,
          booking.id,
          session,
        );
      }

      if (!shouldShow) {
        for (const id of ids) {
          await safeDelete(calendar, calendarId, id);
          deleted += 1;
        }
        if (ids.length > 0) {
          await service
            .from("bookings")
            .update({ google_event_ids: null })
            .eq("id", booking.id);
        }
        continue;
      }

      const nextIds: string[] = [];
      for (let spotIndex = 0; spotIndex < booking.spots_count; spotIndex += 1) {
        const existingId = ids[spotIndex];
        const deterministicId = `sfb${booking.id.replace(/-/g, "")}${spotIndex + 1}`;
        const targetId = existingId ?? deterministicId;
        const body = bookingEventBody(studio, session, booking, spotIndex);
        const eventId = await upsertEvent(calendar, calendarId, targetId, body);

        if (existingId) updated += 1;
        else created += 1;

        nextIds.push(eventId);
        firstEventId ??= eventId;
      }

      for (const staleId of ids.slice(booking.spots_count)) {
        await safeDelete(calendar, calendarId, staleId);
        deleted += 1;
      }

      await service
        .from("bookings")
        .update({ google_event_ids: nextIds })
        .eq("id", booking.id);
    }

    const currentFillerIds = [...(session.google_filler_event_ids ?? [])];
    const wantedFillerCount = sessionActive ? session.filler_seats : 0;
    const nextFillerIds: string[] = [];

    for (let spotIndex = 0; spotIndex < wantedFillerCount; spotIndex += 1) {
      const existingId = currentFillerIds[spotIndex];
      const deterministicId = `sff${session.id.replace(/-/g, "")}${spotIndex + 1}`;
      const targetId = existingId ?? deterministicId;
      const eventId = await upsertEvent(
        calendar,
        calendarId,
        targetId,
        fillerEventBody(studio, session, spotIndex),
      );

      if (existingId) updated += 1;
      else created += 1;

      nextFillerIds.push(eventId);
      firstEventId ??= eventId;
    }

    for (const staleId of currentFillerIds.slice(wantedFillerCount)) {
      await safeDelete(calendar, calendarId, staleId);
      deleted += 1;
    }

    await service
      .from("sessions")
      .update({
        google_filler_event_ids:
          nextFillerIds.length > 0 ? nextFillerIds : null,
      })
      .eq("id", session.id);

    await logSync(
      studio.id,
      session.id,
      "booking_events",
      true,
      `created=${created}, updated=${updated}, deleted=${deleted}`,
    );
    await stampSynced(studio.id);

    const action =
      created > 0
        ? "create"
        : deleted > 0
          ? "delete"
          : updated > 0
            ? "update"
            : "skip";

    return {
      ok: true,
      action,
      eventId: firstEventId,
      message: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown sync error";
    await logSync(studio.id, session.id, "booking_events", false, message);
    return {
      ok: false,
      action: "skip",
      eventId: null,
      message,
    };
  }
}
