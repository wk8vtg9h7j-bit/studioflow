// ============================================================================
// Instructor server actions.
//
// Instructors don't author payroll rows — admins compute them. The one write an
// instructor owns is *confirming their own count*: the move
//
//   pending → instructor_confirmed
//
// done through the confirm_payroll() RPC. The RPC takes a PAYROLL ROW ID (not a
// session id), self-authorizes against my_instructor_id() and rejects rows that
// aren't the caller's, and optionally accepts an attendance figure the
// instructor wants to stand behind. We re-check the instructor role here as
// defence in depth; RLS is the real guard.
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Confirm a payroll row's attendance/amount. Optionally an instructor can pin
// the headcount they actually taught (e.g. a walk-in) before confirming; an
// empty field leaves the computed count untouched.
export async function confirmPayrollAction(formData: FormData) {
  await requireRole("instructor", "/instructor/salary");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Blank → confirm the count as computed; a number → confirm that headcount.
  const rawAttendance = String(formData.get("attendance") ?? "").trim();
  const attendance = rawAttendance === "" ? null : Number(rawAttendance);
  const p_attendance =
    attendance !== null && Number.isFinite(attendance) && attendance >= 0
      ? Math.floor(attendance)
      : null;

  const supabase = await createClient();
  await supabase.rpc("confirm_payroll", {
    p_payroll_id: id,
    p_attendance,
  });

  revalidatePath("/instructor");
  revalidatePath("/instructor/salary");
}
