// ============================================================================
// GET /api/google/callback?code=<...>&state=<studioId>
//
// The redirect target Google sends the admin back to after consent. We:
//   1. exchange the one-time `code` for tokens (incl. the long-lived refresh
//      token) via the OAuth2 client,
//   2. resolve which account was connected (email) and which calendar to mirror
//      sessions into (the account's primary calendar),
//   3. encrypt the refresh token and persist it + the calendar id/email against
//      the studio row carried in `state`, flipping google_token_status to
//      "connected".
//
// Runs with no user session (Google calls this URL directly), so all DB writes
// use the service-role client. Any failure redirects back to /admin/studios
// with an error message rather than surfacing a raw 500.
// ============================================================================
import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createServiceClient } from "@/lib/supabase/server";
import { createOAuthClient } from "@/lib/google/oauth";
import { encryptToken } from "@/lib/google/crypto";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const studioId = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const back = (params: string) =>
    NextResponse.redirect(new URL(`/admin/studios?${params}`, url.origin));

  // The admin declined consent, or Google reported a problem.
  if (oauthError) {
    return back(`error=${encodeURIComponent(`Google: ${oauthError}`)}`);
  }
  if (!code || !studioId) {
    return back("error=Missing+code+or+studio");
  }

  try {
    // 1. Exchange the code for tokens. offline + prompt=consent (set on the
    //    consent URL) guarantees a refresh token is present here.
    const client = createOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      return back("error=Google+did+not+return+a+refresh+token");
    }
    client.setCredentials(tokens);

    // 2a. Which Google account did they connect?
    let accountEmail: string | null = null;
    try {
      const oauth2 = google.oauth2({ version: "v2", auth: client });
      const me = await oauth2.userinfo.get();
      accountEmail = me.data.email ?? null;
    } catch {
      // Non-fatal: we can still sync without knowing the email.
    }

    // 2b. Keep StudioFlow pointed at its intentionally selected calendar.
    //     Reconnecting Google must not silently switch Hideaway/Downtown into
    //     the account's primary calendar, which is used by a different studio.
    const service = createServiceClient();
    const { data: studio } = await service
      .from("studios")
      .select("id,slug,google_calendar_id")
      .eq("id", studioId)
      .single();

    let calendarId = studio?.google_calendar_id ?? "primary";
    try {
      const calendar = google.calendar({ version: "v3", auth: client });
      const list = await calendar.calendarList.list();
      const calendars = list.data.items ?? [];

      const savedCalendarIsAvailable =
        studio?.google_calendar_id &&
        calendars.some((item) => item.id === studio.google_calendar_id);

      if (!savedCalendarIsAvailable) {
        const isStudioFlowPilates =
          studio?.slug === "hideaway-pilates" ||
          studio?.slug === "downtown-pilates";

        const sharedStudioFlowCalendar = isStudioFlowPilates
          ? calendars.find((item) => item.summary === "Hideaway and Downtown")
          : null;

        const primary = calendars.find((item) => item.primary);
        calendarId =
          sharedStudioFlowCalendar?.id ??
          primary?.id ??
          studio?.google_calendar_id ??
          "primary";
      }
    } catch {
      // Non-fatal. Preserve the saved calendar ID when possible.
    }

    // 3. Persist against the studio. The refresh token is encrypted at rest.
    const { error: updateError } = await service
      .from("studios")
      .update({
        google_refresh_token: encryptToken(tokens.refresh_token),
        google_calendar_id: calendarId,
        google_account_email: accountEmail,
        google_token_status: "connected",
      })
      .eq("id", studioId);

    if (updateError) {
      return back(
        `error=${encodeURIComponent(`Could not save token: ${updateError.message}`)}`,
      );
    }

    return back("notice=Google+Calendar+connected");
  } catch (err) {
    const message = err instanceof Error ? err.message : "OAuth callback failed";
    return back(`error=${encodeURIComponent(message)}`);
  }
}
