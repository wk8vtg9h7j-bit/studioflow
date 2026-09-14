// ============================================================================
// GET /auth/callback?code=...  OR  ?token_hash=...&type=invite|recovery|...
//
// Supabase invite / recovery / confirmation links land here. We establish a
// session (setting the auth cookie) two ways:
//   • token_hash + type  → verifyOtp  (admin invites & email links)
//   • code               → exchangeCodeForSession (PKCE)
// then forward the user to `next` (e.g. the set-new-password page). Runs in a
// route handler so cookies can be written.
// ============================================================================
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") || "/dashboard";

  const supabase = await createClient();
  let authError: string | null = null;

  if (tokenHash && type) {
    // Invite / recovery / signup email links.
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) authError = error.message;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) authError = error.message;
  }

  if (authError) {
    return NextResponse.redirect(
      new URL("/forgot-password?error=expired", url.origin),
    );
  }

  // Only allow same-origin relative redirects.
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
