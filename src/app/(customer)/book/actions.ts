// ============================================================================
// Booking action — the customer side of the booking flow is intentionally thin:
// all the rules (seats, waitlist, credit cost, duplicate guard) live in the
// book_session RPC so they're enforced atomically in the database. Here we just
// authenticate the caller as a customer, call the RPC, and surface its
// human-readable error back to the page via a redirect query param.
//
// The RPC raises messages like "Not enough credits (need 1, have 0)" or
// "You already have a booking for this class" — we pass those straight through
// so the member sees exactly why a booking didn't go through.
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function bookSessionAction(formData: FormData) {
  await requireRole("customer", "/book");

  const sessionId = String(formData.get("session_id") ?? "").trim();
  const spots = Number(formData.get("spots") ?? "1");
  if (!sessionId) {
    redirect("/book?error=Missing+session");
  }
  if (!Number.isInteger(spots) || spots < 1 || spots > 2) {
    redirect("/book?error=Choose+1+or+2+spots");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("book_session", {
    p_session_id: sessionId,
    p_spots: spots,
  });

  if (error) {
    redirect(`/book?error=${encodeURIComponent(error.message)}`);
  }

  // book_session returns the booking row; its status tells us whether the
  // member got a seat or landed on the waitlist, so we can confirm accordingly.
  const status =
    data && typeof data === "object" && "status" in data
      ? String((data as { status: unknown }).status)
      : "booked";

  revalidatePath("/book");
  revalidatePath("/my-bookings");

  const notice =
    status === "waitlisted"
      ? `Class is full — you're on the waitlist for ${spots} spot${spots === 1 ? "" : "s"}`
      : `Booked ${spots} spot${spots === 1 ? "" : "s"}! See you in class`;
  redirect(`/book?notice=${encodeURIComponent(notice)}`);
}
