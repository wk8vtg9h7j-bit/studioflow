// ============================================================================
// RemovePayment — inline "this was entered wrong" control on a payment row.
//
// Deleting the underlying credit_ledger row takes the sale out of revenue and
// takes the clips it granted off the customer, so it is gated behind a typed
// confirmation the same way customer deletion is.
// ============================================================================
"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import { deletePaymentAction, type PaymentActionState } from "./actions";

const initialState: PaymentActionState = {};

export function RemovePayment({
  paymentId,
  name,
}: {
  paymentId: string;
  name: string;
}) {
  const [state, formAction] = useFormState(deletePaymentAction, initialState);
  const [open, setOpen] = useState(false);

  if (state.ok) {
    return (
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
        {state.message ?? "Payment removed."}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-ink-soft underline-offset-2 hover:text-rose-700 hover:underline"
      >
        Remove
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={paymentId} />
      <p className="text-xs text-ink-soft">
        Removes this payment from revenue and takes back the credits it gave{" "}
        {name}.
      </p>
      <div className="flex items-center gap-2">
        <input
          name="confirm"
          className="input h-9 w-28 text-xs"
          placeholder="REMOVE"
          autoComplete="off"
          aria-label="Type REMOVE to confirm"
          required
        />
        <SubmitButton>Remove</SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-secondary"
        >
          Cancel
        </button>
      </div>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {state.error}
        </p>
      )}
    </form>
  );
}
