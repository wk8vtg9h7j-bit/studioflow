// ============================================================================
// PayRuleRow — one authored pay rule in the admin list.
//
// Mirrors the admin PayrollRow shape: a compact header summarising the rule
// (who, where, for which class type, and the four per-headcount amounts), an
// inline edit toggle that reuses PayRuleForm, and a footer with the quick
// active/inactive switch (setPayRuleActiveAction — a shape-(b) form action).
//
// The per-headcount amounts are read straight off rule.tiers, the same jsonb
// bands compute_pay() walks: [{min:1,max:1},{min:2,max:2},{min:3,max:3},{min:4}].
// Pay amounts are numeric(10,2) DECIMALS, so we format with Intl.NumberFormat
// directly — never the /100 formatMoney helper.
// ============================================================================
"use client";

import { useState } from "react";
import type { PayRule } from "@/lib/types";
import { setPayRuleActiveAction } from "./actions";
import {
  PayRuleForm,
  type StudioOption,
  type InstructorOption,
  type ClassTypeOption,
} from "./PayRuleForm";

export function PayRuleRow({
  rule,
  studios,
  instructors,
  classTypes,
  studioName,
  instructorName,
  classTypeName,
}: {
  rule: PayRule;
  studios: StudioOption[];
  instructors: InstructorOption[];
  classTypes: ClassTypeOption[];
  studioName: string | null;
  instructorName: string | null;
  classTypeName: string | null;
}) {
  const [editOpen, setEditOpen] = useState(false);

  // Pull each per-headcount amount back out of the stored bands. Index by min:
  // 1/2/3 are exact bands, 4 is the open-ended 4+ band.
  const tierAmount = (min: number): number | null => {
    const band = rule.tiers?.find((t) => t.min === min);
    return band ? band.amount : null;
  };

  const scope = classTypeName ?? "All class types";

  return (
    <li className="card overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-ink">{rule.name}</p>
            <span
              className={`badge ${
                rule.active
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-stone-100 text-ink-muted"
              }`}
            >
              {rule.active ? "Active" : "Inactive"}
            </span>
          </div>
          <p className="truncate text-xs text-ink-muted">
            {instructorName ?? "Any instructor"}
            {studioName ? ` · ${studioName}` : ""}
            {` · ${scope}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <TierSummary
            currency={rule.currency}
            amounts={[
              tierAmount(1),
              tierAmount(2),
              tierAmount(3),
              tierAmount(4),
            ]}
          />
          <button
            type="button"
            onClick={() => setEditOpen((v) => !v)}
            className="btn-secondary"
          >
            {editOpen ? "Close" : "Edit"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3">
        <form action={setPayRuleActiveAction}>
          <input type="hidden" name="id" value={rule.id} />
          <input type="hidden" name="active" value={String(!rule.active)} />
          <button
            type="submit"
            className={rule.active ? "btn-ghost text-rose-700" : "btn-secondary"}
          >
            {rule.active ? "Deactivate" : "Activate"}
          </button>
        </form>
        <div className="ml-auto text-[11px] text-ink-soft">
          Priority {rule.priority}
        </div>
      </div>

      {editOpen && (
        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4">
          <PayRuleForm
            rule={rule}
            studios={studios}
            instructors={instructors}
            classTypes={classTypes}
            onDone={() => setEditOpen(false)}
          />
        </div>
      )}
    </li>
  );
}

// The four per-headcount amounts laid out as a tiny 1 / 2 / 3 / 4+ strip so the
// admin can eyeball the rate curve without opening the editor.
function TierSummary({
  currency,
  amounts,
}: {
  currency: string;
  amounts: (number | null)[];
}) {
  const labels = ["1", "2", "3", "4+"];
  return (
    <div className="hidden gap-3 sm:flex">
      {amounts.map((amount, i) => (
        <div key={labels[i]} className="text-right">
          <p className="text-sm font-semibold text-ink">
            {amount == null ? "—" : formatAmount(amount, currency)}
          </p>
          <p className="text-[11px] uppercase tracking-wide text-ink-soft">
            {labels[i]}
          </p>
        </div>
      ))}
    </div>
  );
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "GBP",
      maximumFractionDigits: 0,
    }).format(amount ?? 0);
  } catch {
    return `${(amount ?? 0).toFixed(0)} ${currency || "GBP"}`;
  }
}
