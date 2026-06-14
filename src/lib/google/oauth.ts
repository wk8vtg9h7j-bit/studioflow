// ============================================================================
// Google OAuth2 client factory + scope/URL helpers. One studio = one Google
// Calendar, so the OAuth flow is initiated per-studio: we carry the studio id
// through the `state` parameter and store the resulting refresh token against
// that studio row.
//
// We request offline access with prompt=consent so Google always returns a
// refresh token (without consent it omits the refresh token on repeat grants),
// and the calendar scope so we can create/update/delete events on the studio's
// calendar.
// ============================================================================
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

// Read + write events, and list calendars so the callback can resolve the
// primary calendar id for the connected account.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// A fresh OAuth2 client. googleapis mutates credentials on the instance, so we
// never share one across requests — always mint a new client.
export function createOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    required("GOOGLE_CLIENT_ID"),
    required("GOOGLE_CLIENT_SECRET"),
    required("GOOGLE_OAUTH_REDIRECT_URI"),
  );
}

// The consent URL we send the admin to. `studioId` rides along in `state` so
// the callback knows which studio to attach the token to. offline + consent
// guarantees a refresh token comes back.
export function buildConsentUrl(studioId: string): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: studioId,
    include_granted_scopes: true,
  });
}
