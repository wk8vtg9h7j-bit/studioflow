// ============================================================================
// GET /api/cron/sync-google
//
// Scheduled reconciliation endpoint. A scheduler (Vercel Cron, GitHub Actions,
// etc.) calls this on an interval to push any sessions that drifted out of sync
// onto their studio's Google Calendar — a safety net behind the inline sync that
// runs on each booking/session mutation.
//
// Auth: this runs with no user session, so it is guarded by a shared secret.
// The caller must send `Authorization: Bearer <CRON_SECRET>`. Any mismatch is a
// 401. All DB access uses the service-role client.
//
// Work: load upcoming, still-scheduled sessions belonging to studios whose
// google_token_status is "connected", and re-sync each via syncSessionById.
// Returns a JSON summary of what was attempted.
// ============================================================================
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncSessionById, type SyncResult } from "@/lib/google/sync";

// How far ahead to reconcile. Past sessions are left alone; the inline sync
// already handled cancellations/completions at mutation time.
const SYNC_WINDOW_DAYS = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();

  // Connected studios only — nothing to sync for a studio without a token.
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
    return NextResponse.json({ synced: 0, results: [] });
  }

  // Upcoming, still-scheduled sessions within the reconcile window.
  const now = new Date();
  const windowEnd = new Date(
    now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const { data: sessions, error: sessionsError } = await service
    .from("sessions")
    .select("id")
    .in("studio_id", studioIds)
    .eq("status", "scheduled")
    .gte("starts_at", now.toISOString())
    .lte("starts_at", windowEnd.toISOString());

  if (sessionsError) {
    return NextResponse.json(
      { error: `Could not load sessions: ${sessionsError.message}` },
      { status: 500 },
    );
  }

  const sessionIds = (sessions ?? []).map((s) => (s as { id: string }).id);

  // Sync sequentially to stay polite to the Google API rate limits.
  const results: Array<{ sessionId: string } & SyncResult> = [];
  for (const sessionId of sessionIds) {
    const result = await syncSessionById(sessionId);
    results.push({ sessionId, ...result });
  }

  const synced = results.filter((r) => r.ok && r.action !== "skip").length;

  return NextResponse.json({ synced, attempted: sessionIds.length, results });
}
