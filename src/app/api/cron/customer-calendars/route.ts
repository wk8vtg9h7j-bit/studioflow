import { NextResponse } from "next/server";
import { calendar_v3, google } from "googleapis";
import { createServiceClient } from "@/lib/supabase/server";
import { createOAuthClient } from "@/lib/google/oauth";
import { decryptToken } from "@/lib/google/crypto";

export const maxDuration = 60;

const BATCH_SIZE = 40;

type ConnectionRow = {
  customer_id: string;
  google_refresh_token: string | null;
  google_calendar_id: string;
  google_token_status: "disconnected" | "connected" | "error";
};

type PendingBooking = {
  id: string;
  status: "booked" | "waitlisted" | "cancelled" | "attended" | "no_show";
  customer_id: string;
  customer_google_event_id: string | null;
  customer: { calendar_auto_add: boolean } | null;
  session: {
    id: string;
    title: string | null;
    starts_at: string;
    ends_at: string;
    status: "scheduled" | "cancelled" | "completed";
    room: string | null;
    studio: {
      name: string;
      address: string | null;
      timezone: string | null;
    } | null;
    class_type: { name: string | null } | null;
    instructor: { display_name: string | null } | null;
  } | null;
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("bookings")
    .select(
      `id,status,customer_id,customer_google_event_id,
       customer:customers(calendar_auto_add),
       session:sessions(
         id,title,starts_at,ends_at,status,room,
         studio:studios(name,address,timezone),
         class_type:class_types(name),
         instructor:instructors(display_name)
       )`,
    )
    .not("customer_calendar_sync_pending_at", "is", null)
    .order("customer_calendar_sync_pending_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as PendingBooking[];
  if (rows.length === 0) {
    return NextResponse.json({ attempted: 0, synced: 0, deleted: 0, failed: 0 });
  }

  const customerIds = Array.from(new Set(rows.map((row) => row.customer_id)));
  const { data: connectionData, error: connectionError } = await service
    .from("customer_google_connections")
    .select(
      "customer_id,google_refresh_token,google_calendar_id,google_token_status",
    )
    .in("customer_id", customerIds);

  if (connectionError) {
    return NextResponse.json({ error: connectionError.message }, { status: 500 });
  }

  const connections = new Map(
    ((connectionData ?? []) as ConnectionRow[]).map((row) => [
      row.customer_id,
      row,
    ]),
  );

  let synced = 0;
  let deleted = 0;
  let failed = 0;

  for (const booking of rows) {
    const connection = connections.get(booking.customer_id);
    const session = booking.session;
    const autoAdd = booking.customer?.calendar_auto_add === true;

    if (!session) {
      await clearPending(service, booking.id);
      continue;
    }

    const future = Date.parse(session.starts_at) > Date.now();
    if (!future) {
      await clearPending(service, booking.id);
      continue;
    }

    if (
      !autoAdd ||
      !connection ||
      connection.google_token_status !== "connected" ||
      !connection.google_refresh_token
    ) {
      await clearPending(service, booking.id);
      continue;
    }

    try {
      const client = createOAuthClient();
      client.setCredentials({
        refresh_token: decryptToken(connection.google_refresh_token),
      });
      const calendar = google.calendar({ version: "v3", auth: client });
      const calendarId = connection.google_calendar_id || "primary";

      const shouldExist =
        booking.status === "booked" && session.status === "scheduled";

      if (!shouldExist) {
        if (booking.customer_google_event_id) {
          await safeDelete(
            calendar,
            calendarId,
            booking.customer_google_event_id,
          );
          deleted += 1;
        }
        await service
          .from("bookings")
          .update({
            customer_google_event_id: null,
            customer_calendar_sync_pending_at: null,
          })
          .eq("id", booking.id);
        continue;
      }

      const eventId =
        booking.customer_google_event_id ??
        `sfc${booking.id.replace(/-/g, "")}`;
      const body = eventBody(booking);
      const savedId = await upsertEvent(calendar, calendarId, eventId, body);

      await service
        .from("bookings")
        .update({
          customer_google_event_id: savedId,
          customer_calendar_sync_pending_at: null,
        })
        .eq("id", booking.id);
      synced += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : "Calendar sync failed";
      if (/invalid_grant|unauthorized|revoked/i.test(message)) {
        await service
          .from("customer_google_connections")
          .update({
            google_token_status: "error",
            updated_at: new Date().toISOString(),
          })
          .eq("customer_id", booking.customer_id);
        await clearPending(service, booking.id);
      }
    }
  }

  const { count: remaining } = await service
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .not("customer_calendar_sync_pending_at", "is", null);

  return NextResponse.json({
    attempted: rows.length,
    synced,
    deleted,
    failed,
    remaining: remaining ?? 0,
  });
}

function eventBody(booking: PendingBooking): calendar_v3.Schema$Event {
  const session = booking.session as NonNullable<PendingBooking["session"]>;
  const timezone = session.studio?.timezone || "Asia/Ho_Chi_Minh";
  const className =
    session.title?.trim() ||
    session.class_type?.name?.trim() ||
    "Pilates class";
  const description = [
    "Pilates by Recharged",
    session.instructor?.display_name
      ? `Instructor: ${session.instructor.display_name}`
      : null,
    session.room ? `Room: ${session.room}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    summary: className,
    description,
    location: session.studio?.address || session.studio?.name || undefined,
    start: { dateTime: session.starts_at, timeZone: timezone },
    end: { dateTime: session.ends_at, timeZone: timezone },
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: 180 }],
    },
    extendedProperties: {
      private: {
        studioflow_customer_booking_id: booking.id,
      },
    },
  };
}

async function clearPending(
  service: ReturnType<typeof createServiceClient>,
  bookingId: string,
) {
  await service
    .from("bookings")
    .update({ customer_calendar_sync_pending_at: null })
    .eq("id", bookingId);
}

function errorCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const value = Number((error as { code?: unknown }).code);
  return Number.isFinite(value) ? value : null;
}

async function safeDelete(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  eventId: string,
) {
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
