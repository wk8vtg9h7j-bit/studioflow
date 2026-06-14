// ============================================================================
// Payroll (admin) server actions.
//
// Payroll rows aren't created from a form — they're computed. recalc_payroll()
// resolves the most specific pay rule for a session, counts attendance, and
// upserts the session_payroll row. From there the record walks a status flow:
//
//   pending → instructor_confirmed → admin_approved → paid   (+ disputed)
//
// The instructor confirms their own count via confirm_payroll(); the two later
// admin-only transitions (approve, mark paid) have no dedicated RPC, so we make
// them with direct UPDATEs — permitted by the "payroll admin all" RLS policy,
// which grants is_admin() full access. Every action re-checks the admin role.
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// (Re)compute the payroll row for a session: re-resolve the pay rule, refresh
// the attendance count, and recompute the amount. Optionally an admin can pin
// an explicit attendance override (e.g. a walk-in not captured by a booking).
export async function recalcPayrollAction(formData: FormData) {
  await requireRole("admin", "/admin/payroll");

  const sessionId = String(formData.get("session_id") ?? "");
  if (!sessionId) return;

  // An empty field means "use the live booking count"; a number pins an override.
  const rawAttendance = String(formData.get("attendance") ?? "").trim();
  const attendance = rawAttendance === "" ? null : Number(rawAttendance);
  const p_attendance =
    attendance !== null && Number.isFinite(attendance) && attendance >= 0
      ? Math.floor(attendance)
      : null;

  const supabase = await createClient();
  await supabase.rpc("recalc_payroll", {
    p_session_id: sessionId,
    p_attendance,
  });

  revalidatePath("/admin/payroll");
}

// Admin sign-off: instructor_confirmed → admin_approved. We don't gate on the
// current status here (an admin can approve straight from pending if they want
// to), but we stamp the approval time so the audit trail is honest.
export async function approvePayrollAction(formData: FormData) {
  await requireRole("admin", "/admin/payroll");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("session_payroll")
    .update({
      status: "admin_approved",
      admin_approved_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath("/admin/payroll");
}

// Final transition: admin_approved → paid. Records when the money actually went
// out so the row stops appearing in the "owed" view.
export async function markPaidAction(formData: FormData) {
  await requireRole("admin", "/admin/payroll");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("session_payroll")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath("/admin/payroll");
}

// Flag a row for review (e.g. the instructor's confirmed count doesn't match the
// roster). Parks it in 'disputed' until an admin recalcs or approves it.
export async function disputePayrollAction(formData: FormData) {
  await requireRole("admin", "/admin/payroll");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("session_payroll")
    .update({ status: "disputed" })
    .eq("id", id);

  revalidatePath("/admin/payroll");
}
