"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { queueCustomerBookingCalendarSync } from "@/lib/bookingPaymentStatus.server";

const schema = z.object({
  booking_id: z.string().uuid(),
  kind: z.enum(["single", "package"]),
  package_id: z.string().uuid().optional().or(z.literal("")),
  payment_method: z.enum(["qr", "card", "cash"]),
  amount_cents: z.coerce.number().int().positive().max(100_000_000),
});

export type CheckoutState = {
  ok?: boolean;
  error?: string;
  remainingCredits?: number;
  grantedCredits?: number;
};

export async function recordCheckoutAction(
  _previous: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const profile = await requireRole(["admin", "instructor"]);
  const parsed = schema.safeParse({
    booking_id: formData.get("booking_id"),
    kind: formData.get("kind"),
    package_id: formData.get("package_id") ?? "",
    payment_method: formData.get("payment_method"),
    amount_cents: formData.get("amount_cents"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Invalid checkout." };
  const input = parsed.data;
  if (input.kind === "package" && !input.package_id) {
    return { error: "Choose a package." };
  }
  const svc = createServiceClient();
  // Identify the session once. Admins may collect payment for any class;
  // instructors may only collect for their own assigned classes.
  const { data: booking, error: bookingError } = await svc.from("bookings")
    .select("customer_id,session:sessions(instructor_id)")
    .eq("id", input.booking_id).maybeSingle();
  if (bookingError) return { error: bookingError.message };
  const session = (booking as unknown as {
    session?: { instructor_id: string | null } | null;
  } | null)?.session;
  if (!session) return { error: "Could not find the booking's class." };

  if (profile.role === "instructor") {
    const { data: instructor, error: instructorError } = await svc
      .from("instructors").select("id").eq("profile_id", profile.id).maybeSingle();
    if (instructorError || !instructor) return { error: "Instructor account not found." };
    if (session.instructor_id !== instructor.id) {
      return { error: "Only the assigned instructor may collect payment from this class." };
    }
  }

  // The ledger's sold_by field drives the immutable 2.5% commission snapshot
  // and both salary/payroll dashboards. For an admin-confirmed package purchase,
  // credit the instructor who taught the class, not the staff member who pressed
  // Confirm. Never attribute an unassigned class to an arbitrary instructor.
  let creditedSeller = profile.id;
  if (profile.role === "admin" && input.kind === "package" && session.instructor_id) {
    const { data: teacher, error: teacherError } = await svc
      .from("instructors").select("profile_id")
      .eq("id", session.instructor_id).maybeSingle();
    if (teacherError) return { error: teacherError.message };
    if (!teacher?.profile_id) {
      return { error: "Assign a linked instructor account before recording this package payment so the 2.5% commission is credited correctly." };
    }
    creditedSeller = teacher.profile_id;
  }

  const { data, error } = await svc.rpc("record_class_checkout", {
    p_booking: input.booking_id,
    p_kind: input.kind,
    p_package: input.kind === "package" ? input.package_id : null,
    p_payment_method: input.payment_method,
    p_amount_cents: input.amount_cents,
    p_sold_by: creditedSeller,
  });
  if (error) return { error: error.message };
  const receipt = data as { remaining_credits?: number; granted_credits?: number } | null;
  // Queue existing Google Calendar payment-label updates, without modifying
  // any external calendar directly in this checkout request.
  const { data: booking } = await svc.from("bookings")
    .select("customer_id").eq("id", input.booking_id).maybeSingle();
  if (booking) {
    try { await queueCustomerBookingCalendarSync(booking.customer_id); }
    catch (syncError) { console.warn("Checkout saved; calendar queue failed", syncError); }
  }
  for (const path of ["/admin", "/admin/today", "/admin/sessions", "/admin/insights", "/admin/customers",
    "/admin/payments", "/admin/marketing", "/instructor/today", "/instructor/customers", "/instructor/salary"]) {
    revalidatePath(path);
  }
  return { ok: true, remainingCredits: receipt?.remaining_credits,
    grantedCredits: receipt?.granted_credits };
}

export async function markDeskAttendanceAction(
  _previous: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const profile = await requireRole(["admin", "instructor"]);
  const bookingId = z.string().uuid().safeParse(formData.get("booking_id"));
  const status = z.enum(["attended", "no_show", "booked"]).safeParse(formData.get("status"));
  if (!bookingId.success || !status.success) return { error: "Invalid attendance update." };
  const svc = createServiceClient();
  const { data: booking, error: bookingError } = await svc.from("bookings")
    .select("id,status,session:sessions(id,starts_at,instructor_id)")
    .eq("id", bookingId.data).maybeSingle();
  if (bookingError || !booking) return { error: "Booking not found." };
  const row = booking as unknown as {status:string;session:{id:string;starts_at:string;instructor_id:string|null}|null};
  if (!row.session || !["booked","attended","no_show"].includes(row.status)) {
    return { error: "Only active bookings can be checked in." };
  }
  if (profile.role === "instructor") {
    const { data: instructor } = await svc.from("instructors")
      .select("id").eq("profile_id",profile.id).maybeSingle();
    if (!instructor || row.session.instructor_id !== instructor.id) {
      return { error: "You can only check in your own students." };
    }
  }
  if (status.data !== "booked" && Date.parse(row.session.starts_at) > Date.now()) {
    return { error: "Check-in opens when the class starts." };
  }
  const { error } = await svc.from("bookings")
    .update({ status: status.data, checked_in_at: status.data === "attended"
       ? new Date().toISOString() : null })
    .eq("id", bookingId.data).eq("status", row.status);
  if (error) return { error: error.message };
  revalidatePath("/admin/today");
  revalidatePath("/instructor/today");
  revalidatePath("/admin/sessions");
  return { ok: true };
}
