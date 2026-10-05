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
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";

export async function bookSessionAction(formData: FormData) {
  await requireRole("customer", "/book");
  const vi = (await getLocale()) === "vi";

  const sessionId = String(formData.get("session_id") ?? "").trim();
  const spots = Number(formData.get("spots") ?? "1");
  if (!sessionId) {
    redirect(`/book?error=${encodeURIComponent(vi ? "Thiếu thông tin lớp." : "Missing session.")}`);
  }
  if (!Number.isInteger(spots) || spots < 1 || spots > 2) {
    redirect(`/book?error=${encodeURIComponent(vi ? "Chọn 1 hoặc 2 chỗ." : "Choose 1 or 2 spots.")}`);
  }

  const supabase = await createClient();
  const { data: customerId } = await supabase.rpc("my_customer_id");
  if (!customerId) {
    redirect(`/book?error=${encodeURIComponent(vi ? "Không tìm thấy hồ sơ khách hàng." : "Customer profile not found.")}`);
  }

  const service = createServiceClient();
  const { data: customer } = await service
    .from("customers")
    .select("payment_notice_acknowledged_at")
    .eq("id", customerId)
    .maybeSingle();

  const needsPaymentNotice = !customer?.payment_notice_acknowledged_at;
  const acknowledged =
    String(formData.get("payment_acknowledged") ?? "") === "yes";

  if (needsPaymentNotice && !acknowledged) {
    redirect(
      `/book?error=${encodeURIComponent(
        vi
          ? "Vui lòng xác nhận rằng tín dụng khởi đầu không phải là lớp miễn phí và bạn sẽ thanh toán sau buổi tập nếu chưa có gói trả phí."
          : "Please confirm that the starter credit is not a free class and that payment is due after class if you are not covered by a paid package.",
      )}`,
    );
  }

  const { data, error } = await supabase.rpc("book_session", {
    p_session_id: sessionId,
    p_spots: spots,
  });

  if (error) {
    redirect(`/book?error=${encodeURIComponent(error.message)}`);
  }

  if (needsPaymentNotice && acknowledged) {
    await service
      .from("customers")
      .update({ payment_notice_acknowledged_at: new Date().toISOString() })
      .eq("id", customerId);
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
      ? vi
        ? `Lớp đã đầy — bạn đang trong danh sách chờ cho ${spots} chỗ.`
        : `Class is full — you're on the waitlist for ${spots} spot${spots === 1 ? "" : "s"}`
      : vi
        ? `Đã đặt ${spots} chỗ. Nếu chưa có gói trả phí, vui lòng thanh toán sau buổi tập.`
        : `Booked ${spots} spot${spots === 1 ? "" : "s"}. If this booking is not covered by a paid package, payment is due after class.`;
  redirect(`/book?notice=${encodeURIComponent(notice)}`);
}
