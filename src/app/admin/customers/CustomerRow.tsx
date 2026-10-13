// ============================================================================
// CustomerRow — one CRM record in the list. Shows the at-a-glance details
// (name, contact, lifecycle status, segmentation tags, live credit balance)
// and expands into the inline CustomerForm for editing. The credit balance is
// computed server-side via the credit_balance() RPC and passed down as a number.
// ============================================================================
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import {
  formatMoney,
  formatSessionWhen,
  humanizeLabel,
} from "@/lib/format";
import type { Customer, Package, Profile } from "@/lib/types";
import type { CustomerSegmentKey } from "@/lib/customerAnalytics";
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
  visits,
  totalSpendCents,
  spendCurrency,
  lastVisitAt,
  nextBookingAt,
  segments,
}: {
  customer: CustomerWithProfile;
  regularBalance: number;
  privateBalance: number;
  packages: Package[];
  visits: number;
  totalSpendCents: number;
  spendCurrency: string;
  lastVisitAt: string | null;
  nextBookingAt: string | null;
  segments: CustomerSegmentKey[];
}) {
  const [editing, setEditing] = useState(false);
  const [issuingPackage, setIssuingPackage] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<CustomerHistoryResult | null>(null);
  const [displayRegularBalance, setDisplayRegularBalance] =
    useState(regularBalance);
  const [displayPrivateBalance, setDisplayPrivateBalance] =
    useState(privateBalance);
  const router = useRouter();

  useEffect(() => {
    setDisplayRegularBalance(regularBalance);
  }, [regularBalance]);

  useEffect(() => {
    setDisplayPrivateBalance(privateBalance);
  }, [privateBalance]);

  const handleCreditsChanged = useCallback(
    (nextRegular?: number, nextPrivate?: number) => {
      if (typeof nextRegular === "number") {
        setDisplayRegularBalance(nextRegular);
      }
      if (typeof nextPrivate === "number") {
        setDisplayPrivateBalance(nextPrivate);
      }

      setHistory(null);
      router.refresh();
    },
    [router],
  );

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
    setIssuingPackage(false);
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
      <div className="flex min-w-0 flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
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
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-soft">
            <span>
              <strong className="font-semibold text-ink-muted">{visits}</strong>{" "}
              visit{visits === 1 ? "" : "s"}
            </span>
            <span>
              Spend{" "}
              <strong className="font-semibold text-ink-muted">
                {formatMoney(totalSpendCents, spendCurrency)}
              </strong>
            </span>
            <span>
              Last{" "}
              <strong className="font-semibold text-ink-muted">
                {lastVisitAt ? shortDate(lastVisitAt) : "Never"}
              </strong>
            </span>
            {nextBookingAt && (
              <span>
                Next{" "}
                <strong className="font-semibold text-brand-700">
                  {shortDate(nextBookingAt)}
                </strong>
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {customerClassifications(segments, visits).map((label) => (
              <span
                key={label}
                className={`badge ${
                  label === "High value"
                    ? "bg-violet-50 text-violet-700"
                    : label === "At risk" || label === "Lapsed"
                      ? "bg-amber-50 text-amber-700"
                      : label === "New"
                        ? "bg-sky-50 text-sky-700"
                        : "bg-emerald-50 text-emerald-700"
                }`}
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 sm:shrink-0 sm:justify-end sm:gap-4">
          <div className="flex shrink-0 items-center gap-3 text-right">
            <div>
              <p className="text-sm font-semibold text-ink">
                {displayRegularBalance}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-ink-soft">
                regular
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-brand-700">
                {displayPrivateBalance}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-ink-soft">
                private
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setIssuingPackage((value) => !value);
              setEditing(false);
              setShowHistory(false);
              setShowDelete(false);
            }}
            className="btn-primary min-h-10"
          >
            {issuingPackage ? "Close package" : "Issue package"}
          </button>
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
              setIssuingPackage(false);
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
              setIssuingPackage(false);
              setShowHistory(false);
            }}
            className="btn-ghost text-rose-700 hover:bg-rose-50 hover:text-rose-800"
          >
            {showDelete ? "Close delete" : "Delete"}
          </button>
        </div>
      </div>

      {issuingPackage && (
        <div className="border-t border-stone-200 bg-stone-50 px-4 py-4 sm:px-5">
          <GrantPackage
            customerId={customer.id}
            packages={packages}
            currentPrivateCredits={displayPrivateBalance}
            pastVisits={visits}
            onCreditsChanged={handleCreditsChanged}
          />
        </div>
      )}

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
          <AdjustCredits
            customerId={customer.id}
            onCreditsChanged={handleCreditsChanged}
          />
        </div>
      )}
    </li>
  );
}

