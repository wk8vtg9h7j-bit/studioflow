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
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notifyBookingCancelled } from "@/lib/notify";

export async function cancelBookingAction(formData: FormData) {
  const profile = await requireRole("customer", "/book");

  const bookingId = String(formData.get("booking_id") ?? "").trim();
  if (!bookingId) {
    redirect("/my-bookings?error=Missing+booking");
  }

  const supabase = await createClient();

  // Grab the session before cancelling — the cancel RPC may change the row, so
  // we read the session_id up front to know which class to alert about.
  const { data: bk } = await supabase
    .from("bookings")
    .select("session_id")
    .eq("id", bookingId)
    .single();

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
  redirect("/my-bookings?notice=Booking+cancelled+and+credits+refunded");
}
