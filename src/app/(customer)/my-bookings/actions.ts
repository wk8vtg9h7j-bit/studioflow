// ============================================================================
// Cancel-booking action. Like the booking side, all the rules — refunding the
// member's credits and promoting the next person off the waitlist — live in the
// cancel_booking RPC so they happen atomically. Here we authenticate the caller
// as a customer, call the RPC, and surface any human-readable error back to the
// page via a redirect query param.
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notifyBookingCancelled } from "@/lib/notify";
import { LOCALE_COOKIE, getDict, normalizeLocale } from "@/lib/i18n";

// Members only get their credit back when they cancel more than this far ahead
// of the class — same window the cancel_booking RPC enforces (migration 0012).
const REFUND_WINDOW_MS = 3 * 60 * 60 * 1000;

export async function cancelBookingAction(formData: FormData) {
  const profile = await requireRole("customer", "/book");

  const bookingId = String(formData.get("booking_id") ?? "").trim();
  if (!bookingId) {
    redirect("/my-bookings?error=Missing+booking");
  }

  const supabase = await createClient();

  // Grab the booking before cancelling — the cancel RPC rewrites the row, so we
  // read up front both which class to alert about and the two facts that decide
  // whether a refund actually happens (credits at stake + how soon class starts).
  const { data: bk } = await supabase
    .from("bookings")
    .select("session_id,credits_spent,session:sessions(starts_at)")
    .eq("id", bookingId)
    .single<{
      session_id: string | null;
      credits_spent: number | null;
      session: { starts_at: string } | null;
    }>();

  const { error } = await supabase.rpc("cancel_booking", {
    p_booking_id: bookingId,
  });

  if (error) {
    redirect(`/my-bookings?error=${encodeURIComponent(error.message)}`);
  }

  // Fire-and-forget email alert to admins/instructor (see notify.ts). This can
  // never block the cancellation: it no-ops without RESEND_API_KEY and swallows
  // all errors internally.
  if (bk?.session_id) {
    await notifyBookingCancelled(String(bk.session_id), {
      customerName: profile.full_name ?? undefined,
    });
  }

  revalidatePath("/my-bookings");
  revalidatePath("/book");

  // Only claim a refund when one really happened: the member must have spent
  // credits (waitlist spots cost none) and be outside the 3-hour window.
  const refunded =
    (bk?.credits_spent ?? 0) > 0 &&
    !!bk?.session?.starts_at &&
    Date.parse(bk.session.starts_at) > Date.now() + REFUND_WINDOW_MS;

  const cookieStore = await cookies();
  const dict = getDict(normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value));
  const notice = refunded
    ? dict.booking_cancelled_refunded
    : dict.booking_cancelled_no_refund;

  redirect(`/my-bookings?notice=${encodeURIComponent(notice)}`);
}
