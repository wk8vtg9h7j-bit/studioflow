// ============================================================================
// Admin · Packages — list row
//
// Mirrors ClassTypeRow: a card per clip-card showing its headline numbers
// (credits, price, validity) with an active/inactive badge, an inline Edit
// toggle that swaps in PackageForm, and a soft enable/disable form. Packages
// are referenced by credit_ledger, so we never hard-delete — togglePackage-
// ActiveAction just flips `active`.
// ============================================================================
"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { Package } from "@/lib/types";
import { PackageForm } from "./PackageForm";
import { togglePackageActiveAction } from "./actions";

export function PackageRow({ pkg }: { pkg: Package }) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="card overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-ink">
              {pkg.name}
            </h3>
            <span
              className={
                pkg.active
                  ? "badge bg-emerald-50 text-emerald-700"
                  : "badge bg-stone-100 text-ink-muted"
              }
            >
              {pkg.active ? "Active" : "Inactive"}
            </span>
            <span className="badge bg-brand-50 text-brand-700">
              {pkg.pool === "private" ? "Private" : "Regular"}
            </span>
          </div>

          {pkg.description && (
            <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
              {pkg.description}
            </p>
          )}

          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-ink-soft">Credits</dt>
              <dd className="font-medium text-ink">{pkg.credits}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-ink-soft">Price</dt>
              <dd className="font-medium text-ink">
                {formatMoney(pkg.price_cents, pkg.currency)}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-ink-soft">Valid for</dt>
              <dd className="font-medium text-ink">{pkg.validity_days} days</dd>
            </div>
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

          <form action={togglePackageActiveAction}>
            <input type="hidden" name="id" value={pkg.id} />
            <input
              type="hidden"
              name="active"
              value={pkg.active ? "false" : "true"}
            />
            <button type="submit" className="btn-ghost">
              {pkg.active ? "Deactivate" : "Reactivate"}
            </button>
          </form>
        </div>
      </div>

      {editing && (
        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4">
          <PackageForm pkg={pkg} onDone={() => setEditing(false)} />
        </div>
      )}
    </li>
  );
}
