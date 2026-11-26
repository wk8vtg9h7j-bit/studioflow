// ============================================================================
// GET /auth/callback?code=...  OR  ?token_hash=...&type=invite|recovery|...
//
// Supabase invite / recovery / confirmation links land here. We establish a
// session (setting the auth cookie) two ways:
//   • token_hash + type  → verifyOtp  (admin invites & email links)
//   • code               → exchangeCodeForSession (PKCE)
// then forward the user to `next` (e.g. the set-new-password page). Runs in a
// route handler so cookies can be written.
//
// EXCEPT for password recovery — see below.
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

  // Only allow same-origin relative redirects.
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  // ------------------------------------------------------------------------
  // Password recovery: do NOT spend the token here.
  //
  // These tokens are single-use, and opening the link is a plain GET. Email
  // scanners, link previewers and browser prefetchers all issue GETs, and they
  // reach the link before the member does — so the token was being consumed by
  // a machine and the member arrived at a dead link. The auth logs show exactly
  // that: a successful exchange, then "One-time token not found" seconds later.
  //
  // So for this one flow we hand the token on to /reset-password untouched and
  // let it be exchanged when the form is submitted. A scanner never submits a
  // form, so the token survives until a person actually uses it.
  // ------------------------------------------------------------------------
  if (safeNext.startsWith("/reset-password")) {
    const target = new URL(safeNext, url.origin);
    if (code) target.searchParams.set("code", code);
    if (tokenHash) {
      target.searchParams.set("token_hash", tokenHash);
      if (type) target.searchParams.set("type", type);
    }
    return NextResponse.redirect(target);
  }

  const supabase = await createClient();
  let authError: string | null = null;

  if (tokenHash && type) {
    // Invite / confirmation email links.
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

  return NextResponse.redirect(new URL(safeNext, url.origin));
}
