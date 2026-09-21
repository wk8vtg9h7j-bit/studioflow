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
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
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

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="btn-secondary"
          >
            {editing ? "Close" : "Edit"}
          </button>

          <form action={toggleProductActiveAction}>
            <input type="hidden" name="id" value={product.id} />
            <input
              type="hidden"
              name="active"
              value={product.active ? "false" : "true"}
            />
            <button type="submit" className="btn-ghost">
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
