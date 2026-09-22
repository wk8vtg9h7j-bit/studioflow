// ============================================================================
// Cancel-booking action. Refunding the member's credits and promoting the next
// person off the waitlist live in the cancel_booking RPC so they happen
// atomically. The one rule we enforce here is the cancellation window: members
// may only cancel while the class is still more than three hours away. Inside
// that window the spot stays held and the credit stays spent, so we refuse the
// cancellation outright rather than calling the RPC and refunding.
//
// The my-bookings page hides the cancel button inside the window too, but that
// is only a courtesy — this check is the actual enforcement.
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";

// Keep in step with CANCEL_WINDOW_MS on the my-bookings page.
const CANCEL_WINDOW_MS = 3 * 60 * 60 * 1000;

export async function cancelBookingAction(formData: FormData) {
  await requireRole("customer", "/book");
  const vi = (await getLocale()) === "vi";

  const bookingId = String(formData.get("booking_id") ?? "").trim();
  if (!bookingId) {
    redirect(`/my-bookings?error=${encodeURIComponent(vi ? "Thiếu thông tin đặt lớp." : "Missing booking.")}`);
  }

  const supabase = await createClient();

  // RLS scopes this to the caller's own bookings, so a member can't probe
  // anyone else's. We only need the start time to check the window.
  const { data: bookingRow } = await supabase
    .from("bookings")
    .select("id,session:sessions(starts_at)")
    .eq("id", bookingId)
    .maybeSingle();

  const booking = bookingRow as unknown as {
    id: string;
    session: { starts_at: string } | null;
  } | null;

  if (!booking) {
    redirect(`/my-bookings?error=${encodeURIComponent(vi ? "Không tìm thấy lượt đặt lớp." : "Booking not found.")}`);
  }

  const startsAt = booking.session?.starts_at;
  if (startsAt && Date.parse(startsAt) - Date.now() <= CANCEL_WINDOW_MS) {
    redirect(
      `/my-bookings?error=${encodeURIComponent(
        vi
          ? "Lớp bắt đầu trong vòng 3 giờ nên không thể hủy nữa và tín dụng vẫn được tính."
          : "This class starts within 3 hours, so it can no longer be cancelled and the credit stays used.",
      )}`,
    );
  }

  const { error } = await supabase.rpc("cancel_booking", {
    p_booking_id: bookingId,
  });

  if (error) {
    redirect(`/my-bookings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/my-bookings");
  revalidatePath("/book");
  redirect(
    `/my-bookings?notice=${encodeURIComponent(
      vi ? "Đã hủy đặt lớp và hoàn lại tín dụng." : "Booking cancelled and credits refunded.",
    )}`,
  );
}
