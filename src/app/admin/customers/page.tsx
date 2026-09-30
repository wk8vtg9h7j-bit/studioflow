// ============================================================================
// Admin · Customers (CRM)
//
// Adds actionable CRM segments and customer intelligence on top of the existing
// contact / package tools. All analytics are derived read-only from the existing
// bookings, credit ledger and retail sales tables.
// ============================================================================
import { createServiceClient } from "@/lib/supabase/server";
import type { Package } from "@/lib/types";
import {
  CUSTOMER_SEGMENTS,
  segmentMeta,
  type CustomerSegmentKey,
} from "@/lib/customerAnalytics";
import { loadCustomerAnalytics } from "@/lib/customerAnalytics.server";
import { CustomerRow, type CustomerWithProfile } from "./CustomerRow";
import { AddCustomer } from "./AddCustomer";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const FEATURED_SEGMENTS: CustomerSegmentKey[] = [
  "registered_never_booked",
  "one_credit",
  "expiring_7d",
  "first_visit_no_package",
  "inactive_30",
  "zero_credits",
];

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    segment?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const status =
    params.status === "active" ||
    params.status === "lead" ||
    params.status === "inactive"
      ? params.status
      : "";
  const selectedSegment = segmentMeta(params.segment)?.key;
  const requestedPage = Math.max(1, Number(params.page ?? "1") || 1);

  const service = createServiceClient();
  const [analytics, packagesRes] = await Promise.all([
    loadCustomerAnalytics(),
    service
      .from("packages")
      .select("*")
      .eq("active", true)
      .order("price_cents", { ascending: true }),
  ]);
  const packages = (packagesRes.data ?? []) as Package[];

  const counts = analytics.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row.customer.status === "active") acc.active += 1;
      else if (row.customer.status === "lead") acc.leads += 1;
      else if (row.customer.status === "inactive") acc.inactive += 1;
      return acc;
    },
    { total: 0, active: 0, leads: 0, inactive: 0 },
  );

  const segmentCounts = new Map<CustomerSegmentKey, number>();
  for (const segment of CUSTOMER_SEGMENTS) segmentCounts.set(segment.key, 0);
  for (const row of analytics) {
    for (const segment of row.segments) {
      segmentCounts.set(segment, (segmentCounts.get(segment) ?? 0) + 1);
    }
  }

  const needle = q.toLowerCase();
  const filtered = analytics.filter((row) => {
    if (status && row.customer.status !== status) return false;
    if (selectedSegment && !row.segments.includes(selectedSegment)) return false;
    if (!needle) return true;

    const haystack = [
      row.name,
      row.email,
      row.phone,
      ...(row.customer.tags ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(needle);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const customers = filtered.slice(start, start + PAGE_SIZE);
  const currentSegmentMeta = selectedSegment
    ? segmentMeta(selectedSegment)
    : null;

  function pageHref(nextPage: number): string {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (status) next.set("status", status);
    if (selectedSegment) next.set("segment", selectedSegment);
    if (nextPage > 1) next.set("page", String(nextPage));
    const qs = next.toString();
    return qs ? `/admin/customers?${qs}` : "/admin/customers";
  }

  const exportParams = new URLSearchParams();
  if (q) exportParams.set("q", q);
  if (status) exportParams.set("status", status);
  if (selectedSegment) exportParams.set("segment", selectedSegment);
  const exportHref = `/admin/customers/export${
    exportParams.toString() ? `?${exportParams.toString()}` : ""
  }`;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Customers
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            CRM, customer value, visit behaviour, credits and sales opportunities.
          </p>
        </div>
        <a href="/admin/marketing" className="btn-secondary w-full sm:w-auto">
          Marketing opportunities
        </a>
      </header>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Needs attention
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Click a segment to open the exact customer list.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {FEATURED_SEGMENTS.map((key) => {
            const meta = segmentMeta(key)!;
            const active = selectedSegment === key;
            return (
              <a
                key={key}
                href={`/admin/customers?segment=${key}`}
                className={`card p-4 transition hover:shadow-card ${
                  active ? "ring-2 ring-brand-500" : ""
                }`}
              >
                <p className="text-2xl font-semibold tabular-nums text-ink">
                  {segmentCounts.get(key) ?? 0}
                </p>
                <p className="mt-1 text-sm font-medium text-ink">{meta.shortLabel}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                  {meta.campaign}
                </p>
              </a>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          <AddCustomer />

          {currentSegmentMeta && (
            <div className="card border-brand-200 bg-brand-50/40 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {currentSegmentMeta.label}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {currentSegmentMeta.description} Suggested use:{" "}
                    {currentSegmentMeta.campaign}.
                  </p>
                </div>
                <a href={exportHref} className="btn-secondary shrink-0">
                  Export emails CSV
                </a>
              </div>
            </div>
          )}

          <form
            method="get"
            className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <div className="sm:col-span-2 xl:col-span-2">
              <label className="label" htmlFor="customer-search">
                Search
              </label>
              <input
                id="customer-search"
                name="q"
                type="search"
                className="input"
                defaultValue={q}
                placeholder="Name, email, phone or tag"
              />
            </div>

            <div>
              <label className="label" htmlFor="customer-status">
                Status
              </label>
              <select
                id="customer-status"
                name="status"
                className="input"
                defaultValue={status}
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="lead">Lead</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div>
              <label className="label" htmlFor="customer-segment">
                Segment
              </label>
              <select
                id="customer-segment"
                name="segment"
                className="input"
                defaultValue={selectedSegment ?? ""}
              >
                <option value="">All customers</option>
                {CUSTOMER_SEGMENTS.map((segment) => (
                  <option key={segment.key} value={segment.key}>
                    {segment.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2 sm:col-span-2 xl:col-span-4">
              <button type="submit" className="btn-primary">
                Filter
              </button>
              {(q || status || selectedSegment) && (
                <a href="/admin/customers" className="btn-secondary">
                  Clear
                </a>
              )}
              <a href={exportHref} className="btn-ghost ml-auto">
                Export CSV
              </a>
            </div>
          </form>

          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            {filtered.length} customer{filtered.length === 1 ? "" : "s"}
            {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
          </p>

          {customers.length > 0 ? (
            <ul className="space-y-3">
              {customers.map((row) => (
                <CustomerRow
                  key={row.customer.id}
                  customer={row.customer as CustomerWithProfile}
                  regularBalance={row.regularCredits}
                  privateBalance={row.privateCredits}
                  packages={packages}
                  visits={row.visits}
                  totalSpendCents={row.totalSpendCents}
                  spendCurrency={row.spendCurrency}
                  lastVisitAt={row.lastVisitAt}
                  nextBookingAt={row.nextBookingAt}
                  segments={row.segments}
                />
              ))}
            </ul>
          ) : (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              No customers match those filters.
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              {page > 1 ? (
                <a href={pageHref(page - 1)} className="btn-secondary">
                  Previous
                </a>
              ) : (
                <span />
              )}
              {page < totalPages ? (
                <a href={pageHref(page + 1)} className="btn-secondary">
                  Next
                </a>
              ) : (
                <span />
              )}
            </div>
          )}
        </section>

        <aside className="lg:col-span-1">
          <div className="card p-4 sm:p-5 lg:sticky lg:top-24">
            <h2 className="mb-4 text-sm font-semibold text-ink">At a glance</h2>
            <dl className="space-y-3">
              <SummaryStat label="Total members" value={counts.total} />
              <SummaryStat label="Active" value={counts.active} />
              <SummaryStat label="Leads" value={counts.leads} />
              <SummaryStat label="Inactive" value={counts.inactive} />
            </dl>

            <div className="my-5 h-px bg-stone-200" />
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              All opportunities
            </p>
            <div className="space-y-2">
              {CUSTOMER_SEGMENTS.map((segment) => (
                <a
                  key={segment.key}
                  href={`/admin/customers?segment=${segment.key}`}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-stone-50"
                >
                  <span className="text-ink-muted">{segment.shortLabel}</span>
                  <span className="font-semibold tabular-nums text-ink">
                    {segmentCounts.get(segment.key) ?? 0}
                  </span>
                </a>
              ))}
            </div>

            <p className="mt-5 text-xs text-ink-soft">
              Spend combines snapshotted package payments and recorded retail
              purchases. Credits use the same FIFO expiry logic as StudioFlow.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}
