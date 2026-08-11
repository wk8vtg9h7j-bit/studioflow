// ============================================================================
// RegisterPanel — the per-class "register". Reception checks people into a
// specific session. Most people already have a profile (from booking), so the
// primary flow is "find member" by name or phone → check in (deducts a credit,
// marks Attended). New walk-ins pay at the door (single class or a package, by
// QR/Card/Cash). Data reloads after each successful check-in.
// ============================================================================
"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import { formatMoney } from "@/lib/format";
import {
  getRegisterDataAction,
  searchRegisterCustomersAction,
  registerExistingAction,
  registerWalkInAction,
  setBookingStatusAction,
  setBookingCustomerTypeAction,
  setClassApprovalAction,
  type RegisterData,
  type RegisterCustomer,
  type SessionActionState,
} from "./actions";

const initial: SessionActionState = {};

export function RegisterPanel({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<RegisterData | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let on = true;
    getRegisterDataAction(sessionId)
      .then((d) => on && setData(d))
      .catch(() => on && setData(null));
    return () => {
      on = false;
    };
  }, [sessionId, reload]);

  // Member search (name or phone), debounced.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegisterCustomer[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchRegisterCustomersAction(q, data?.pool ?? "regular")
        .then(setResults)
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query, reload, data?.pool]);

  const [exState, exAction] = useFormState(registerExistingAction, initial);
  const [wkState, wkAction] = useFormState(registerWalkInAction, initial);
  const [stState, stAction] = useFormState(setBookingStatusAction, initial);
  const [ctState, ctAction] = useFormState(
    setBookingCustomerTypeAction,
    initial,
  );
  const [apState, apAction] = useFormState(setClassApprovalAction, initial);

  // Success pop-up. Checking someone in (or taking a door payment) reloads the
  // register, which redraws the whole panel — easy to miss. The toast is the
  // visible confirmation that the command actually ran. It clears itself so a
  // stale confirmation never sits over the next action.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const exDone = useRef(false);
  const wkDone = useRef(false);
  const stDone = useRef(false);
  const ctDone = useRef(false);
  const apDone = useRef(false);
  useEffect(() => {
    if (exState.ok && !exDone.current) {
      exDone.current = true;
      setToast("Checked in — the class is updated.");
      setReload((n) => n + 1);
    }
    if (!exState.ok) exDone.current = false;
  }, [exState]);
  useEffect(() => {
    if (wkState.ok && !wkDone.current) {
      wkDone.current = true;
      setToast("Payment taken — now find them above to check in.");
      setReload((n) => n + 1);
    }
    if (!wkState.ok) wkDone.current = false;
  }, [wkState]);
  useEffect(() => {
    if (stState.ok && !stDone.current) {
      stDone.current = true;
      setReload((n) => n + 1);
    }
    if (!stState.ok) stDone.current = false;
  }, [stState]);
  useEffect(() => {
    if (ctState.ok && !ctDone.current) {
      ctDone.current = true;
      setReload((n) => n + 1);
    }
    if (!ctState.ok) ctDone.current = false;
  }, [ctState]);
  useEffect(() => {
    if (apState.ok && !apDone.current) {
      apDone.current = true;
      setReload((n) => n + 1);
    }
    if (!apState.ok) apDone.current = false;
  }, [apState]);

  if (!data) {
    return <p className="text-xs text-ink-soft">Loading register…</p>;
  }

  const full = data.capacity > 0 && data.bookedCount >= data.capacity;
  const approved = !!data.approvedAt;

  return (
    <div className="space-y-6">
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg"
        >
          {toast}
        </div>
      )}
      {/* Status strip — capacity, the live counts, and class state at a glance */}
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-ink">
              {data.bookedCount}
              <span className="text-base font-normal text-ink-soft">
                /{data.capacity}
              </span>
            </span>
            <span className="text-xs text-ink-muted">in class</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {data.pool === "private" && (
              <span className="badge bg-brand-50 text-brand-700">Private</span>
            )}
            {full && <span className="badge bg-rose-50 text-rose-700">Full</span>}
            {approved ? (
              <span className="badge bg-emerald-50 text-emerald-700">
                Approved
              </span>
            ) : (
              <span className="badge bg-amber-50 text-amber-700">Open</span>
            )}
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-stone-100 pt-3 text-center">
          <Stat label="Attended" value={data.attendedCount} />
          <Stat label="No-show" value={data.noShowCount} />
          <Stat
            label={`Credit${data.creditsUsed === 1 ? "" : "s"} used`}
            value={data.creditsUsed}
          />
        </dl>
      </div>

      {/* Roster */}
      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          Roster · {data.classCost} credit{data.classCost === 1 ? "" : "s"} each
        </h3>
        {data.roster.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-200 px-4 py-8 text-center text-xs text-ink-muted">
            Nobody checked in yet. Find a member or add a new customer below.
          </div>
        ) : (
          <ul className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 bg-white">
            {data.roster.map((r) => (
              <li key={r.id} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusDot status={r.status} />
                    <span className="min-w-0 truncate text-sm font-medium text-ink">
                      {r.name}
                    </span>
                  </span>
                  {r.status === "waitlisted" ? (
                    <span className="badge shrink-0 bg-amber-50 text-amber-700">
                      Waitlist
                    </span>
                  ) : (
                    <form action={stAction} className="shrink-0">
                      <input type="hidden" name="booking_id" value={r.id} />
                      <select
                        key={r.status}
                        name="status"
                        aria-label="Attendance"
                        defaultValue={r.status}
                        disabled={approved}
                        onChange={(e) => e.currentTarget.form?.requestSubmit()}
                        className="input h-8 w-28 py-0 text-xs disabled:opacity-60"
                      >
                        <option value="booked">Booked</option>
                        <option value="attended">Attended</option>
                        <option value="no_show">No-show</option>
                      </select>
                    </form>
                  )}
                </div>
                <form action={ctAction} className="mt-2">
                  <input type="hidden" name="booking_id" value={r.id} />
                  <select
                    key={r.customerType ?? "none"}
                    name="customer_type"
                    aria-label="Customer type"
                    defaultValue={r.customerType ?? ""}
                    disabled={approved}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    className="input h-8 w-full py-0 text-xs text-ink-muted disabled:opacity-60"
                  >
                    <option value="">Customer type…</option>
                    <option value="new_single">New · single</option>
                    <option value="new_package">New · package</option>
                    <option value="existing_single">Existing · single</option>
                    <option value="existing_package">Existing · package</option>
                  </select>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Find existing member (name or phone) */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-ink">Find member</h3>
        <p className="mb-3 text-xs text-ink-soft">
          Search by name or phone, then check in — deducts {data.classCost}{" "}
          {data.pool === "private" ? "private " : ""}credit
          {data.classCost === 1 ? "" : "s"}.
        </p>
        {full && (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
            This class is full ({data.capacity}/{data.capacity}). Check-in is
            disabled — no credits will be deducted.
          </p>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="input"
          placeholder="Name or phone…"
        />

        {query.trim() && results.length === 0 && (
          <p className="mt-2 text-xs text-ink-muted">
            No match. Use &ldquo;New customer&rdquo; below.
          </p>
        )}

        {results.length > 0 && (
          <ul className="mt-3 divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200">
            {results.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {c.name}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {c.phone ? `${c.phone} · ` : ""}
                    {c.credits} cr
                  </p>
                </div>
                {full || approved ? (
                  <button
                    type="button"
                    disabled
                    className="btn-primary w-auto cursor-not-allowed opacity-50"
                  >
                    {approved ? "Locked" : "Full"}
                  </button>
                ) : (
                  <form action={exAction}>
                    <input type="hidden" name="session_id" value={sessionId} />
                    <input type="hidden" name="customer_id" value={c.id} />
                    <SubmitButton>Check in</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {exState.error && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {exState.error}
          </p>
        )}
      </section>

      {/* New customer + door payment */}
      <form
        action={wkAction}
        className="space-y-3 rounded-xl border border-stone-200 bg-white p-4"
      >
        <div>
          <h3 className="text-sm font-semibold text-ink">
            New customer (pay now)
          </h3>
          <p className="text-xs text-ink-soft">
            Only if they&rsquo;re not found above.
          </p>
        </div>
        <input type="hidden" name="session_id" value={sessionId} />
        <input name="name" className="input" placeholder="Full name" required />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select name="plan" className="input" defaultValue="" required>
            <option value="" disabled>
              Single class or package…
            </option>
            <option value="single">Single class (drop-in)</option>
            {data.packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.credits} cr ·{" "}
                {formatMoney(p.price_cents, p.currency)}
              </option>
            ))}
          </select>
          <select
            name="payment_method"
            className="input"
            defaultValue=""
            required
          >
            <option value="" disabled>
              Payment method…
            </option>
            <option value="qr">QR transfer</option>
            <option value="card">Card</option>
            <option value="cash">Cash</option>
          </select>
        </div>
        {wkState.error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {wkState.error}
          </p>
        )}
        <SubmitButton>Take payment</SubmitButton>
      </form>

      {/* End-of-day approval */}
      <section className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-semibold text-ink">End of day</p>
            <p className="text-xs text-ink-muted">
              {data.attendedCount} attended · {data.noShowCount} no-show ·{" "}
              {data.creditsUsed} credit{data.creditsUsed === 1 ? "" : "s"} used
            </p>
          </div>
          <form action={apAction}>
            <input type="hidden" name="session_id" value={sessionId} />
            <input
              type="hidden"
              name="approved"
              value={approved ? "false" : "true"}
            />
            <button
              type="submit"
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-transform duration-150 ease-out active:scale-[0.97] ${
                approved
                  ? "bg-stone-100 text-ink-muted hover:bg-stone-200"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
            >
              {approved ? "Reopen" : "Approve class"}
            </button>
          </form>
        </div>
        {approved && (
          <p className="mt-2 text-xs text-emerald-700">
            ✓ Approved — attendance is finalised. Reopen to make changes.
          </p>
        )}
        {apState.error && (
          <p className="mt-2 text-xs text-rose-700">{apState.error}</p>
        )}
      </section>
    </div>
  );
}

// A small status indicator dot for a roster row.
function StatusDot({ status }: { status: string }) {
  const color =
    status === "attended"
      ? "bg-emerald-500"
      : status === "no_show"
        ? "bg-rose-400"
        : status === "waitlisted"
          ? "bg-amber-400"
          : "bg-stone-300";
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${color}`}
      aria-hidden
    />
  );
}

// One compact stat in the register's status strip.
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dd className="text-lg font-semibold tabular-nums text-ink">{value}</dd>
      <dt className="text-[11px] uppercase tracking-wide text-ink-soft">
        {label}
      </dt>
    </div>
  );
}
