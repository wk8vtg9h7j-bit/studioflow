// ============================================================================
// Root middleware — runs on every request (except static assets) to keep the
// Supabase auth session fresh and guard protected route prefixes.
// ============================================================================
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Match everything except Next internals, the favicon, and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
