// ============================================================================
// GET /api/cron/sync-google
//
// Repairs Google Calendar drift and migrates the temporary aggregate-class
// layout back to the studio's established one-event-per-person layout.
//
// Priority:
//   1. sessions that still have an aggregate sessions.google_event_id,
//   2. future active bookings missing booking-level Google event IDs,
//   3. filled sessions missing filler-seat event IDs.
//
// Inline booking/session actions keep new changes synced immediately. Cron is
// the safety net and migration/backfill path.
// ============================================================================
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncSessionById, type SyncResult } from "@/lib/google/sync";

export const maxDuration = 60;

const BATCH_SIZE = 180;
const CONCURRENCY = 10;

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
  const now = new Date().toISOString();
  const sessionIds = new Set<string>();

  // First remove the orange aggregate events created by the temporary class-
  // summary sync. syncSessionById deletes that event and replaces it with
  // individual customer/filler events where appropriate.
  const { data: aggregateSessions, error: aggregateError } = await service
    .from("sessions")
    .select("id")
    .gte("starts_at", now)
    .not("google_event_id", "is", null)
    .order("starts_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (aggregateError) {
    return NextResponse.json(
      { error: `Could not load aggregate sessions: ${aggregateError.message}` },
      { status: 500 },
    );
  }

  for (const row of aggregateSessions ?? []) {
    sessionIds.add((row as { id: string }).id);
  }

  if (sessionIds.size < BATCH_SIZE) {
    const remaining = BATCH_SIZE - sessionIds.size;

    // Existing bookings from before booking-level Google IDs were tracked.
    const { data: bookingRows, error: bookingError } = await service
      .from("bookings")
      .select("session_id,session:sessions!inner(id,starts_at,status)")
      .in("status", ["booked", "attended", "no_show"])
      .is("google_event_ids", null)
      .gte("session.starts_at", now)
      .eq("session.status", "scheduled")
      .order("booked_at", { ascending: true })
      .limit(remaining * 2);

    if (bookingError) {
      return NextResponse.json(
        { error: `Could not load unsynced bookings: ${bookingError.message}` },
        { status: 500 },
      );
    }

    for (const row of bookingRows ?? []) {
      sessionIds.add((row as { session_id: string }).session_id);
      if (sessionIds.size >= BATCH_SIZE) break;
    }
  }

  if (sessionIds.size < BATCH_SIZE) {
    const remaining = BATCH_SIZE - sessionIds.size;

    const { data: fillerRows, error: fillerError } = await service
      .from("sessions")
      .select("id")
      .eq("status", "scheduled")
      .gte("starts_at", now)
      .gt("filler_seats", 0)
      .is("google_filler_event_ids", null)
      .order("starts_at", { ascending: true })
      .limit(remaining);

    if (fillerError) {
      return NextResponse.json(
        { error: `Could not load filled sessions: ${fillerError.message}` },
        { status: 500 },
      );
    }

    for (const row of fillerRows ?? []) {
      sessionIds.add((row as { id: string }).id);
    }
  }

  const ids = [...sessionIds];
  const results: Array<{ sessionId: string } & SyncResult> = [];

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const chunk = ids.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (sessionId) => ({
        sessionId,
        ...(await syncSessionById(sessionId)),
      })),
    );
    results.push(...chunkResults);
  }

  const synced = results.filter((item) => item.ok).length;
  const failed = results.filter((item) => !item.ok).length;

  const [{ count: aggregateRemaining }, { count: bookingRemaining }] =
    await Promise.all([
      service
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .gte("starts_at", now)
        .not("google_event_id", "is", null),
      service
        .from("bookings")
        .select("id,session:sessions!inner(id)", { count: "exact", head: true })
        .in("status", ["booked", "attended", "no_show"])
        .is("google_event_ids", null)
        .gte("session.starts_at", now)
        .eq("session.status", "scheduled"),
    ]);

  return NextResponse.json({
    synced,
    failed,
    attempted: ids.length,
    aggregateRemaining: aggregateRemaining ?? 0,
    bookingRemaining: bookingRemaining ?? 0,
    results,
  });
}
