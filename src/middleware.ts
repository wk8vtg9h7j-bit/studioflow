// ============================================================================
// Root middleware — preview diagnostic branch.
//
// This version intentionally avoids importing the Supabase auth middleware so
// we can verify whether the Edge middleware crash is caused by that dependency
// or by Vercel routing itself. Marketing-domain rewrites are preserved.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";

const LANDING_BY_HOST: Record<string, string> = {
  "hideawaypilates.com": "/hideaway.html",
  "www.hideawaypilates.com": "/hideaway.html",
  "downtownpilatesdn.com": "/downtown.html",
  "www.downtownpilatesdn.com": "/downtown.html",
};

export function middleware(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const { pathname } = request.nextUrl;

  const landing = LANDING_BY_HOST[host];
  if (landing && pathname === "/") {
    return NextResponse.rewrite(new URL(landing, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
