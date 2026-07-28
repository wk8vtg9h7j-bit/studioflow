// ============================================================================
// GET /api/google/cleanup-legacy            (admin only)
//   - default (no query)  -> DRY RUN: scans each connected studio's calendar and
//                            reports how many legacy "{Studio} - {number}" blocks
//                            would be removed, WITHOUT deleting anything.
//   - ?confirm=1          -> APPLY: actually deletes those legacy events.
//
// This removes ONLY the old session-level orange blocks (titles like
// "Hideaway Pilates - 460"). It NEVER touches the correct per-person blocks
// (titles like "Khanh Ha: ...") because those contain ": ", nor any bookings.
// ============================================================================
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  cleanupLegacyEventsForStudio,
  type LegacyCleanupResult,
  type StudioForSync,
} from "@/lib/google/sync";

export async function GET(request: Request) {
  await requireRole("admin", "/admin/studios");

  const apply = new URL(request.url).searchParams.get("confirm") === "1";

  const service = createServiceClient();
  const { data: studios } = await service
    .from("studios")
    .select(
      "id,name,timezone,google_calendar_id,google_refresh_token,google_token_status",
    )
    .eq("google_token_status", "connected");

  const results: LegacyCleanupResult[] = [];
  for (const studio of (studios ?? []) as StudioForSync[]) {
    results.push(await cleanupLegacyEventsForStudio(studio, { apply }));
  }

  return NextResponse.json({ ok: true, dryRun: !apply, results });
}
