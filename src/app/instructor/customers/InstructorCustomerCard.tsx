"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import { formatMoney } from "@/lib/format";
import type { Package } from "@/lib/types";
import type { InstructorCustomer } from "./page";
import {
  issuePackageAction,
  type InstructorPackageState,
} from "./actions";

const initialState: InstructorPackageState = {};

export function InstructorCustomerCard({
  customer,
  packages,
}: {
  customer: InstructorCustomer;
  packages: Package[];
}) {
  const [state, formAction] = useFormState(issuePackageAction, initialState);
  const [open, setOpen] = useState(false);
  const [regularBalance, setRegularBalance] = useState(customer.regularBalance);
  const [privateBalance, setPrivateBalance] = useState(customer.privateBalance);
  const [packageId, setPackageId] = useState("");
  const [salePrice, setSalePrice] = useState("");

  const selectedPackage = useMemo(
    () => packages.find((pkg) => pkg.id === packageId) ?? null,
    [packageId, packages],
  );

  const commissionPreview = useMemo(() => {
    const amount = Number(salePrice);
    if (!selectedPackage || !Number.isFinite(amount) || amount <= 0) return 0;
    return Math.round(amount * 0.025);
  }, [salePrice, selectedPackage]);

  useEffect(() => {
    if (!state.ok) return;
    if (typeof state.regularBalance === "number") {
      setRegularBalance(state.regularBalance);
    }
    if (typeof state.privateBalance === "number") {
      setPrivateBalance(state.privateBalance);
    }
  }, [state.ok, state.regularBalance, state.privateBalance]);

  return (
    <li className="card overflow-hidden">
      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{customer.name}</p>
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            {[customer.email, customer.phone].filter(Boolean).join(" · ") ||
              "Walk-in customer"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:w-64">
          <Balance label="Regular left" value={regularBalance} />
          <Balance label="Private left" value={privateBalance} />
        </div>

        <button
          type="button"
          className="btn-secondary shrink-0"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? "Close" : "Issue package"}
        </button>
      </div>

      {open ? (
        <div className="border-t border-stone-200 bg-stone-50/50 px-4 py-4">
          <form action={formAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="customer_id" value={customer.id} />

            <div className="sm:col-span-2">
              <label className="label" htmlFor={`pkg-${customer.id}`}>
                Package
              </label>
              <select
                id={`pkg-${customer.id}`}
                name="package_id"
                className="input"
                value={packageId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  const nextPackage =
                    packages.find((pkg) => pkg.id === nextId) ?? null;
                  setPackageId(nextId);
                  setSalePrice(
                    nextPackage ? String(nextPackage.price_cents) : "",
                  );
                }}
                required
              >
                <option value="" disabled>
                  Select a paid package…
                </option>
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name} — {pkg.credits}{" "}
                    {pkg.pool === "private" ? "private" : "regular"} ·{" "}
                    {formatMoney(pkg.price_cents, pkg.currency)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor={`price-${customer.id}`}>
                Sale price
                {selectedPackage ? ` (${selectedPackage.currency})` : ""}
              </label>
              <input
                id={`price-${customer.id}`}
                name="sale_price_cents"
                type="number"
                min={1}
                max={selectedPackage?.price_cents}
                step={1}
                className="input"
                value={salePrice}
                onChange={(event) => setSalePrice(event.target.value)}
                disabled={!selectedPackage}
                required
              />
              {selectedPackage ? (
                <div className="mt-1 space-y-1 text-xs text-ink-soft">
                  <p>
                    List price:{" "}
                    {formatMoney(
                      selectedPackage.price_cents,
                      selectedPackage.currency,
                    )}
                    . You can lower the amount for a discount.
                  </p>
                  <p className="font-medium text-emerald-700">
                    Your commission:{" "}
                    {formatMoney(
                      commissionPreview,
                      selectedPackage.currency,
                    )}{" "}
                    (2.5% of the amount charged)
                  </p>
                </div>
              ) : null}
            </div>

            <div>
              <label className="label" htmlFor={`payment-${customer.id}`}>
                Payment method
              </label>
              <select
                id={`payment-${customer.id}`}
                name="payment_method"
                className="input"
                defaultValue=""
                required
              >
                <option value="" disabled>
                  Select payment…
                </option>
                <option value="qr">QR transfer</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
              </select>
            </div>

            {state.error ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2">
                {state.error}
              </p>
            ) : null}

            {state.ok ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 sm:col-span-2">
                Package issued. The customer&apos;s classes left have been
                updated. Your 2.5% commission is{" "}
                {formatMoney(
                  state.commissionAmount ?? 0,
                  state.commissionCurrency ?? selectedPackage?.currency ?? "VND",
                )}
                .
              </p>
            ) : null}

            <div className="sm:col-span-2">
              <SubmitButton>Issue package</SubmitButton>
            </div>
          </form>
        </div>
      ) : null}
    </li>
  );
}

function Balance({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-stone-50 px-3 py-2 text-center">
      <p className="text-lg font-semibold tabular-nums text-ink">{value}</p>
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-soft">
        {label}
      </p>
    </div>
  );
}
