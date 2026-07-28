// ============================================================================
// GET /api/google/sync-now   (admin only)
//
// Manual, on-demand version of the sync-google cron: pushes every connected
// studio's upcoming scheduled sessions to its Google Calendar right now, so an
// admin can verify a fresh connection without waiting for the 15-minute cron.
// Reuses syncSessionById, which reads each studio's current google_calendar_id
// (so classes land on whatever calendar the studio is pointed at).
// ============================================================================
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { reconcileSessionBookings, type SyncResult } from "@/lib/google/sync";

const SYNC_WINDOW_DAYS = 30;

export async function GET() {
  await requireRole("admin", "/admin/studios");

  const service = createServiceClient();
  const { data: studios } = await service
    .from("studios")
    .select("id,name,google_calendar_id")
    .eq("google_token_status", "connected");

  const now = new Date();
  const windowEnd = new Date(
    now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const summary: Array<Record<string, unknown>> = [];

  for (const studio of (studios ?? []) as {
    id: string;
    name: string;
    google_calendar_id: string | null;
  }[]) {
    const { data: sessions } = await service
      .from("sessions")
      .select("id")
      .eq("studio_id", studio.id)
      .eq("status", "scheduled")
      .gte("starts_at", now.toISOString())
      .lte("starts_at", windowEnd.toISOString());

    const ids = (sessions ?? []).map((s) => (s as { id: string }).id);
    let synced = 0;
    const errors: string[] = [];
    for (const id of ids) {
      const r: SyncResult = await reconcileSessionBookings(id);
      if (r.ok && r.action !== "skip") synced++;
      else if (!r.ok && r.message) errors.push(r.message);
    }

    summary.push({
      studio: studio.name,
      calendar: (studio.google_calendar_id ?? "").split("@")[0].slice(0, 16),
      attempted: ids.length,
      synced,
      sampleError: errors[0],
    });
  }

  return NextResponse.json({ ok: true, summary });
}
