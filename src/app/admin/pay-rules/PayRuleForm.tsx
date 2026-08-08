// ============================================================================
// PayRuleForm — author a per-instructor, per-studio tiered pay rate.
//
// This is the surface where the admin answers: "for THIS instructor, at THIS
// studio, for (optionally) THIS class type, how much do they earn when 1, 2, 3,
// or 4+ students show up?" The four headcount amounts are assembled by the
// server action into the `tiered` band shape compute_pay() reads.
//
// Mirrors SessionForm's useFormState shape: the action returns { ok } on
// success, which resets a create form and calls onDone so the page can close
// the editor.
// ============================================================================
"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import type { PayRule } from "@/lib/types";
import {
  createPayRuleAction,
  updatePayRuleAction,
  type PayRuleActionState,
} from "./actions";

export type StudioOption = { id: string; name: string };
export type InstructorOption = { id: string; display_name: string };
export type ClassTypeOption = { id: string; name: string };

const initialState: PayRuleActionState = {};

export function PayRuleForm({
  rule,
  studios,
  instructors,
  classTypes,
  onDone,
}: {
  rule?: PayRule;
  studios: StudioOption[];
  instructors: InstructorOption[];
  classTypes: ClassTypeOption[];
  onDone?: () => void;
}) {
  const editing = Boolean(rule);
  const action = editing ? updatePayRuleAction : createPayRuleAction;
  const [state, formAction] = useFormState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // On success: a fresh create form resets; an edit just notifies the parent
  // so it can collapse the editor back to the row.
  useEffect(() => {
    if (state.ok) {
      if (!editing) formRef.current?.reset();
      onDone?.();
    }
  }, [state.ok, editing, onDone]);

  // Pull the four per-headcount amounts back out of the stored tier bands so the
  // edit form pre-fills with what the admin last saved. Bands are
  // [{min:1,max:1},{min:2,max:2},{min:3,max:3},{min:4}] — index by min.
  const tierAmount = (min: number): string => {
    const band = rule?.tiers?.find((t) => t.min === min);
    return band ? String(band.amount) : "";
  };

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {editing && <input type="hidden" name="id" value={rule!.id} />}

      <div>
        <label className="label" htmlFor="name">
          Rule name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          className="input"
          defaultValue={rule?.name ?? ""}
          placeholder="e.g. Anna · Shoreditch · Reformer"
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="studio_id">
          Studio
        </label>
        <select
          id="studio_id"
          name="studio_id"
          className="input"
          defaultValue={rule?.studio_id ?? ""}
          required
        >
          <option value="" disabled>
            Choose a studio…
          </option>
          {studios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="instructor_id">
          Instructor
        </label>
        <select
          id="instructor_id"
          name="instructor_id"
          className="input"
          defaultValue={rule?.instructor_id ?? ""}
          required
        >
          <option value="" disabled>
            Choose an instructor…
          </option>
          {instructors.map((i) => (
            <option key={i.id} value={i.id}>
              {i.display_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="class_type_id">
          Class type <span className="text-ink-soft">(optional)</span>
        </label>
        <select
          id="class_type_id"
          name="class_type_id"
          className="input"
          defaultValue={rule?.class_type_id ?? ""}
        >
          <option value="">All class types</option>
          {classTypes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* The heart of the rule: what the instructor earns per headcount. */}
      <fieldset className="space-y-3 rounded-xl border border-stone-200 p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
          Pay by students in class
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <AmountField name="amount_1" label="1 student" value={tierAmount(1)} />
          <AmountField name="amount_2" label="2 students" value={tierAmount(2)} />
          <AmountField name="amount_3" label="3 students" value={tierAmount(3)} />
          <AmountField
            name="amount_4"
            label="4+ students"
            value={tierAmount(4)}
          />
        </div>
        <p className="text-xs text-ink-soft">
          A class with 0 students pays nothing. The 4+ band covers any class with
          four or more attendees.
        </p>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="currency">
            Currency
          </label>
          <input
            id="currency"
            name="currency"
            type="text"
            className="input"
            maxLength={3}
            defaultValue={rule?.currency ?? "GBP"}
            placeholder="GBP"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="priority">
            Priority
          </label>
          <input
            id="priority"
            name="priority"
            type="number"
            min={0}
            max={1000}
            step={1}
            className="input"
            defaultValue={rule?.priority ?? 0}
            required
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="active"
          defaultChecked={rule?.active ?? true}
          className="h-4 w-4 rounded border-stone-300"
        />
        Active — used when computing pay for this studio
      </label>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <SubmitButton>{editing ? "Save changes" : "Create pay rule"}</SubmitButton>
    </form>
  );
}

function AmountField({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="number"
        min={0}
        step="0.01"
        className="input"
        defaultValue={value}
        placeholder="0.00"
        required
      />
    </div>
  );
}
