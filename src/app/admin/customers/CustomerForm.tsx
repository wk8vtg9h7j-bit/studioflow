// ============================================================================
// CustomerForm — the inline editor for a single CRM record.
//
// There is no "create" mode: customers arrive through public sign-up. This
// form only ever edits, surfacing the fields the front desk actually curates
// (status, tags, notes, the personal details kept on file). Validation errors
// come back from the server action and render inline.
// ============================================================================
"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import type { Customer } from "@/lib/types";
import { updateCustomerAction, type CustomerActionState } from "./actions";

const initialState: CustomerActionState = {};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export function CustomerForm({
  customer,
  onDone,
}: {
  customer: Customer;
  onDone?: () => void;
}) {
  const [state, formAction] = useFormState(updateCustomerAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) onDone?.();
  }, [state.ok, onDone]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={customer.id} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`status-${customer.id}`}>
            Status
          </label>
          <select
            id={`status-${customer.id}`}
            name="status"
            className="input"
            defaultValue={customer.status}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor={`source-${customer.id}`}>
            Source <span className="text-ink-soft">(optional)</span>
          </label>
          <input
            id={`source-${customer.id}`}
            name="source"
            className="input"
            placeholder="Instagram, referral…"
            defaultValue={customer.source ?? ""}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor={`tags-${customer.id}`}>
          Tags <span className="text-ink-soft">(comma separated)</span>
        </label>
        <input
          id={`tags-${customer.id}`}
          name="tags"
          className="input"
          placeholder="vip, prenatal, beginner"
          defaultValue={customer.tags.join(", ")}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`dob-${customer.id}`}>
            Date of birth <span className="text-ink-soft">(optional)</span>
          </label>
          <input
            id={`dob-${customer.id}`}
            name="date_of_birth"
            type="date"
            className="input"
            defaultValue={customer.date_of_birth ?? ""}
          />
        </div>

        <div>
          <label className="label" htmlFor={`emergency-${customer.id}`}>
            Emergency contact <span className="text-ink-soft">(optional)</span>
          </label>
          <input
            id={`emergency-${customer.id}`}
            name="emergency_contact"
            className="input"
            placeholder="Jamie Doe · 555-0102"
            defaultValue={customer.emergency_contact ?? ""}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor={`notes-${customer.id}`}>
          Notes <span className="text-ink-soft">(internal)</span>
        </label>
        <textarea
          id={`notes-${customer.id}`}
          name="notes"
          className="input min-h-[72px] resize-y"
          placeholder="Recovering from a knee injury — avoid deep lunges."
          defaultValue={customer.notes ?? ""}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="marketing_opt_in"
          className="h-4 w-4 rounded border-ink-soft/40 text-brand-600 focus:ring-brand-600"
          defaultChecked={customer.marketing_opt_in}
        />
        Opted in to marketing emails
      </label>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <SubmitButton>Save changes</SubmitButton>
        {onDone && (
          <button type="button" className="btn btn-ghost" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
