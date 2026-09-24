// ============================================================================
// CustomerRow — one CRM record in the list. Shows the at-a-glance details
// (name, contact, lifecycle status, segmentation tags, live credit balance)
// and expands into the inline CustomerForm for editing. The credit balance is
// computed server-side via the credit_balance() RPC and passed down as a number.
// ============================================================================
"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import {
  formatMoney,
  formatSessionWhen,
  humanizeLabel,
} from "@/lib/format";
import type { Customer, Package, Profile } from "@/lib/types";
import { CustomerForm } from "./CustomerForm";
import {
  grantPackageAction,
  adjustCreditsAction,
  attachLoginAction,
  deleteCustomerAction,
  getCustomerHistoryAction,
  type CustomerActionState,
  type AddCustomerState,
  type CustomerHistoryResult,
} from "./actions";

export type CustomerWithProfile = Customer & {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  profile?: Pick<Profile, "full_name" | "email" | "phone"> | null;
};

const attachInitialState: AddCustomerState = {};
const deleteInitialState: AddCustomerState = {};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  lead: "bg-amber-50 text-amber-700",
  inactive: "bg-stone-100 text-ink-muted",
};

const grantInitialState: CustomerActionState = {};
const adjustInitialState: CustomerActionState = {};

export function CustomerRow({
  customer,
  regularBalance,
  privateBalance,
  packages,
}: {
  customer: CustomerWithProfile;
  regularBalance: number;
  privateBalance: number;
  packages: Package[];
}) {
  const [editing, setEditing] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<CustomerHistoryResult | null>(null);
  const isWalkIn = !customer.profile;
  const name =
    customer.profile?.full_name ?? customer.name ?? "Unnamed customer";
  const email = customer.profile?.email ?? customer.email ?? null;
  const phone = customer.profile?.phone ?? customer.phone ?? null;
  const statusClass =
    STATUS_STYLES[customer.status] ?? "bg-stone-100 text-ink-muted";

  async function toggleHistory() {
    if (showHistory) {
      setShowHistory(false);
      return;
    }

    setEditing(false);
    setShowDelete(false);
    setShowHistory(true);

    if (history) return;

    setHistoryLoading(true);
    try {
      setHistory(await getCustomerHistoryAction(customer.id));
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <li className="card overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700"
          aria-hidden
        >
          {initials(name)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-ink">{name}</p>
            <span className={`badge ${statusClass}`}>
              {capitalize(customer.status)}
            </span>
            {isWalkIn && (
              <span className="badge bg-amber-50 text-amber-700">Walk-in</span>
            )}
            {customer.tags.map((tag) => (
              <span key={tag} className="badge bg-brand-50 text-brand-700">
                {tag}
              </span>
            ))}
          </div>
          <p className="truncate text-xs text-ink-muted">
            {email ?? "No email"}
            {phone ? ` · ${phone}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <div className="flex items-center gap-3 text-right">
            <div>
              <p className="text-sm font-semibold text-ink">{regularBalance}</p>
              <p className="text-[10px] uppercase tracking-wide text-ink-soft">
                regular
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-brand-700">{privateBalance}</p>
              <p className="text-[10px] uppercase tracking-wide text-ink-soft">
                private
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleHistory}
            className="btn-secondary"
          >
            {showHistory ? "Close history" : "History"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing((v) => !v);
              setShowDelete(false);
              setShowHistory(false);
            }}
            className="btn-secondary"
          >
            {editing ? "Close" : "Edit"}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowDelete((v) => !v);
              setEditing(false);
              setShowHistory(false);
            }}
            className="btn-ghost text-rose-700 hover:bg-rose-50 hover:text-rose-800"
          >
            {showDelete ? "Close delete" : "Delete"}
          </button>
        </div>
      </div>

      {showHistory && (
        <CustomerHistoryPanel
          history={history}
          loading={historyLoading}
        />
      )}

      {showDelete && (
        <DeleteCustomer
          customerId={customer.id}
          name={name}
          hasLogin={!isWalkIn}
          onCancel={() => setShowDelete(false)}
        />
      )}

      {editing && (
        <div className="space-y-6 border-t border-stone-200 bg-stone-50 px-5 py-4">
          <CustomerForm customer={customer} onDone={() => setEditing(false)} />
          {isWalkIn && (
            <AttachLogin customerId={customer.id} defaultName={name} />
          )}
          <GrantPackage customerId={customer.id} packages={packages} />
          <AdjustCredits customerId={customer.id} />
        </div>
      )}
    </li>
  );
}

function CustomerHistoryPanel({
  history,
  loading,
}: {
  history: CustomerHistoryResult | null;
  loading: boolean;
}) {
  return (
    <div className="border-t border-stone-200 bg-stone-50 px-5 py-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-ink">Customer history</h3>
        <p className="mt-1 text-xs text-ink-soft">
          Latest 100 class bookings and 100 credit/package transactions.
        </p>
      </div>

      {loading && (
        <p className="rounded-lg bg-white px-3 py-4 text-sm text-ink-muted">
          Loading history…
        </p>
      )}

      {!loading && history?.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-3 text-sm text-rose-700">
          {history.error}
        </p>
      )}

      {!loading && history && !history.error && (
        <div className="grid gap-6 xl:grid-cols-2">
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Class history
            </h4>
            {history.bookings.length === 0 ? (
              <p className="rounded-lg bg-white px-3 py-4 text-sm text-ink-muted">
                No class bookings yet.
              </p>
            ) : (
              <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {history.bookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="rounded-lg border border-stone-200 bg-white px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {booking.session?.title ?? "Deleted class"}
                        </p>
                        {booking.session && (
                          <p className="mt-0.5 text-xs text-ink-muted">
                            {formatSessionWhen(
                              booking.session.startsAt,
                              booking.session.timezone,
                            )}{" "}
                            · {booking.session.studio}
                          </p>
                        )}
                      </div>
                      <span className="badge bg-stone-100 text-ink-muted">
                        {humanizeLabel(booking.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-ink-soft">
                      {booking.spots} spot{booking.spots === 1 ? "" : "s"}
                      {" · "}
                      {booking.creditsSpent} credit
                      {booking.creditsSpent === 1 ? "" : "s"} used
                      {booking.session?.pool === "private" ? " · Private" : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Credit & package activity
            </h4>
            {history.credits.length === 0 ? (
              <p className="rounded-lg bg-white px-3 py-4 text-sm text-ink-muted">
                No credit activity yet.
              </p>
            ) : (
              <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {history.credits.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {item.packageName ?? humanizeLabel(item.reason)}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {new Date(item.createdAt).toLocaleString()}
                        {item.paymentMethod
                          ? ` · ${item.paymentMethod.toUpperCase()}`
                          : ""}
                      </p>
                      <p className="mt-1 text-xs text-ink-soft">
                        {item.pool === "private" ? "Private" : "Regular"} credits
                        {item.expiresAt
                          ? ` · expires ${new Date(
                              item.expiresAt,
                            ).toLocaleDateString()}`
                          : ""}
                      </p>
                    </div>
                    <span
                      className={
                        item.delta >= 0
                          ? "text-sm font-semibold text-emerald-700"
                          : "text-sm font-semibold text-rose-700"
                      }
                    >
                      {item.delta > 0 ? "+" : ""}
                      {item.delta}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function AttachLogin({
  customerId,
  defaultName,
}: {
  customerId: string;
  defaultName: string;
}) {
  const [state, formAction] = useFormState(attachLoginAction, attachInitialState);

  return (
    <div className="border-t border-stone-200 pt-4">
      <h3 className="mb-3 text-sm font-semibold text-ink">Attach a login</h3>
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="name" value={defaultName} />
        <div>
          <label className="label" htmlFor={`attach-${customerId}`}>
            Email
          </label>
          <input
            id={`attach-${customerId}`}
            name="email"
            type="email"
            className="input"
            placeholder="member@email.com"
            required
          />
        </div>
        <p className="text-xs text-ink-soft">
          Creates an account linked to this walk-in, keeping their credits and
          history. They set a password via &ldquo;forgot password&rdquo;.
        </p>

        {state.error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {state.message ?? "Login attached."}
          </p>
        )}

        <SubmitButton>Attach login</SubmitButton>
      </form>
    </div>
  );
}

function GrantPackage({
  customerId,
  packages,
}: {
  customerId: string;
  packages: Package[];
}) {
  const [state, formAction] = useFormState(
    grantPackageAction,
    grantInitialState,
  );

  if (packages.length === 0) {
    return (
      <div className="border-t border-stone-200 pt-4">
        <p className="text-xs text-ink-soft">
          No active packages to grant. Create one under Packages first.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-stone-200 pt-4">
      <h3 className="mb-3 text-sm font-semibold text-ink">
        Grant a clip-card
      </h3>
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="customer_id" value={customerId} />
        <div>
          <label className="label" htmlFor={`pkg-${customerId}`}>
            Package
          </label>
          <select
            id={`pkg-${customerId}`}
            name="package_id"
            className="input"
            defaultValue=""
            required
          >
            <option value="" disabled>
              Select a package…
            </option>
            {packages.map((pkg) => (
              <option key={pkg.id} value={pkg.id}>
                {pkg.name} — {pkg.credits} {pkg.pool === "private" ? "private" : "regular"} credits ·{" "}
                {formatMoney(pkg.price_cents, pkg.currency)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor={`pay-${customerId}`}>
            Payment method
          </label>
          <select
            id={`pay-${customerId}`}
            name="payment_method"
            className="input"
            defaultValue=""
            required
          >
            <option value="" disabled>
              How was it paid?…
            </option>
            <option value="qr">QR transfer</option>
            <option value="card">Card</option>
            <option value="cash">Cash</option>
          </select>
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
          <input
            type="checkbox"
            name="settle_latest_attendance"
            defaultChecked
            className="mt-0.5 h-4 w-4 rounded border-stone-300"
          />
          <span className="text-xs leading-relaxed text-amber-900">
            <span className="block font-semibold">
              Use this payment for today&apos;s attended class
            </span>
            If this customer already attended a class today, StudioFlow will use
            the required credit(s) from this package to settle their latest
            attended class instead of leaving extra usable credits. Uncheck this
            only when the package is purely for future classes.
          </span>
        </label>

        {state.error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {state.message ?? "Package recorded."}
          </p>
        )}

        <SubmitButton>Record package payment</SubmitButton>
      </form>
    </div>
  );
}

function AdjustCredits({ customerId }: { customerId: string }) {
  const [state, formAction] = useFormState(
    adjustCreditsAction,
    adjustInitialState,
  );

  return (
    <div className="border-t border-stone-200 pt-4">
      <h3 className="mb-3 text-sm font-semibold text-ink">Adjust credits</h3>
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="customer_id" value={customerId} />
        <div>
          <label className="label" htmlFor={`adj-pool-${customerId}`}>
            Credit type
          </label>
          <select
            id={`adj-pool-${customerId}`}
            name="pool"
            className="input"
            defaultValue="regular"
            required
          >
            <option value="regular">Regular credits</option>
            <option value="private">Private credits</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`adj-${customerId}`}>
            Credits
          </label>
          <input
            id={`adj-${customerId}`}
            name="delta"
            type="number"
            step="1"
            className="input"
            placeholder="e.g. 1 or -1"
            required
          />
        </div>
        <p className="text-xs text-ink-soft">
          Choose regular or private credits. Positive adds credits and negative
          removes them. The two balances stay separate; adjustments never expire
          and are excluded from revenue reporting.
        </p>

        {state.error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Credits adjusted.
          </p>
        )}

        <SubmitButton>Apply adjustment</SubmitButton>
      </form>
    </div>
  );
}

function DeleteCustomer({
  customerId,
  name,
  hasLogin,
  onCancel,
}: {
  customerId: string;
  name: string;
  hasLogin: boolean;
  onCancel: () => void;
}) {
  const [state, formAction] = useFormState(
    deleteCustomerAction,
    deleteInitialState,
  );

  return (
    <div className="border-t border-rose-200 bg-rose-50/50 px-5 py-4">
      <h3 className="text-sm font-semibold text-rose-800">
        Permanently delete {name}?
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-rose-700">
        This removes the customer, credits, bookings, and purchase history.
        {hasLogin
          ? " Their linked login account will also be deleted so the customer cannot be recreated automatically."
          : ""}{" "}
        This cannot be undone.
      </p>

      <form action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="id" value={customerId} />
        <div className="max-w-sm">
          <label className="label" htmlFor={`del-${customerId}`}>
            Type DELETE to confirm
          </label>
          <input
            id={`del-${customerId}`}
            name="confirm"
            className="input"
            placeholder="DELETE"
            autoComplete="off"
            required
          />
        </div>

        {state.error && (
          <p className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-800">
            {state.error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>Delete permanently</SubmitButton>
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
