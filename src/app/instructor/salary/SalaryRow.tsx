// ============================================================================
// SalaryRow — one of the instructor's own payroll records.
//
// The instructor mirror of the admin PayrollRow, but stripped to the single
// write an instructor owns: confirming their own count. There is no approve /
// mark-paid / dispute here — those are the admin's transitions. The instructor
// sees the session, the attendance that drove the amount, the computed pay, and
// (while the row is still pending) a small confirm form where they can either
// accept the computed headcount as-is or pin the number they actually taught
// before confirming.
//
// confirm_payroll() takes the PAYROLL ROW ID (row.id), not a session id, and
// self-authorizes against my_instructor_id(), so the hidden field is row.id.
//
// Pay amounts are numeric(10,2) DECIMALS (e.g. 25.00), not minor units, so we
// format them with Intl.NumberFormat directly rather than the /100 formatMoney.
// ============================================================================
"use client";

import { useState } from "react";
import { humanizeLabel } from "@/lib/format";
import type { PayrollStatus } from "@/lib/types";
import { confirmPayrollAction } from "../actions";

export type SalaryListRow = {
  id: string;
  session_id: string;
  attendance_count: number;
  computed_amount: number;
  currency: string;
  status: PayrollStatus;
  instructor_confirmed_at: string | null;
  admin_approved_at: string | null;
  paid_at: string | null;
  session?: {
    title: string | null;
    starts_at: string | null;
    studio?: { name: string | null; timezone: string | null } | null;
    class_type?: { name: string | null } | null;
  } | null;
};

const STATUS_STYLES: Record<PayrollStatus, string> = {
  pending: "bg-amber-50 text-amber-700",
  instructor_confirmed: "bg-brand-50 text-brand-700",
  admin_approved: "bg-emerald-50 text-emerald-700",
  paid: "bg-stone-100 text-ink-muted",
  disputed: "bg-rose-50 text-rose-700",
};

export function SalaryRow({ row }: { row: SalaryListRow }) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const sessionTitle =
    row.session?.title ?? row.session?.class_type?.name ?? "Untitled session";
  const studioName = row.session?.studio?.name ?? null;
  const when = formatWhen(
    row.session?.starts_at ?? null,
    row.session?.studio?.timezone ?? null,
  );
  const amount = formatAmount(row.computed_amount, row.currency);
  const statusClass = STATUS_STYLES[row.status] ?? "bg-stone-100 text-ink-muted";

  // The instructor can only confirm while the row is still pending. Once it's
  // confirmed (or past, into approved/paid/disputed) the count is locked in.
  const canConfirm = row.status === "pending";

  return (
    <li className="card overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-ink">{sessionTitle}</p>
            <span className={`badge ${statusClass}`}>
              {humanizeLabel(row.status)}
            </span>
          </div>
          <p className="truncate text-xs text-ink-muted">
            {studioName ? `${studioName}` : ""}
            {when ? `${studioName ? " · " : ""}${when}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-semibold text-ink">{amount}</p>
            <p className="text-[11px] uppercase tracking-wide text-ink-soft">
              {row.attendance_count}{" "}
              {row.attendance_count === 1 ? "head" : "heads"}
            </p>
          </div>
          {canConfirm && (
            <button
              type="button"
              onClick={() => setConfirmOpen((v) => !v)}
              className="btn-secondary"
            >
              {confirmOpen ? "Close" : "Confirm"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3">
        <div className="text-[11px] text-ink-soft">
          {row.paid_at
            ? `Paid ${formatStamp(row.paid_at)}`
            : row.admin_approved_at
              ? `Approved ${formatStamp(row.admin_approved_at)}`
              : row.instructor_confirmed_at
                ? `You confirmed ${formatStamp(row.instructor_confirmed_at)}`
                : "Awaiting your confirmation"}
        </div>
      </div>

      {confirmOpen && canConfirm && (
        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4">
          <form
            action={confirmPayrollAction}
            className="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="id" value={row.id} />
            <div>
              <label className="label" htmlFor={`attendance-${row.id}`}>
                Headcount you taught{" "}
                <span className="text-ink-soft">(blank = keep computed)</span>
              </label>
              <input
                id={`attendance-${row.id}`}
                name="attendance"
                type="number"
                min={0}
                step={1}
                className="input w-40"
                placeholder={String(row.attendance_count)}
              />
            </div>
            <button type="submit" className="btn-primary">
              Confirm count
            </button>
            <p className="basis-full text-xs text-ink-soft">
              Confirm to stand behind this attendance. Leave the field blank to
              accept the computed count, or pin the number you actually taught
              (e.g. a walk-in) before confirming — the admin reviews it next.
            </p>
          </form>
        </div>
      )}
    </li>
  );
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "GBP",
    }).format(amount ?? 0);
  } catch {
    return `${(amount ?? 0).toFixed(2)} ${currency || "GBP"}`;
  }
}

function formatWhen(startsAt: string | null, timezone: string | null): string {
  if (!startsAt) return "";
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone || "UTC",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(date);
  }
}

function formatStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(date);
}
