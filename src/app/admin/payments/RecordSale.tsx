"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import { formatMoney } from "@/lib/format";
import type { Product } from "@/lib/types";
import { recordSaleAction, type SaleActionState } from "./actions";

const initialState: SaleActionState = {};

type CustomerOption = {
  id: string;
  name: string;
  email: string | null;
};

type StudioOption = {
  id: string;
  name: string;
};

type PaymentMethod = "" | "qr" | "card" | "cash";

export function RecordSale({
  products,
  customers,
  studios,
}: {
  products: Product[];
  customers: CustomerOption[];
  studios: StudioOption[];
}) {
  const [state, formAction] = useFormState(recordSaleAction, initialState);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("");
  const [studioId, setStudioId] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.ok) return;
    formRef.current?.reset();
    setQtys({});
    setCustomerQuery("");
    setCustomerId("");
    setPaymentMethod("");
    setStudioId("");
    setShowNotes(false);
  }, [state.ok]);

  const chosen = products.filter((p) => (qtys[p.id] ?? 0) > 0);
  const itemCount = chosen.reduce((sum, p) => sum + (qtys[p.id] ?? 0), 0);
  const total = chosen.reduce(
    (sum, p) => sum + p.price_cents * (qtys[p.id] ?? 0),
    0,
  );
  const currencies = new Set(chosen.map((p) => p.currency));
  const mixed = currencies.size > 1;
  const totalCurrency = [...currencies][0] ?? "VND";

  const selectedCustomer =
    customers.find((customer) => customer.id === customerId) ?? null;

  const filteredCustomers = useMemo(() => {
    const query = customerQuery.trim().toLowerCase();
    if (!query || customerId) return [];

    return customers
      .filter((customer) => {
        const haystack = `${customer.name} ${customer.email ?? ""}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 8);
  }, [customers, customerId, customerQuery]);

  const changeQty = (productId: string, delta: number) => {
    setQtys((current) => ({
      ...current,
      [productId]: Math.max(0, (current[productId] ?? 0) + delta),
    }));
  };

  if (products.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No active products yet. Add a product on the Products page first.
      </p>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="studio_id" value={studioId} />
      <input type="hidden" name="payment_method" value={paymentMethod} />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            1 · Products
          </p>
          {itemCount > 0 && (
            <button
              type="button"
              onClick={() => setQtys({})}
              className="text-xs font-medium text-ink-muted hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => {
            const qty = qtys[product.id] ?? 0;
            return (
              <div
                key={product.id}
                className={`rounded-xl border p-3 transition ${
                  qty > 0
                    ? "border-brand-300 bg-brand-50/50"
                    : "border-stone-200 bg-white"
                }`}
              >
                <input type="hidden" name="product_id" value={product.id} />
                <input type="hidden" name="qty" value={qty} />

                <button
                  type="button"
                  onClick={() => changeQty(product.id, 1)}
                  className="w-full text-left"
                >
                  <p className="text-sm font-semibold text-ink">{product.name}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {formatMoney(product.price_cents, product.currency)}
                  </p>
                </button>

                <div className="mt-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => changeQty(product.id, -1)}
                    disabled={qty === 0}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 text-lg font-medium text-ink disabled:opacity-30"
                    aria-label={`Remove one ${product.name}`}
                  >
                    −
                  </button>
                  <span className="min-w-8 text-center text-base font-semibold tabular-nums text-ink">
                    {qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => changeQty(product.id, 1)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-lg font-medium text-white"
                    aria-label={`Add one ${product.name}`}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="relative">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            2 · Customer
          </p>

          {selectedCustomer ? (
            <div className="flex min-h-11 items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {selectedCustomer.name}
                </p>
                {selectedCustomer.email && (
                  <p className="truncate text-xs text-ink-muted">
                    {selectedCustomer.email}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setCustomerId("");
                  setCustomerQuery("");
                }}
                className="ml-3 text-xs font-medium text-brand-700"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  value={customerQuery}
                  onChange={(event) => setCustomerQuery(event.target.value)}
                  className="input flex-1"
                  placeholder="Search name or email…"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => {
                    setCustomerId("");
                    setCustomerQuery("");
                  }}
                  className="btn-secondary shrink-0"
                >
                  Walk-in
                </button>
              </div>

              {filteredCustomers.length > 0 && (
                <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-stone-200 bg-white p-1 shadow-lg">
                  {filteredCustomers.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => {
                        setCustomerId(customer.id);
                        setCustomerQuery(customer.name);
                      }}
                      className="block w-full rounded-md px-3 py-2 text-left hover:bg-stone-50"
                    >
                      <p className="truncate text-sm font-medium text-ink">
                        {customer.name}
                      </p>
                      {customer.email && (
                        <p className="truncate text-xs text-ink-muted">
                          {customer.email}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <p className="mt-1.5 text-[11px] text-ink-soft">
            Leave as Walk-in if the purchase does not need customer history.
          </p>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            3 · Payment
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["qr", "QR"],
                ["card", "Card"],
                ["cash", "Cash"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPaymentMethod(value)}
                className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${
                  paymentMethod === value
                    ? "border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500"
                    : "border-stone-200 bg-white text-ink hover:bg-stone-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-3">
            <label htmlFor="quick-sale-studio" className="label">
              Studio
            </label>
            <select
              id="quick-sale-studio"
              value={studioId}
              onChange={(event) => setStudioId(event.target.value)}
              className="input"
            >
              <option value="">Not specified</option>
              {studios.map((studio) => (
                <option key={studio.id} value={studio.id}>
                  {studio.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="border-t border-stone-200 pt-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-ink-soft">
              {itemCount} item{itemCount === 1 ? "" : "s"}
              {selectedCustomer ? ` · ${selectedCustomer.name}` : " · Walk-in"}
            </p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">
              {mixed ? "Mixed currencies" : formatMoney(total, totalCurrency)}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowNotes((current) => !current)}
            className="text-xs font-medium text-ink-muted hover:text-ink"
          >
            {showNotes ? "Hide notes" : "+ Add note"}
          </button>
        </div>

        {showNotes && (
          <textarea
            name="notes"
            maxLength={500}
            className="input mt-3 min-h-[64px] resize-y"
            placeholder="Optional note…"
          />
        )}
        {!showNotes && <input type="hidden" name="notes" value="" />}
      </div>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Product sale recorded.
        </p>
      )}

      <SubmitButton>
        {itemCount === 0
          ? "Select a product"
          : paymentMethod === ""
            ? "Record sale"
            : `Record ${paymentMethod.toUpperCase()} sale`}
      </SubmitButton>
    </form>
  );
}
