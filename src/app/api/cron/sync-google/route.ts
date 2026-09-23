import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  cleanupLegacyAggregateEvents,
  syncSessionById,
} from "@/lib/google/sync";

export const maxDuration = 60;

// Keep background Calendar work deliberately small so it never competes with
// customer booking or admin filtering. New changes are marked dirty by DB
// triggers and usually clear on the next one-minute cron run.
const BATCH_SIZE = 20;
const CONCURRENCY = 2;

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

  // Remove a small batch of orphaned orange aggregate class events first.
  // These are legacy calendar cards that no longer have a sessions.google_event_id
  // link in StudioFlow, so they need calendar-side discovery by marker.
  const legacyCleanup = await cleanupLegacyAggregateEvents(40);

  // Fresh customer/admin changes must never wait behind an old migration
  // backlog. Process most of each batch newest-first, while reserving a few
  // slots for the oldest pending rows so the backlog still drains.
  const urgentLimit = 14;
  const backlogLimit = BATCH_SIZE - urgentLimit;

  const [{ data: newest, error: newestError }, { data: oldest, error: oldestError }] =
    await Promise.all([
      service
        .from("sessions")
        .select("id,google_sync_pending_at")
        .not("google_sync_pending_at", "is", null)
        .order("google_sync_pending_at", { ascending: false })
        .limit(urgentLimit),
      service
        .from("sessions")
        .select("id,google_sync_pending_at")
        .not("google_sync_pending_at", "is", null)
        .order("google_sync_pending_at", { ascending: true })
        .limit(backlogLimit),
    ]);

  const error = newestError ?? oldestError;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byId = new Map<
    string,
    { id: string; google_sync_pending_at: string }
  >();
  for (const row of [...(newest ?? []), ...(oldest ?? [])] as {
    id: string;
    google_sync_pending_at: string;
  }[]) {
    byId.set(row.id, row);
  }
  const rows = [...byId.values()];

  let synced = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);

    await Promise.all(
      chunk.map(async (row) => {
        const result = await syncSessionById(row.id);

        if (!result.ok) {
          failed += 1;
          return;
        }

        synced += 1;

        // Clear only the version we processed. If another booking/session change
        // happened during the Google request, its newer timestamp remains queued.
        await service
          .from("sessions")
          .update({ google_sync_pending_at: null })
          .eq("id", row.id)
          .eq("google_sync_pending_at", row.google_sync_pending_at);
      }),
    );
  }

  const { count: remaining } = await service
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .not("google_sync_pending_at", "is", null);

  return NextResponse.json({
    attempted: rows.length,
    synced,
    failed,
    remaining: remaining ?? 0,
    legacyAggregateCleanup: legacyCleanup,
  });
}
