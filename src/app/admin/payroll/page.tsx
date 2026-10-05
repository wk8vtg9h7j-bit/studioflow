import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PayrollRow, type PayrollListRow } from "./PayrollRow";

export const dynamic = "force-dynamic";

type PayrollView = "to-pay" | "disputed" | "paid-current" | "paid-history";

type SearchParams = {
  view?: string | string[];
};

const VALID_VIEWS = new Set<PayrollView>([
  "to-pay",
  "disputed",
  "paid-current",
  "paid-history",
]);

export default async function PayrollPage({
  searchParams,
}: {
  searchParams?: SearchParams | Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const rawView = Array.isArray(params.view) ? params.view[0] : params.view;
  const view: PayrollView = VALID_VIEWS.has(rawView as PayrollView)
    ? (rawView as PayrollView)
    : "to-pay";

  const supabase = await createClient();

  // Zero-value payroll is intentionally excluded from the normal payroll
  // surface. Those rows remain in the database for audit/history, but cannot
  // clutter the pay run or be approved accidentally.
  const { data } = await supabase
    .from("session_payroll")
    .select(
      `id, session_id, attendance_count, computed_amount, currency, status,
       instructor_confirmed_at, admin_approved_at, paid_at,
       instructor:instructors(display_name),
       session:sessions(
         title, starts_at,
         studio:studios(name, timezone),
         class_type:class_types(name)
       )`,
    )
    .gt("computed_amount", 0)
    .order("created_at", { ascending: false });

  const payableRows = (data ?? []) as unknown as PayrollListRow[];
  const currentMonth = monthKey(new Date(), "Asia/Ho_Chi_Minh");

  const buckets = {
    toPay: payableRows.filter(
      (row) => row.status !== "paid" && row.status !== "disputed",
    ),
    disputed: payableRows.filter((row) => row.status === "disputed"),
    paidCurrent: payableRows.filter(
      (row) =>
        row.status === "paid" &&
        rowMonthKey(row) === currentMonth,
    ),
    paidHistory: payableRows.filter(
      (row) =>
        row.status === "paid" &&
        rowMonthKey(row) !== currentMonth,
    ),
  };

  const rows =
    view === "disputed"
      ? buckets.disputed
      : view === "paid-current"
        ? buckets.paidCurrent
        : view === "paid-history"
          ? buckets.paidHistory
          : buckets.toPay;

  const currency = payableRows[0]?.currency ?? "VND";
  const totals = {
    toPay: sumAmount(buckets.toPay),
    disputed: sumAmount(buckets.disputed),
    paidCurrent: sumAmount(buckets.paidCurrent),
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Payroll
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Only payable classes are shown. Zero-pay rows stay in the audit
          history but are hidden here.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Payroll filters">
        <FilterLink
          href="/admin/payroll?view=to-pay"
          active={view === "to-pay"}
          label="To pay"
          count={buckets.toPay.length}
        />
        <FilterLink
          href="/admin/payroll?view=disputed"
          active={view === "disputed"}
          label="Disputed"
          count={buckets.disputed.length}
        />
        <FilterLink
          href="/admin/payroll?view=paid-current"
          active={view === "paid-current"}
          label="Paid this month"
          count={buckets.paidCurrent.length}
        />
        <FilterLink
          href="/admin/payroll?view=paid-history"
          active={view === "paid-history"}
          label="Paid history"
          count={buckets.paidHistory.length}
        />
      </nav>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          {rows.length > 0 ? (
            <ul className="space-y-3">
              {rows.map((row) => (
                <PayrollRow key={row.id} row={row} />
              ))}
            </ul>
          ) : (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              {emptyMessage(view)}
            </div>
          )}
        </section>

        <aside className="lg:col-span-1">
          <div className="card p-4 sm:p-5 lg:sticky lg:top-24">
            <h2 className="mb-4 text-sm font-semibold text-ink">At a glance</h2>

            <dl className="space-y-3">
              <SummaryStat
                label="To pay"
                value={formatTotal(totals.toPay, currency)}
              />
              <SummaryStat
                label="Disputed"
                value={formatTotal(totals.disputed, currency)}
              />
              <SummaryStat
                label="Paid this month"
                value={formatTotal(totals.paidCurrent, currency)}
              />
            </dl>

            <div className="my-5 h-px bg-stone-200" />

            <dl className="space-y-3">
              <SummaryStat label="To pay classes" value={buckets.toPay.length} />
              <SummaryStat label="Disputed" value={buckets.disputed.length} />
              <SummaryStat
                label="Paid this month"
                value={buckets.paidCurrent.length}
              />
            </dl>

            <p className="mt-5 text-xs leading-relaxed text-ink-soft">
              Paid classes from earlier months are kept under Paid history
              instead of mixing into the active pay run. Payroll with a 0 amount
              is hidden and cannot be approved.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function FilterLink({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full bg-ink px-4 py-2 text-sm font-medium text-white"
          : "rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-ink-muted hover:border-stone-300 hover:text-ink"
      }
    >
      {label} · {count}
    </Link>
  );
}

function SummaryStat({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

function rowMonthKey(row: PayrollListRow): string {
  return monthKey(
    row.session?.starts_at ? new Date(row.session.starts_at) : new Date(0),
    row.session?.studio?.timezone || "Asia/Ho_Chi_Minh",
  );
}

function monthKey(date: Date, timeZone: string): string {
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      timeZone,
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    return year && month ? `${year}-${month}` : "";
  } catch {
    return "";
  }
}

function sumAmount(rows: PayrollListRow[]): number {
  return rows.reduce((sum, row) => sum + Number(row.computed_amount ?? 0), 0);
}

function emptyMessage(view: PayrollView): string {
  if (view === "disputed") return "No disputed payroll records.";
  if (view === "paid-current") return "No payroll has been marked paid this month.";
  if (view === "paid-history") return "No older paid payroll records.";
  return "Nothing is waiting to be paid.";
}

function formatTotal(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "VND",
      maximumFractionDigits: currency === "VND" ? 0 : 2,
    }).format(amount ?? 0);
  } catch {
    return `${(amount ?? 0).toFixed(0)} ${currency || "VND"}`;
  }
}
