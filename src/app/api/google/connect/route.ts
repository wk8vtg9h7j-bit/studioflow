// ============================================================================
// GET /api/google/connect?studio=<studioId>
//
// Admin-only entry point to the per-studio Google Calendar OAuth flow. We guard
// with requireRole("admin"), validate that the studio exists, then redirect the
// admin to Google's consent screen. The studio id rides along in `state` so the
// callback knows which studio row to attach the resulting refresh token to.
// ============================================================================
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { buildConsentUrl } from "@/lib/google/oauth";

export async function GET(request: Request) {
  // Only studio admins may connect a calendar.
  await requireRole("admin", "/admin/studios");

  const url = new URL(request.url);
  const studioId = url.searchParams.get("studio");
  if (!studioId) {
    return NextResponse.redirect(
      new URL("/admin/studios?error=Missing+studio", url.origin),
    );
  }

  // Confirm the studio exists before sending the admin off to Google.
  const service = createServiceClient();
  const { data: studio } = await service
    .from("studios")
    .select("id")
    .eq("id", studioId)
    .single();

  if (!studio) {
    return NextResponse.redirect(
      new URL("/admin/studios?error=Studio+not+found", url.origin),
    );
  }

  return NextResponse.redirect(buildConsentUrl(studioId));
}
