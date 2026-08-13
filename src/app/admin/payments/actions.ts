// ============================================================================
// Payments server actions.
//
// A package sale is exactly one `credit_ledger` row (reason = 'purchase') that
// carries both the money (via the joined package price) and the clips (delta).
// So removing a mis-entered payment is a single delete: the revenue disappears
// from the daily sheet AND the credits it granted come off the customer's
// balance, because credit_balance() simply sums the remaining ledger rows.
//
// Uses the service client: RLS does not grant admins a blanket delete on
// credit_ledger (same approach as deleteCustomerAction).
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

export type PaymentActionState = { error?: string; ok?: boolean; message?: string };

const DeletePaymentSchema = z.object({
  id: z.string().uuid("Could not identify which payment to remove."),
  confirm: z.literal("REMOVE", {
    errorMap: () => ({ message: "Type REMOVE to confirm." }),
  }),
});

export async function deletePaymentAction(
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  await requireRole("admin", "/admin/payments");

  const parsed = DeletePaymentSchema.safeParse({
    id: formData.get("id"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { id } = parsed.data;
  const svc = createServiceClient();

  // Only purchase rows are shown on this page; scoping the delete to them means
  // a stray id can never wipe a booking deduction or a manual adjustment.
  const { error } = await svc
    .from("credit_ledger")
    .delete()
    .eq("id", id)
    .eq("reason", "purchase");

  if (error) return { error: error.message };

  revalidatePath("/admin/payments");
  revalidatePath("/admin/customers");
  return {
    ok: true,
    message: "Payment removed — revenue and the credits it granted are gone.",
  };
}