function CustomerHistoryPanel({
  history, loading,
}: { history: CustomerHistoryResult | null; loading: boolean }) {
  if (loading) return <div className="border-t px-5 py-4 text-sm text-ink-muted">Loading customer timeline…</div>;
  if (!history) return null;
  if (history.error) return <div className="border-t px-5 py-4 text-sm text-rose-700">{history.error}</div>;
  const events: Array<{id:string;at:string;label:string;detail:string;kind:string;amount?:number;currency?:string}> = [
    ...history.bookings.map(b=>({
      id:"b-"+b.id,at:b.bookedAt,
      label:"Class · "+(b.session?.title||"Booking"),
      detail:(b.session?.studio||"Studio")+" · "+humanizeLabel(b.status)+" · "+b.creditsSpent+" credit(s) used",
      kind:"booking",
    })),
    ...history.credits.map(c=>({
      id:"c-"+c.id,at:c.createdAt,
      label:c.reason==="purchase" ? "Credits issued · "+(c.packageName||"Package") : c.reason==="single_class_credit" ? "Paid credit for next class" : humanizeLabel(c.reason),
      detail:(c.delta>0?"+":"")+c.delta+" "+(c.pool==="private"?"private":"regular")+" credit(s)"+
        (c.expiresAt?" · Expires "+new Date(c.expiresAt).toLocaleDateString("en-GB"):""),
      kind:"credit",
    })),
    ...history.checkouts.map(c=>({
      id:"p-"+c.id,at:c.createdAt,
      label:c.kind==="package"?"Package checkout · first class included":"Single class paid",
      detail:c.paymentMethod.toUpperCase()+" · Receipt linked to booking",
      kind:"payment",amount:c.amountCents,currency:c.currency,
    })),
  ].sort((a,b)=>b.at.localeCompare(a.at));
  return <section className="space-y-3 border-t border-stone-200 bg-stone-50 px-5 py-5">
    <div><h3 className="text-sm font-semibold text-ink">Customer timeline</h3>
     <p className="mt-1 text-xs text-ink-muted">Bookings, credit changes, package sales and linked payments in one chronological history. Existing records remain unchanged.</p>
    </div>
    {events.length===0?<p className="text-sm text-ink-muted">No activity recorded.</p>:
     <ol className="max-h-[32rem] space-y-2 overflow-y-auto">
      {events.map(event=><li key={event.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-stone-200 bg-white p-3">
       <div className="min-w-0"><p className="text-sm font-medium text-ink">{event.label}</p>
        <p className="mt-1 text-xs text-ink-muted">{event.detail}</p>
        <p className="mt-1 text-xs text-ink-soft">{formatSessionWhen(event.at)}</p></div>
       {typeof event.amount==="number"?<span className="text-sm font-semibold text-emerald-700">
        {formatMoney(event.amount,event.currency||"VND")}</span>:
        <span className="badge bg-stone-100 text-ink-muted">{event.kind}</span>}
      </li>)}
     </ol>}
   </section>;
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
  currentPrivateCredits,
  pastVisits,
  onCreditsChanged,
}: {
  customerId: string;
  packages: Package[];
  currentPrivateCredits: number;
  pastVisits: number;
  onCreditsChanged: (regular?: number, privateCredits?: number) => void;
}) {
  const [state, formAction] = useFormState(
    grantPackageAction,
    grantInitialState,
  );
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [salePrice, setSalePrice] = useState("");

  const selectedPackage =
    packages.find((pkg) => pkg.id === selectedPackageId) ?? null;
  const parsedSalePrice = salePrice === "" ? null : Number(salePrice);
  const discountAmount =
    selectedPackage && parsedSalePrice !== null && Number.isFinite(parsedSalePrice)
      ? Math.max(0, selectedPackage.price_cents - parsedSalePrice)
      : 0;

  useEffect(() => {
    if (!state.ok) return;
    onCreditsChanged(state.regularBalance, state.privateBalance);
  }, [
    state.ok,
    state.regularBalance,
    state.privateBalance,
    onCreditsChanged,
  ]);

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
      <h3 className="mb-2 text-sm font-semibold text-ink">
        Issue a paid package
      </h3>
      <p className="mb-3 text-xs leading-relaxed text-ink-muted">
        Admins can issue a package at any time. Existing balances do not
        prevent this sale.
      </p>
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
            value={selectedPackageId}
            onChange={(event) => {
              const nextId = event.target.value;
              const nextPackage =
                packages.find((pkg) => pkg.id === nextId) ?? null;
              setSelectedPackageId(nextId);
              setSalePrice(
                nextPackage ? String(nextPackage.price_cents) : "",
              );
            }}
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

        {selectedPackage?.pool === "private" && currentPrivateCredits > 0 && (
          <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-950">
            <p className="font-semibold">Check existing private credits</p>
            <p className="mt-1">
              This customer already has <strong>{currentPrivateCredits} private
              credit{currentPrivateCredits === 1 ? "" : "s"}</strong>.
              Issuing this package adds <strong>{selectedPackage.credits}</strong> more.
              Their balance would be <strong>{currentPrivateCredits + selectedPackage.credits}</strong> if nothing else changes.
            </p>
            <p className="mt-1 text-xs text-amber-900">
              Double-check their history before issuing. This is a reminder only — you can proceed.
            </p>
          </div>
        )}

        {selectedPackage && pastVisits > 0 && (
          <p className="rounded-xl border border-stone-200 bg-white p-3 text-xs leading-relaxed text-ink-muted">
            This action issues the full package. It will not automatically
            settle an unpaid earlier class or deduct its credit. To include
            an attended class in the package instead, use that class&apos;s
            Collect payment option. You can still issue the full package here.
          </p>
        )}

        {selectedPackage && (
          <div>
            <label className="label" htmlFor={`sale-price-${customerId}`}>
              Sale price ({selectedPackage.currency})
            </label>
            <input
              id={`sale-price-${customerId}`}
              name="sale_price_cents"
              type="number"
              min={0}
              max={selectedPackage.price_cents}
              step={1}
              className="input"
              value={salePrice}
              onChange={(event) => setSalePrice(event.target.value)}
              required
            />
            <p className="mt-1 text-xs text-ink-soft">
              List price:{" "}
              {formatMoney(
                selectedPackage.price_cents,
                selectedPackage.currency,
              )}
              {discountAmount > 0
                ? ` · Discount: ${formatMoney(
                    discountAmount,
                    selectedPackage.currency,
                  )}`
                : " · Change this amount only when giving a discount."}
              {" "}The package&apos;s normal price will not change.
            </p>
          </div>
        )}

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
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
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

function AdjustCredits({
  customerId,
  onCreditsChanged,
}: {
  customerId: string;
  onCreditsChanged: (regular?: number, privateCredits?: number) => void;
}) {
  const [state, formAction] = useFormState(
    adjustCreditsAction,
    adjustInitialState,
  );

  useEffect(() => {
    if (!state.ok) return;
    onCreditsChanged(state.regularBalance, state.privateBalance);
  }, [
    state.ok,
    state.regularBalance,
    state.privateBalance,
    onCreditsChanged,
  ]);

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

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function customerClassifications(
  segments: CustomerSegmentKey[],
  visits: number,
): string[] {
  const labels: string[] = [];
  if (segments.includes("high_value")) labels.push("High value");
  if (visits === 0) labels.push("New");
  else if (segments.includes("inactive_60")) labels.push("Lapsed");
  else if (segments.includes("inactive_30")) labels.push("At risk");
  else labels.push("Active");
  return labels.slice(0, 2);
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
