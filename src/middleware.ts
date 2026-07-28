// ============================================================================
// Root middleware — runs on every request (except static assets) to keep the
// Supabase auth session fresh and guard protected route prefixes.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Marketing hostnames whose bare "/" should serve the static landing page in
// public/ instead of the CRM's App Router root. Every other path (/book, the
// admin/customer app, APIs) falls through to the normal Supabase-session flow
// so the same Vercel project powers both the marketing site and the CRM.
const LANDING_BY_HOST: Record<string, string> = {
  "hideawaypilates.com": "/hideaway.html",
  "www.hideawaypilates.com": "/hideaway.html",
  "downtownpilatesdn.com": "/downtown.html",
  "www.downtownpilatesdn.com": "/downtown.html",
};

export async function middleware(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const { pathname } = request.nextUrl;

  // Only rewrite the bare landing path; /book and everything else pass through.
  const landing = LANDING_BY_HOST[host];
  if (landing && pathname === "/") {
    return NextResponse.rewrite(new URL(landing, request.url));
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    // Match everything except Next internals, the favicon, and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
