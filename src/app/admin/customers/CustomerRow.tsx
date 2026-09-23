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
import { formatMoney } from "@/lib/format";
import type { Customer, Package, Profile } from "@/lib/types";
import { CustomerForm } from "./CustomerForm";
import {
  grantPackageAction,
  adjustCreditsAction,
  attachLoginAction,
  deleteCustomerAction,
  type CustomerActionState,
  type AddCustomerState,
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
  const isWalkIn = !customer.profile;
  const name =
    customer.profile?.full_name ?? customer.name ?? "Unnamed customer";
  const email = customer.profile?.email ?? customer.email ?? null;
  const phone = customer.profile?.phone ?? customer.phone ?? null;
  const statusClass =
    STATUS_STYLES[customer.status] ?? "bg-stone-100 text-ink-muted";

  return (
    <li className="card overflow-hidden">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 px-4 py-4 sm:flex sm:gap-4 sm:px-5">
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

        <div className="col-span-2 flex w-full flex-wrap items-center justify-between gap-3 sm:ml-auto sm:w-auto sm:shrink-0 sm:justify-start sm:gap-4">
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
            onClick={() => {
              setEditing((v) => !v);
              setShowDelete(false);
            }}
            className="btn-secondary flex-1 sm:flex-none"
          >
            {editing ? "Close" : "Edit"}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowDelete((v) => !v);
              setEditing(false);
            }}
            className="btn-ghost flex-1 text-rose-700 hover:bg-rose-50 hover:text-rose-800 sm:flex-none"
          >
            {showDelete ? "Close delete" : "Delete"}
          </button>
        </div>
      </div>

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

        {state.error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Package granted — credits added to this customer.
          </p>
        )}

        <SubmitButton>Grant package</SubmitButton>
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
