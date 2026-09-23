// ============================================================================
// Admin · Products — list row
//
// Mirrors PackageRow: a card per retail item showing its price and SKU with an
// active/inactive badge, an inline Edit toggle that swaps in ProductForm, and a
// soft enable/disable form. Products are referenced by sale_items, so we never
// hard-delete — toggleProductActiveAction just flips `active`.
// ============================================================================
"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { Product } from "@/lib/types";
import { ProductForm } from "./ProductForm";
import { toggleProductActiveAction } from "./actions";

export function ProductRow({ product }: { product: Product }) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="card overflow-hidden">
      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-ink">
              {product.name}
            </h3>
            <span
              className={
                product.active
                  ? "badge bg-emerald-50 text-emerald-700"
                  : "badge bg-stone-100 text-ink-muted"
              }
            >
              {product.active ? "Active" : "Inactive"}
            </span>
          </div>

          {product.description && (
            <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
              {product.description}
            </p>
          )}

          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-ink-soft">Price</dt>
              <dd className="font-medium text-ink">
                {formatMoney(product.price_cents, product.currency)}
              </dd>
            </div>
            {product.sku && (
              <div className="flex items-baseline gap-1.5">
                <dt className="text-ink-soft">SKU</dt>
                <dd className="font-medium text-ink">{product.sku}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="btn-secondary w-full sm:w-auto"
          >
            {editing ? "Close" : "Edit"}
          </button>

          <form action={toggleProductActiveAction} className="w-full sm:w-auto">
            <input type="hidden" name="id" value={product.id} />
            <input
              type="hidden"
              name="active"
              value={product.active ? "false" : "true"}
            />
            <button type="submit" className="btn-ghost w-full sm:w-auto">
              {product.active ? "Deactivate" : "Reactivate"}
            </button>
          </form>
        </div>
      </div>

      {editing && (
        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4">
          <ProductForm product={product} onDone={() => setEditing(false)} />
        </div>
      )}
    </li>
  );
}
