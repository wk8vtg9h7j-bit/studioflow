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

export function CustomerRow({
  customer,
  creditBalance,
  packages,
}: {
  customer: CustomerWithProfile;
  creditBalance: number;
  packages: Package[];
}) {
  const [editing, setEditing] = useState(false);
  const isWalkIn = !customer.profile;
  const name =
    customer.profile?.full_name ?? customer.name ?? "Unnamed customer";
  const email = customer.profile?.email ?? customer.email ?? null;
  const phone = customer.profile?.phone ?? customer.phone ?? null;
  const statusClass =
    STATUS_STYLES[customer.status] ?? "bg-stone-100 text-ink-muted";

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
          <div className="text-right">
            <p className="text-sm font-semibold text-ink">{creditBalance}</p>
            <p className="text-[11px] uppercase tracking-wide text-ink-soft">
              credits
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="btn-secondary"
          >
            {editing ? "Close" : "Edit"}
          </button>
        </div>
      </div>

      {editing && (
        <div className="space-y-6 border-t border-stone-200 bg-stone-50 px-5 py-4">
          <CustomerForm customer={customer} onDone={() => setEditing(false)} />
          {isWalkIn && (
            <AttachLogin customerId={customer.id} defaultName={name} />
          )}
          <GrantPackage customerId={customer.id} packages={packages} />
          <DeleteCustomer customerId={customer.id} name={name} />
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
                {pkg.name} — {pkg.credits} credits ·{" "}
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

function DeleteCustomer({
  customerId,
  name,
}: {
  customerId: string;
  name: string;
}) {
  const [state, formAction] = useFormState(
    deleteCustomerAction,
    deleteInitialState,
  );
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-stone-200 pt-4">
      <h3 className="mb-3 text-sm font-semibold text-rose-700">
        Delete customer
      </h3>

      {!open ? (
        <div>
          <p className="mb-3 text-xs text-ink-soft">
            Permanently removes {name}, along with their credits and booking
            history. This cannot be undone.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-secondary text-rose-700"
          >
            Delete this customer
          </button>
        </div>
      ) : (
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="id" value={customerId} />
          <div>
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
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {state.error}
            </p>
          )}
          {state.ok && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {state.message ?? "Customer deleted."}
            </p>
          )}

          <div className="flex items-center gap-3">
            <SubmitButton>Delete permanently</SubmitButton>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
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
