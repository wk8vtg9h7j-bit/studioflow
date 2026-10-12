import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { formatMoney, formatMajorMoney } from "@/lib/format";
import {
  instructorWeek,
  instructorStudioKey,
  instructorStudioName,
  instructorStudioOrder,
  instructorPortalHref,
  studioParam,
} from "@/lib/instructorWeek";
import { SalaryRow, type SalaryListRow } from "./SalaryRow";

export const dynamic = "force-dynamic";

type Params = { week?: string | string[]; studio?: string | string[] };
type Totals = Record<string, number>;
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
    profile?: { full_name: string | null; email: string | null } | null;
  } | null;
};

function addAmount(totals: Totals, currency: string | null, amount: number) {
  const code = (currency || "VND").toUpperCase();
  totals[code] = (totals[code] ?? 0) + Number(amount || 0);
}

function sumPay(rows: SalaryListRow[]): Totals {
  const totals: Totals = {};
  for (const row of rows) addAmount(totals, row.currency, row.computed_amount);
  return totals;
}

function sumCommissions(rows: CommissionSaleRow[], field: "commission_amount_cents" | "sale_amount_cents"): Totals {
  const totals: Totals = {};
  for (const row of rows) addAmount(totals, row.sale_currency, row[field] ?? 0);
  return totals;
}

function payText(totals: Totals): string {
  const entries = Object.entries(totals);
  if (!entries.length) return formatMajorMoney(0, "VND");
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => formatMajorMoney(amount, currency))
    .join(" · ");
}

function commissionText(totals: Totals): string {
  const entries = Object.entries(totals);
  if (!entries.length) return formatMoney(0, "VND");
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(" · ");
}

function monthKey(date: Date): string {
  const format = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).formatToParts(date);
  return (format.find((p) => p.type === "year")?.value ?? "") + "-" +
    (format.find((p) => p.type === "month")?.value ?? "");
}

function saleDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
}

