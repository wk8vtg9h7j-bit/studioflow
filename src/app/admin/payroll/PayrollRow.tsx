// ============================================================================
// PayrollRow — one computed payroll record in the admin list.
//
// Payroll rows are not authored, they are *reviewed*: the row surfaces the
// session, the instructor, the attendance count that drove the amount, and the
// computed pay, then offers the admin the transitions the record's current
// status allows. Each action is a tiny <form> posting a hidden id/session_id to
// the matching server action — no client state beyond the recalc panel toggle.
//
// Pay amounts are numeric(10,2) DECIMALS (e.g. 25.00), not minor units, so they
// go through formatMajorMoney, which converts before delegating to formatMoney.
// ============================================================================
"use client";

import { useState } from "react";
import { formatMajorMoney, humanizeLabel } from "@/lib/format";
import type { PayrollStatus } from "@/lib/types";
import {
  approvePayrollAction,
  disputePayrollAction,
  markPaidAction,
  recalcPayrollAction,
} from "./actions";

export type PayrollListRow = {
  id: string;
  session_id: string;
  attendance_count: number;
  computed_amount: number;
  currency: string;
  status: PayrollStatus;
  instructor_confirmed_at: string | null;
  admin_approved_at: string | null;
  paid_at: string | null;
  instructor?: { display_name: string | null } | null;
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

export function PayrollRow({ row }: { row: PayrollListRow }) {
  const [recalcOpen, setRecalcOpen] = useState(false);

  const instructorName = row.instructor?.display_name ?? "Unassigned";
  const sessionTitle =
    row.session?.title ?? row.session?.class_type?.name ?? "Untitled session";
  const studioName = row.session?.studio?.name ?? null;
  const when = formatWhen(
    row.session?.starts_at ?? null,
    row.session?.studio?.timezone ?? null,
  );
  const amount = formatMajorMoney(row.computed_amount, row.currency);
  const statusClass = STATUS_STYLES[row.status] ?? "bg-stone-100 text-ink-muted";

  return (
    <li className="card overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700"
          aria-hidden
        >
          {initials(instructorName)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-ink">{instructorName}</p>
            <span className={`badge ${statusClass}`}>
              {humanizeLabel(row.status)}
            </span>
          </div>
          <p className="truncate text-xs text-ink-muted">
            {sessionTitle}
            {studioName ? ` · ${studioName}` : ""}
            {when ? ` · ${when}` : ""}
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
          <button
            type="button"
            onClick={() => setRecalcOpen((v) => !v)}
            className="btn-secondary"
          >
            {recalcOpen ? "Close" : "Recalc"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3">
        {row.status !== "admin_approved" && row.status !== "paid" && (
          <form action={approvePayrollAction}>
            <input type="hidden" name="id" value={row.id} />
            <button type="submit" className="btn-secondary">
              Approve
            </button>
          </form>
        )}

        {row.status === "admin_approved" && (
          <form action={markPaidAction}>
            <input type="hidden" name="id" value={row.id} />
            <button type="submit" className="btn-primary">
              Mark paid
            </button>
          </form>
        )}

        {row.status !== "disputed" && row.status !== "paid" && (
          <form action={disputePayrollAction}>
            <input type="hidden" name="id" value={row.id} />
            <button type="submit" className="btn-ghost text-rose-700">
              Dispute
            </button>
          </form>
        )}

        <div className="ml-auto text-[11px] text-ink-soft">
          {row.paid_at
            ? `Paid ${formatStamp(row.paid_at)}`
            : row.admin_approved_at
              ? `Approved ${formatStamp(row.admin_approved_at)}`
              : row.instructor_confirmed_at
                ? `Confirmed ${formatStamp(row.instructor_confirmed_at)}`
                : "Awaiting confirmation"}
        </div>
      </div>

      {recalcOpen && (
        <div className="border-t border-stone-200 bg-stone-50 px-5 py-4">
          <form action={recalcPayrollAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="session_id" value={row.session_id} />
            <div>
              <label
                className="label"
                htmlFor={`attendance-${row.id}`}
              >
                Attendance override{" "}
                <span className="text-ink-soft">(blank = live count)</span>
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
            <button type="submit" className="btn-secondary">
              Recompute
            </button>
            <p className="basis-full text-xs text-ink-soft">
              Re-resolves the pay rule and refreshes the amount. Leave the field
              empty to recount live bookings, or pin a number for a walk-in not
              captured by a booking.
            </p>
          </form>
        </div>
      )}
    </li>
  );
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
