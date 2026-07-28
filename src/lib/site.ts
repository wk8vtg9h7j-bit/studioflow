// ============================================================================
// Resolve the app's public origin (scheme + host) from the incoming request.
//
// Used to build absolute redirect URLs for auth emails (instructor invites,
// password resets). Deriving it from the request is robust across domains and
// avoids depending on a NEXT_PUBLIC_APP_URL env var that may be unset — which
// would otherwise produce a blank redirect and bounce users to the front page.
// ============================================================================
import { headers } from "next/headers";

export function siteOrigin(): string {
  const h = headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL || "";
}
