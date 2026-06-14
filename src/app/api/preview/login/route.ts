// ============================================================================
// Preview-only login route. Sets the `preview_role` cookie for the chosen role
// and redirects into the matching dashboard. Inert in production: when
// PREVIEW_MODE is off this returns 404 so the endpoint effectively disappears.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { PREVIEW_MODE, PREVIEW_COOKIE, isPreviewRole } from "@/lib/preview";
import { homePathForRole } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!PREVIEW_MODE) {
    return new NextResponse("Not found", { status: 404 });
  }

  const role = request.nextUrl.searchParams.get("role");
  if (!isPreviewRole(role)) {
    return new NextResponse("Invalid role", { status: 400 });
  }

  // Only honor same-origin relative paths from `next`; otherwise fall back to
  // the role's default home so an attacker can't craft an open redirect.
  const rawNext = request.nextUrl.searchParams.get("next");
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : homePathForRole(role);

  const url = request.nextUrl.clone();
  url.pathname = next;
  url.search = "";

  const response = NextResponse.redirect(url);
  response.cookies.set(PREVIEW_COOKIE, role, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
  });
  return response;
}
