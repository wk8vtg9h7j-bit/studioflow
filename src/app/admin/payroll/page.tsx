// ============================================================================
// Admin · Payroll
//
// The pay run. Unlike the other admin sections this is a *review* surface, not
// a create form: rows are computed by recalc_payroll() and then walk a status
// flow (pending → instructor_confirmed → admin_approved → paid, + disputed).
// Admins read the computed amount, the attendance that drove it, and the
// instructor, then move each record along with the row's inline actions.
//
// Pay amounts are numeric(10,2) DECIMALS (e.g. 25.00), so the "owed" / "paid"
// totals are summed as plain numbers and formatted with Intl.NumberFormat —
// never the /100 formatMoney helper.
// ============================================================================
import { createClient } from "@/lib/supabase/server";
import { PayrollRow, type PayrollListRow } from "./PayrollRow";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const supabase = await createClient();

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
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as PayrollListRow[];

  // Totals are split by where the money sits in the flow. "Owed" is everything
  // not yet paid (and not parked in dispute); "paid" is settled. Currency is
  // read off the first row — a single studio book runs one currency in practice.
  const currency = rows[0]?.currency ?? "VND";
  const totals = rows.reduce(
    (acc, r) => {
      const amount = r.computed_amount ?? 0;
      acc.count += 1;
      if (r.status === "paid") acc.paid += amount;
      else if (r.status !== "disputed") acc.owed += amount;

      if (r.status === "pending") acc.pending += 1;
      else if (r.status === "instructor_confirmed") acc.confirmed += 1;
      else if (r.status === "admin_approved") acc.approved += 1;
      else if (r.status === "paid") acc.settled += 1;
      else if (r.status === "disputed") acc.disputed += 1;
      return acc;
    },
    {
      count: 0,
      owed: 0,
      paid: 0,
      pending: 0,
      confirmed: 0,
      approved: 0,
      settled: 0,
      disputed: 0,
    },
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Payroll
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Computed pay per session — review the attendance that drove each
          amount, then confirm, approve, and mark records paid.
        </p>
      </header>

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
              No payroll yet. Records appear here once a session is recomputed —
              open a session and recalc, or recompute straight from a row.
            </div>
          )}
        </section>

        <aside className="lg:col-span-1">
          <div className="card sticky top-24 p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">At a glance</h2>
            <dl className="space-y-3">
              <SummaryStat label="Owed" value={formatTotal(totals.owed, currency)} />
              <SummaryStat label="Paid" value={formatTotal(totals.paid, currency)} />
            </dl>

            <div className="my-5 h-px bg-stone-200" />

            <dl className="space-y-3">
              <SummaryStat label="Pending" value={totals.pending} />
              <SummaryStat label="Confirmed" value={totals.confirmed} />
              <SummaryStat label="Approved" value={totals.approved} />
              <SummaryStat label="Paid" value={totals.settled} />
              {totals.disputed > 0 && (
                <SummaryStat label="Disputed" value={totals.disputed} />
              )}
            </dl>

            <p className="mt-5 text-xs text-ink-soft">
              &ldquo;Owed&rdquo; counts every record not yet paid and not in
              dispute. Recompute a row to re-resolve its pay rule and refresh the
              amount.
            </p>
          </div>
        </aside>
      </div>
    </div>
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
    <div className="flex items-center justify-between">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

function formatTotal(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "VND",
      maximumFractionDigits: 0,
    }).format(amount ?? 0);
  } catch {
    return `${(amount ?? 0).toFixed(0)} ${currency || "VND"}`;
  }
}
