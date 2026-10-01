import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createOAuthClient,
  parseCustomerConsentState,
} from "@/lib/google/oauth";
import { encryptToken } from "@/lib/google/crypto";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const isCustomerState = rawState?.startsWith("customer:") ?? false;
  const customerId =
    isCustomerState && rawState ? parseCustomerConsentState(rawState) : null;
  const studioId = isCustomerState ? null : rawState;

  const adminBack = (params: string) =>
    NextResponse.redirect(new URL(`/admin/studios?${params}`, url.origin));
  const customerBack = (params: string) =>
    NextResponse.redirect(new URL(`/my-bookings?${params}`, url.origin));
  const back = isCustomerState ? customerBack : adminBack;

  if (oauthError) {
    return back(`error=${encodeURIComponent(`Google: ${oauthError}`)}`);
  }
  if (!code || !rawState) {
    return back("error=Missing+OAuth+code+or+state");
  }
  if (isCustomerState && !customerId) {
    return customerBack("error=Invalid+Google+connection+state");
  }
  if (!isCustomerState && !studioId) {
    return adminBack("error=Missing+studio");
  }

  try {
    const client = createOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      return back("error=Google+did+not+return+a+refresh+token");
    }
    client.setCredentials(tokens);

    let accountEmail: string | null = null;
    try {
      const oauth2 = google.oauth2({ version: "v2", auth: client });
      const me = await oauth2.userinfo.get();
      accountEmail = me.data.email ?? null;
    } catch {
      // Email is helpful for display only; calendar sync does not depend on it.
    }

    const service = createServiceClient();

    if (customerId) {
      const { error: connectionError } = await service
        .from("customer_google_connections")
        .upsert(
          {
            customer_id: customerId,
            google_refresh_token: encryptToken(tokens.refresh_token),
            google_calendar_id: "primary",
            google_account_email: accountEmail,
            google_token_status: "connected",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "customer_id" },
        );

      if (connectionError) {
        return customerBack(
          `error=${encodeURIComponent(
            `Could not save Google connection: ${connectionError.message}`,
          )}`,
        );
      }

      await service
        .from("customers")
        .update({ calendar_auto_add: true })
        .eq("id", customerId);

      const { data: futureSessions } = await service
        .from("sessions")
        .select("id")
        .eq("status", "scheduled")
        .gt("starts_at", new Date().toISOString());

      const sessionIds = (futureSessions ?? []).map((row) => row.id);
      if (sessionIds.length > 0) {
        await service
          .from("bookings")
          .update({ customer_calendar_sync_pending_at: new Date().toISOString() })
          .eq("customer_id", customerId)
          .eq("status", "booked")
          .in("session_id", sessionIds);
      }

      return customerBack("notice=Google+Calendar+connected");
    }

    const { data: studio } = await service
      .from("studios")
      .select("id,slug,google_calendar_id")
      .eq("id", studioId as string)
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
      // Preserve the selected studio calendar if listing calendars fails.
    }

    const { error: updateError } = await service
      .from("studios")
      .update({
        google_refresh_token: encryptToken(tokens.refresh_token),
        google_calendar_id: calendarId,
        google_account_email: accountEmail,
        google_token_status: "connected",
      })
      .eq("id", studioId as string);

    if (updateError) {
      return adminBack(
        `error=${encodeURIComponent(
          `Could not save token: ${updateError.message}`,
        )}`,
      );
    }

    return adminBack("notice=Google+Calendar+connected");
  } catch (err) {
    const message = err instanceof Error ? err.message : "OAuth callback failed";
    return back(`error=${encodeURIComponent(message)}`);
  }
}
