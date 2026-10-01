import { NextResponse } from "next/server";
import { google } from "googleapis";
import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { createOAuthClient } from "@/lib/google/oauth";
import { decryptToken } from "@/lib/google/crypto";

export async function POST(request: Request) {
  const profile = await requireRole("customer", "/my-bookings");
  const url = new URL(request.url);
  const service = createServiceClient();

  const { data: customer } = await service
    .from("customers")
    .select("id")
    .eq("profile_id", profile.id)
    .single();

  if (!customer) {
    return NextResponse.redirect(
      new URL("/my-bookings?error=Customer+profile+not+found", url.origin),
    );
  }

  const { data: connection } = await service
    .from("customer_google_connections")
    .select("google_refresh_token,google_calendar_id")
    .eq("customer_id", customer.id)
    .maybeSingle();

  if (connection?.google_refresh_token) {
    try {
      const client = createOAuthClient();
      client.setCredentials({
        refresh_token: decryptToken(connection.google_refresh_token),
      });
      const calendar = google.calendar({ version: "v3", auth: client });
      const calendarId = connection.google_calendar_id || "primary";

      const { data: bookings } = await service
        .from("bookings")
        .select("id,customer_google_event_id,session:sessions(starts_at)")
        .eq("customer_id", customer.id)
        .not("customer_google_event_id", "is", null);

      const now = Date.now();
      for (const raw of bookings ?? []) {
        const booking = raw as unknown as {
          id: string;
          customer_google_event_id: string | null;
          session: { starts_at: string } | null;
        };
        if (
          !booking.customer_google_event_id ||
          !booking.session ||
          Date.parse(booking.session.starts_at) <= now
        ) {
          continue;
        }
        try {
          await calendar.events.delete({
            calendarId,
            eventId: booking.customer_google_event_id,
          });
        } catch {
          // Disconnect must still succeed if an event was already removed.
        }
      }
    } catch {
      // Best effort cleanup. The connection is removed even if Google revoked it.
    }
  }

  await service
    .from("bookings")
    .update({
      customer_google_event_id: null,
      customer_calendar_sync_pending_at: null,
    })
    .eq("customer_id", customer.id);

  await service
    .from("customer_google_connections")
    .delete()
    .eq("customer_id", customer.id);

  await service
    .from("customers")
    .update({ calendar_auto_add: false })
    .eq("id", customer.id);

  return NextResponse.redirect(
    new URL("/my-bookings?notice=Google+Calendar+disconnected", url.origin),
    303,
  );
}
