// ============================================================================
// Instructor · Salary
//
// The instructor's own pay run. This mirrors the admin payroll page, but it is
// read-mostly: the only write an instructor owns is confirming their own count
// (pending → instructor_confirmed), which lives inline on each SalaryRow.
//
// The list is RLS-scoped: the "instructors read own payroll" policy means this
// query only ever returns session_payroll rows where instructor_id =
// my_instructor_id(). We still resolve the instructor id explicitly so an
// unlinked profile degrades to an empty list rather than erroring.
//
// Pay amounts are numeric(10,2) DECIMALS (e.g. 25.00), so totals are summed as
// plain numbers and formatted with Intl.NumberFormat — never the /100
// formatMoney helper.
// ============================================================================
import { requireRole } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { SalaryRow, type SalaryListRow } from "./SalaryRow";

export const dynamic = "force-dynamic";

type CommissionSaleRow = {
  id: string;
  customer_id: string;
  created_at: string;
  sale_amount_cents: number | null;
  sale_currency: string | null;
  commission_amount_cents: number | null;
  commission_rate_bps: number | null;
  package?: { name: string | null } | null;
  customer?: {
    name: string | null;
    email: string | null;
    profile?: {
      full_name: string | null;
      email: string | null;
    } | null;
  } | null;
};

type MinorTotals = Record<string, number>;

