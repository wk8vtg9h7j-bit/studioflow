// ============================================================================
// PrivateClassForm — the client form for scheduling a private (1:1) class.
//
// The customer is chosen with a debounced search (name or phone) that reuses the
// register's customer-search action. Everything else mirrors the standard
// session form: a studio-local datetime, a private class type (which seeds the
// duration), an instructor, and the instructor's pay for the class.
// ============================================================================
"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import {
  schedulePrivateClassAction,
  searchRegisterCustomersAction,
  type RegisterCustomer,
  type SessionActionState,
} from "../actions";

const initialState: SessionActionState = {};

export type StudioOption = { id: string; name: string; timezone: string };
export type ClassTypeOption = {
  id: string;
  name: string;
  default_duration_min: number;
};
export type InstructorOption = { id: string; display_name: string };

export function PrivateClassForm({
  studios,
  classTypes,
  instructors,
}: {
  studios: StudioOption[];
  classTypes: ClassTypeOption[];
  instructors: InstructorOption[];
}) {
  const [state, formAction] = useFormState(
    schedulePrivateClassAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Selected customer (drives the hidden customer_id the action validates).
  const [customer, setCustomer] = useState<RegisterCustomer | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegisterCustomer[]>([]);

  const [durationMin, setDurationMin] = useState<number>(60);

  // Debounced customer search (name or phone). We show the private balance for
  // context, but scheduling here never deducts a credit.
  useEffect(() => {
    const q = query.trim();
    if (!q || customer) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchRegisterCustomersAction(q, "private")
        .then(setResults)
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query, customer]);

  // Reset the whole form after a successful schedule.
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setCustomer(null);
      setQuery("");
      setResults([]);
      setDurationMin(60);
    }
  }, [state.ok]);

  function onClassTypeChange(id: string) {
    const ct = classTypes.find((c) => c.id === id);
    if (ct) setDurationMin(ct.default_duration_min);
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      {/* Customer picker */}
      <div>
        <label className="label">Customer</label>
        {customer ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-stone-300 bg-stone-50 px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">
                {customer.name}
              </p>
              <p className="truncate text-xs text-ink-muted">
                {customer.phone ? `${customer.phone} · ` : ""}
                {customer.credits} private cr
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCustomer(null)}
              className="btn-ghost shrink-0 px-3 py-1.5 text-xs"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input"
              placeholder="Search by name or phone…"
            />
            {query.trim() && results.length === 0 && (
              <p className="mt-2 text-xs text-ink-muted">
                No match. The customer must already exist.
              </p>
            )}
            {results.length > 0 && (
              <ul className="mt-2 divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200">
                {results.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomer(c);
                        setResults([]);
                      }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-stone-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">
                          {c.name}
                        </span>
                        <span className="block truncate text-xs text-ink-muted">
                          {c.phone ? `${c.phone} · ` : ""}
                          {c.credits} private cr
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-medium text-brand-600">
                        Select
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {/* The action validates this; empty until a customer is chosen. */}
        <input type="hidden" name="customer_id" value={customer?.id ?? ""} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="studio_id">
            Studio
          </label>
          <select
            id="studio_id"
            name="studio_id"
            className="input"
            defaultValue=""
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
          <label className="label" htmlFor="class_type_id">
            Private class type
          </label>
          <select
            id="class_type_id"
            name="class_type_id"
            className="input"
            defaultValue=""
            onChange={(e) => onClassTypeChange(e.target.value)}
            required
          >
            <option value="" disabled>
              Choose a class type…
            </option>
            {classTypes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="instructor_id">
          Instructor
        </label>
        <select
          id="instructor_id"
          name="instructor_id"
          className="input"
          defaultValue=""
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="starts_at">
            Starts at
          </label>
          <input
            id="starts_at"
            name="starts_at"
            type="datetime-local"
            className="input"
            required
          />
          <p className="mt-1 text-xs text-ink-soft">
            Entered in the studio&apos;s local time.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="duration_min">
            Duration (min)
          </label>
          <input
            id="duration_min"
            name="duration_min"
            type="number"
            min={5}
            max={480}
            step={5}
            className="input"
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
            required
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="instructor_pay">
          Instructor pay (VND)
        </label>
        <input
          id="instructor_pay"
          name="instructor_pay"
          type="number"
          min={0}
          step={1000}
          className="input"
          placeholder="e.g. 400000"
          required
        />
        <p className="mt-1 text-xs text-ink-soft">
          What the instructor earns for this class. Shown on their Salary page to
          confirm. Booking deducts 1 private credit from the customer.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="notes">
          Notes <span className="text-ink-soft">(optional)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          className="input min-h-[72px] resize-y"
          placeholder="Anything the instructor should know."
        />
      </div>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Private class scheduled. It&rsquo;s on the instructor&rsquo;s schedule
          and the pay is waiting for them to confirm.
        </p>
      )}

      <SubmitButton>Schedule private class</SubmitButton>
    </form>
  );
}
