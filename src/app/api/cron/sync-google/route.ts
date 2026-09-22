// ============================================================================
// GET /api/cron/sync-google
//
// Backfills every future scheduled StudioFlow class into Google Calendar.
// Vercel Cron calls this once per minute with CRON_SECRET in Authorization.
// New/edited/booked classes also sync inline, so this route is the safety net
// and the bulk backfill for sessions created before calendar sync was enabled.
// ============================================================================
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncSessionById, type SyncResult } from "@/lib/google/sync";

export const maxDuration = 60;

const BATCH_SIZE = 300;
const CONCURRENCY = 15;

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

  const { data: studios, error: studiosError } = await service
    .from("studios")
    .select("id")
    .eq("google_token_status", "connected");

  if (studiosError) {
    return NextResponse.json(
      { error: `Could not load studios: ${studiosError.message}` },
      { status: 500 },
    );
  }

  const studioIds = (studios ?? []).map((s) => (s as { id: string }).id);
  if (studioIds.length === 0) {
    return NextResponse.json({ synced: 0, attempted: 0, remaining: 0 });
  }

  const now = new Date().toISOString();

  const { count: remainingBefore } = await service
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .in("studio_id", studioIds)
    .eq("status", "scheduled")
    .gte("starts_at", now)
    .is("google_event_id", null);

  // Earliest sessions first so the active booking window is populated before
  // far-future schedule rows.
  const { data: sessions, error: sessionsError } = await service
    .from("sessions")
    .select("id")
    .in("studio_id", studioIds)
    .eq("status", "scheduled")
    .gte("starts_at", now)
    .is("google_event_id", null)
    .order("starts_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (sessionsError) {
    return NextResponse.json(
      { error: `Could not load sessions: ${sessionsError.message}` },
      { status: 500 },
    );
  }

  const sessionIds = (sessions ?? []).map((s) => (s as { id: string }).id);
  const results: Array<{ sessionId: string } & SyncResult> = [];

  // Small parallel batches keep the backfill fast without hammering one
  // Google Calendar account with hundreds of simultaneous writes.
  for (let i = 0; i < sessionIds.length; i += CONCURRENCY) {
    const chunk = sessionIds.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (sessionId) => ({
        sessionId,
        ...(await syncSessionById(sessionId)),
      })),
    );
    results.push(...chunkResults);
  }

  const synced = results.filter((item) => item.ok && item.action !== "skip").length;
  const failed = results.filter((item) => !item.ok).length;
  const remaining = Math.max((remainingBefore ?? 0) - synced, 0);

  return NextResponse.json({
    synced,
    failed,
    attempted: sessionIds.length,
    remaining,
    results,
  });
}