export default async function InstructorSalaryPage() {
  const profile = await requireRole("instructor", "/instructor/salary");
  const supabase = await createClient();

  // Resolve the signed-in instructor. An admin viewing the portal, or a profile
  // not yet linked to an instructor row, simply has no salary here.
  const { data: instructor } = await supabase
    .from("instructors")
    .select("id")
    .eq("profile_id", profile.id)
    .single();

  const { data } = instructor
    ? await supabase
        .from("session_payroll")
        .select(
          `id, session_id, attendance_count, computed_amount, currency, status,
           instructor_confirmed_at, admin_approved_at, paid_at,
           session:sessions(
             title, starts_at,
             studio:studios(name, timezone),
             class_type:class_types(name)
           )`,
        )
        .eq("instructor_id", instructor.id)
        .order("created_at", { ascending: false })
    : { data: [] };

  const rows = (data ?? []) as unknown as SalaryListRow[];

  const service = createServiceClient();
  const { data: commissionData } = await service
    .from("credit_ledger")
    .select(
      `id, customer_id, created_at, sale_amount_cents, sale_currency,
       commission_amount_cents, commission_rate_bps,
       package:packages(name),
       customer:customers(
         name, email,
         profile:profiles(full_name,email)
       )`,
    )
    .eq("reason", "purchase")
    .eq("sold_by", profile.id)
    .gt("commission_amount_cents", 0)
    .order("created_at", { ascending: false })
    .limit(250);

  const commissionRows =
    (commissionData ?? []) as unknown as CommissionSaleRow[];
  const currentMonth = monthKey(new Date(), "Asia/Ho_Chi_Minh");
  const monthCommissionRows = commissionRows.filter(
    (row) =>
      monthKey(new Date(row.created_at), "Asia/Ho_Chi_Minh") === currentMonth,
  );
  const monthCommissionTotals = sumMinor(
    monthCommissionRows,
    "commission_amount_cents",
  );
  const monthSalesTotals = sumMinor(monthCommissionRows, "sale_amount_cents");
  const allCommissionTotals = sumMinor(
    commissionRows,
    "commission_amount_cents",
  );

  // Totals from the instructor's point of view. "Owed" is everything not yet
  // paid and not in dispute; "paid" is settled. "To confirm" nudges them toward
  // the rows still waiting on their sign-off. Currency is read off the first row.
  const currency = rows[0]?.currency ?? "GBP";
  const totals = rows.reduce(
    (acc, r) => {
      const amount = r.computed_amount ?? 0;
      if (r.status === "paid") acc.paid += amount;
      else if (r.status !== "disputed") acc.owed += amount;

      if (r.status === "pending") acc.toConfirm += 1;
      return acc;
    },
    { owed: 0, paid: 0, toConfirm: 0 },
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Salary</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your pay per session plus a separate 2.5% commission tracker for paid
          packages you issue to customers.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Commission this month"
          value={formatMinorTotals(monthCommissionTotals)}
          detail="2.5% of package sales you issued"
        />
        <MetricCard
          label="Packages sold this month"
          value={monthCommissionRows.length}
          detail="Instructor-issued paid packages"
        />
        <MetricCard
          label="Package sales this month"
          value={formatMinorTotals(monthSalesTotals)}
          detail="Actual amount charged after discounts"
        />
        <MetricCard
          label="All-time commission"
          value={formatMinorTotals(allCommissionTotals)}
          detail={
            commissionRows.length +
            " tracked package sale" +
            (commissionRows.length === 1 ? "" : "s")
          }
        />
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          {rows.length > 0 ? (
            <ul className="space-y-3">
              {rows.map((row) => (
                <SalaryRow key={row.id} row={row} />
              ))}
            </ul>
          ) : (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              No salary records yet. Once a class you taught is recomputed, its
              pay appears here for you to confirm.
            </div>
          )}
        </section>

        <aside className="lg:col-span-1">
          <div className="card sticky top-24 p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">At a glance</h2>
            <dl className="space-y-3">
              <SummaryStat label="Owed" value={formatTotal(totals.owed, currency)} />
              <SummaryStat label="Paid" value={formatTotal(totals.paid, currency)} />
              <SummaryStat label="To confirm" value={totals.toConfirm} />
            </dl>

            <p className="mt-5 text-xs text-ink-soft">
              &ldquo;Owed&rdquo; counts every record not yet paid and not in
              dispute. Confirming a row doesn&rsquo;t change the amount — it tells
              the admin you stand behind the headcount.
            </p>
          </div>
        </aside>
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-stone-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">
            Package commission history
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            Commission is 2.5% of the amount actually charged for each paid
            package you issue.
          </p>
        </div>

        {commissionRows.length > 0 ? (
          <ul className="divide-y divide-stone-100">
            {commissionRows.slice(0, 25).map((sale) => (
              <li
                key={sale.id}
                className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {sale.customer?.profile?.full_name?.trim() ||
                      sale.customer?.name?.trim() ||
                      sale.customer?.profile?.email ||
                      sale.customer?.email ||
                      "Customer"}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {sale.package?.name ?? "Package"} ·{" "}
                    {formatCommissionDate(sale.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-5 text-right">
                  <div>
                    <p className="text-xs text-ink-soft">Sale</p>
                    <p className="text-sm font-medium tabular-nums text-ink">
                      {formatMoney(
                        sale.sale_amount_cents ?? 0,
                        sale.sale_currency ?? "VND",
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-soft">
                      {(sale.commission_rate_bps ?? 250) / 100}% commission
                    </p>
                    <p className="text-sm font-semibold tabular-nums text-emerald-700">
                      {formatMoney(
                        sale.commission_amount_cents ?? 0,
                        sale.sale_currency ?? "VND",
                      )}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-5 py-10 text-center text-sm text-ink-muted">
            No package commissions yet. A sale appears here when you issue a
            paid package to a customer.
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | string;
  detail: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink-muted">{detail}</p>
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
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "GBP",
    }).format(amount ?? 0);
  } catch {
    return `${(amount ?? 0).toFixed(2)} ${currency || "GBP"}`;
  }
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

function sumMinor(
  rows: CommissionSaleRow[],
  field: "sale_amount_cents" | "commission_amount_cents",
): MinorTotals {
  const totals: MinorTotals = {};
  for (const row of rows) {
    const currency = (row.sale_currency ?? "VND").toUpperCase();
    totals[currency] = (totals[currency] ?? 0) + Number(row[field] ?? 0);
  }
  return totals;
}

function formatMinorTotals(totals: MinorTotals): string {
  const entries = Object.entries(totals).filter(([, amount]) => amount !== 0);
  if (entries.length === 0) return formatMoney(0, "VND");
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(" · ");
}

function formatCommissionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(date);
  } catch {
    return "";
  }
}