export default async function InstructorSalaryPage({
  searchParams,
}: {
  searchParams?: Params | Promise<Params>;
}) {
  const params = (await searchParams) ?? {};
  const week = instructorWeek(params.week);
  const selectedStudio = studioParam(params.studio);
  const profile = await requireRole("instructor", "/instructor/salary");
  const supabase = await createClient();
  const service = createServiceClient();
  const commissionPromise = service
    .from("credit_ledger")
    .select(
      "id, customer_id, created_at, sale_amount_cents, sale_currency, commission_amount_cents, commission_rate_bps, package:packages(name), customer:customers(name, email, profile:profiles(full_name,email))",
    )
    .eq("reason", "purchase")
    .eq("sold_by", profile.id)
    .gt("commission_amount_cents", 0)
    .order("created_at", { ascending: false })
    .limit(1000);

  const { data: instructor } = await supabase
    .from("instructors")
    .select("id")
    .eq("profile_id", profile.id)
    .single();


  // !inner ensures session date filters apply to the parent payroll rows;
  // unlike a 1,000-row all-time list, each week shows its complete pay run.
  const payrollPromise = instructor
    ? supabase
        .from("session_payroll")
        .select(
          "id, session_id, attendance_count, computed_amount, currency, status, instructor_confirmed_at, admin_approved_at, paid_at, session:sessions!inner(title, starts_at, studio:studios(name, timezone), class_type:class_types(name))",
        )
        .eq("instructor_id", instructor.id)
        .gte("session.starts_at", week.from)
        .lt("session.starts_at", week.until)
        .order("created_at", { ascending: false })
    : Promise.resolve({ data: [], error: null });


  const [{ data, error }, { data: commissionData }] = await Promise.all([
    payrollPromise,
    commissionPromise,
  ]);

  const allRows = (data ?? []) as unknown as SalaryListRow[];
  const rows = allRows
    .filter((row) => selectedStudio === "all" ||
      instructorStudioKey(row.session?.studio?.name) === selectedStudio)
    .sort((a, b) => (a.session?.starts_at ?? "").localeCompare(b.session?.starts_at ?? ""));
  const pending = rows.filter((row) => row.status === "pending");
  const unpaid = rows.filter((row) => row.status !== "paid" && row.status !== "disputed");
  const paid = rows.filter((row) => row.status === "paid");
  const disputed = rows.filter((row) => row.status === "disputed");

  const groups = new Map<string, SalaryListRow[]>();
  for (const row of rows) {
    const key = instructorStudioKey(row.session?.studio?.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  const studioKeys = Array.from(new Set([
    ...(selectedStudio === "all" ? ["downtown", "hideaway"] : [selectedStudio]),
    ...groups.keys(),
  ])).sort(instructorStudioOrder);

  // Commissions remain distinct from class payroll. Never mix a sale's minor
  // units with payroll's major-unit DECIMAL amounts.
  const commissionRows = (commissionData ?? []) as unknown as CommissionSaleRow[];
  const month = monthKey(new Date());
  const monthSales = commissionRows.filter((row) => monthKey(new Date(row.created_at)) === month);
  const weekSales = commissionRows.filter((row) =>
    row.created_at >= new Date(week.from).toISOString() &&
    row.created_at < new Date(week.until).toISOString(),
  );

  const salaryUrl = (weekStart: string, studio = selectedStudio) =>
    instructorPortalHref("/instructor/salary", weekStart, studio);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">My salary</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Weekly class pay, organised by studio. Confirm attendance directly beside each class.
          </p>
        </div>
        <Link
          href={instructorPortalHref("/instructor", week.start, selectedStudio)}
          className="btn-secondary"
        >
          View this week&apos;s classes →
        </Link>
      </header>

      <div className="card space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={salaryUrl(week.previous)} className="btn-secondary" aria-label="Previous week">
            ← Previous
          </Link>
          <div className="text-center">
            <p className="text-base font-semibold text-ink">{week.label}</p>
            <p className="text-xs text-ink-soft">{week.isCurrent ? "This week" : "Monday – Sunday"}</p>
          </div>
          <Link href={salaryUrl(week.next)} className="btn-secondary" aria-label="Next week">
            Next →
          </Link>
        </div>
        {!week.isCurrent && (
          <div className="text-center">
            <Link href={salaryUrl(instructorWeek().start)} className="text-sm font-medium text-brand-700 underline">
              Jump to this week
            </Link>
          </div>
        )}
        <nav className="flex flex-wrap gap-2 border-t border-stone-100 pt-4" aria-label="Studio filter">
          {[
            { value: "all", label: "All studios" },
            { value: "downtown", label: "Downtown" },
            { value: "hideaway", label: "Hideaway" },
          ].map((option) => (
            <Link
              key={option.value}
              href={salaryUrl(week.start, option.value)}
              aria-current={selectedStudio === option.value ? "page" : undefined}
              className={
                "rounded-full px-4 py-2 text-sm font-medium transition-colors " +
                (selectedStudio === option.value
                  ? "bg-ink text-white"
                  : "border border-stone-200 bg-white text-ink-muted hover:border-stone-400")
              }
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </div>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Total class pay" value={payText(sumPay(rows))} detail={rows.length + " payroll records this week"} />
        <Metric label="Unpaid" value={payText(sumPay(unpaid))} detail="Pending, confirmed or approved" />
        <Metric label="Paid" value={payText(sumPay(paid))} detail="Marked paid for this week's classes" />
        <Metric label="To confirm" value={pending.length} detail="Classes awaiting your headcount" emphasise={pending.length > 0} />
      </section>

      {disputed.length > 0 && (
        <p className="text-sm text-rose-700">
          {disputed.length} disputed payroll record{disputed.length === 1 ? "" : "s"} shown below; excluded from unpaid totals.
        </p>
      )}
      {error && <div className="card border-rose-200 p-4 text-sm text-rose-700">Salary could not be loaded. Please refresh.</div>}

      {!error && studioKeys.map((key) => {
        const studioRows = groups.get(key) ?? [];
        const payable = studioRows.filter((row) => row.status !== "disputed");
        return (
          <section key={key} className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-4 py-4 sm:px-5">
              <div>
                <h2 className="text-lg font-semibold text-ink">
                  {instructorStudioName(key, studioRows[0]?.session?.studio?.name)}
                </h2>
                <p className="text-xs text-ink-muted">
                  {studioRows.length} class{studioRows.length === 1 ? "" : "es"} · {studioRows.filter((row) => row.status === "pending").length} to confirm
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums text-ink">{payText(sumPay(payable))}</p>
                <p className="text-xs text-ink-soft">Excludes disputed pay</p>
              </div>
            </div>
            {studioRows.length === 0 ? (
              <p className="px-5 py-7 text-sm text-ink-muted">No payroll entries at this studio for this week.</p>
            ) : (
              <ul className="space-y-3 p-3 sm:p-4">
                {studioRows.map((row) => <SalaryRow key={row.id} row={row} />)}
              </ul>
            )}
          </section>
        );
      })}

      <section className="card overflow-hidden">
        <div className="border-b border-stone-200 px-4 py-4 sm:px-5">
          <h2 className="font-semibold text-ink">Package sales commission · 2.5%</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Tracked separately from class pay. Includes paid packages from classes you teach, even when an admin records payment.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-5">
          <Metric label="This week" value={commissionText(sumCommissions(weekSales, "commission_amount_cents"))} detail="Commission earned on sales" />
          <Metric label="This month" value={commissionText(sumCommissions(monthSales, "commission_amount_cents"))} detail={monthSales.length + " tracked package sales"} />
          <Metric label="Monthly sales" value={commissionText(sumCommissions(monthSales, "sale_amount_cents"))} detail="Customer spend after discounts" />
        </div>
        <details className="border-t border-stone-100">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-brand-700">
            See recent package commission history
          </summary>
          {commissionRows.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-ink-muted">No instructor-issued paid packages recorded.</p>
          ) : (
            <ul className="divide-y divide-stone-100 border-t border-stone-100">
              {commissionRows.slice(0, 25).map((sale) => (
                <li key={sale.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      {sale.customer?.profile?.full_name?.trim() ||
                        sale.customer?.name?.trim() ||
                        sale.customer?.profile?.email ||
                        sale.customer?.email || "Customer"}
                    </p>
                    <p className="text-xs text-ink-muted">{sale.package?.name ?? "Package"} · {saleDate(sale.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-ink-soft">
                      Sale: {formatMoney(sale.sale_amount_cents ?? 0, sale.sale_currency ?? "VND")}
                    </p>
                    <p className="text-sm font-semibold tabular-nums text-emerald-700">
                      +{formatMoney(sale.commission_amount_cents ?? 0, sale.sale_currency ?? "VND")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </details>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  emphasise = false,
}: {
  label: string;
  value: string | number;
  detail: string;
  emphasise?: boolean;
}) {
  return (
    <div className="card min-w-0 px-4 py-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className={"mt-1 break-words text-xl font-semibold tabular-nums " + (emphasise ? "text-amber-700" : "text-ink")}>
        {value}
      </p>
      <p className="mt-1 text-xs text-ink-soft">{detail}</p>
    </div>
  );
}
