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

export async function cancelBookingAction(formData: FormData) {
  await requireRole("customer", "/book");

  const bookingId = String(formData.get("booking_id") ?? "").trim();
  if (!bookingId) {
    redirect("/my-bookings?error=Missing+booking");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_booking", {
    p_booking_id: bookingId,
  });

  if (error) {
    redirect(`/my-bookings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/my-bookings");
  revalidatePath("/book");
  redirect("/my-bookings?notice=Booking+cancelled+and+credits+refunded");
}
