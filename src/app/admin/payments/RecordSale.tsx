// ============================================================================
// Admin · Payments — record a retail sale
//
// The counter form: set a quantity against each product, pick how the money was
// taken, and submit. Lines are posted as parallel repeated fields — one
// `product_id` and one `qty` per row, in matching order — which is what
// parseLines in ./actions zips back together. Rows left at 0 are dropped there.
//
// Prices shown here are for the admin's benefit only; the action re-reads them
// server-side and snapshots those values onto sale_items.
// ============================================================================
"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/app/(auth)/SubmitButton";
import { formatMoney } from "@/lib/format";
import type { Product } from "@/lib/types";
import { recordSaleAction, type SaleActionState } from "./actions";

const initialState: SaleActionState = {};

export function RecordSale({
  products,
  customers,
  studios,
}: {
  products: Product[];
  // Pre-flattened by the server component: the Customer row itself carries no
  // display name (it may be a profile or a walk-in).
  customers: { id: string; name: string }[];
  studios: { id: string; name: string }[];
}) {
  const [state, formAction] = useFormState(recordSaleAction, initialState);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setQtys({});
    }
  }, [state.ok]);

  // Running total for the person at the till. Only meaningful within one
  // currency, which the action enforces — so show the basket's currency, or a
  // warning if two were mixed.
  const chosen = products.filter((p) => (qtys[p.id] ?? 0) > 0);
  const total = chosen.reduce((sum, p) => sum + p.price_cents * qtys[p.id], 0);
  const currencies = new Set(chosen.map((p) => p.currency));
  const mixed = currencies.size > 1;

  if (products.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No active products yet. Add some on the Products page first.
      </p>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <ul className="space-y-2">
        {products.map((product) => (
          <li key={product.id} className="flex items-center gap-3">
            <input type="hidden" name="product_id" value={product.id} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">{product.name}</p>
              <p className="text-xs text-ink-muted">
                {formatMoney(product.price_cents, product.currency)}
              </p>
            </div>
            <input
              name="qty"
              type="number"
              min={0}
              step={1}
              value={qtys[product.id] ?? 0}
              onChange={(e) =>
                setQtys((prev) => ({
                  ...prev,
                  [product.id]: Number(e.target.value) || 0,
                }))
              }
              className="input w-20 shrink-0 text-right tabular-nums"
              aria-label={`Quantity of ${product.name}`}
            />
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between border-t border-stone-200 pt-3">
        <span className="text-sm text-ink-muted">Total</span>
        <span className="text-sm font-semibold tabular-nums text-ink">
          {mixed
            ? "Mixed currencies"
            : formatMoney(total, [...currencies][0] ?? "VND")}
        </span>
      </div>

      <div>
        <label htmlFor="payment_method" className="label">
          Payment method
        </label>
        <select
          id="payment_method"
          name="payment_method"
          defaultValue=""
          className="input"
        >
          <option value="">Unrecorded</option>
          <option value="qr">QR</option>
          <option value="card">Card</option>
          <option value="cash">Cash</option>
        </select>
      </div>

      <div>
        <label htmlFor="customer_id" className="label">
          Customer (optional)
        </label>
        <select id="customer_id" name="customer_id" defaultValue="" className="input">
          <option value="">Walk-in</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="studio_id" className="label">
          Studio (optional)
        </label>
        <select id="studio_id" name="studio_id" defaultValue="" className="input">
          <option value="">Not specified</option>
          {studios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="notes" className="label">
          Notes (optional)
        </label>
        <textarea
          id="notes"
          name="notes"
          maxLength={500}
          className="input min-h-[60px] resize-y"
          placeholder="Discount applied, staff purchase…"
        />
      </div>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      )}

      <SubmitButton>Record sale</SubmitButton>
    </form>
  );
}
