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
import { createHmac, timingSafeEqual } from "node:crypto";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

// Read + write events, and list calendars so the callback can resolve the
// primary calendar id for the connected account.
const STUDIO_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.send",
];

const CUSTOMER_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
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
    scope: STUDIO_SCOPES,
    state: studioId,
    include_granted_scopes: true,
  });
}


function signCustomerState(customerId: string): string {
  const payload = `customer:${customerId}`;
  const signature = createHmac("sha256", required("TOKEN_ENCRYPTION_KEY"))
    .update(payload)
    .digest("base64url");
  return `${payload}:${signature}`;
}

export function parseCustomerConsentState(state: string): string | null {
  const match = state.match(/^customer:([0-9a-f-]{36}):([A-Za-z0-9_-]+)$/i);
  if (!match) return null;

  const customerId = match[1];
  const supplied = Buffer.from(match[2], "utf8");
  const expected = Buffer.from(
    createHmac("sha256", required("TOKEN_ENCRYPTION_KEY"))
      .update(`customer:${customerId}`)
      .digest("base64url"),
    "utf8",
  );

  if (supplied.length !== expected.length) return null;
  return timingSafeEqual(supplied, expected) ? customerId : null;
}

export function buildCustomerConsentUrl(customerId: string): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: CUSTOMER_SCOPES,
    state: signCustomerState(customerId),
    include_granted_scopes: true,
  });
}
