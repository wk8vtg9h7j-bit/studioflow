// ============================================================================
// Admin · Customers (CRM)
//
// Performance notes:
// - customer/profile records are fetched once,
// - search/status filtering happens server-side before rendering,
// - only one page (50 rows) is hydrated,
// - credit balances are calculated from one batched ledger query rather than
//   two RPC round-trips per customer.
// ============================================================================
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Package } from "@/lib/types";
import { CustomerRow, type CustomerWithProfile } from "./CustomerRow";
import { AddCustomer } from "./AddCustomer";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const status =
    params.status === "active" ||
    params.status === "lead" ||
    params.status === "inactive"
      ? params.status
      : "";
  const requestedPage = Math.max(1, Number(params.page ?? "1") || 1);

  const supabase = await createClient();
  const service = createServiceClient();

  const [customersRes, packagesRes] = await Promise.all([
    supabase
      .from("customers")
      .select("*, profile:profiles(full_name,email,phone)")
      .order("created_at", { ascending: false }),
    supabase
      .from("packages")
      .select("*")
      .eq("active", true)
      .order("price_cents", { ascending: true }),
  ]);

  const allCustomers = (customersRes.data ?? []) as CustomerWithProfile[];
  const packages = (packagesRes.data ?? []) as Package[];

  const counts = allCustomers.reduce(
    (acc, customer) => {
      acc.total += 1;
      if (customer.status === "active") acc.active += 1;
      else if (customer.status === "lead") acc.leads += 1;
      else if (customer.status === "inactive") acc.inactive += 1;
      return acc;
    },
    { total: 0, active: 0, leads: 0, inactive: 0 },
  );

  const needle = q.toLowerCase();
  const filtered = allCustomers.filter((customer) => {
    if (status && customer.status !== status) return false;
    if (!needle) return true;

    const haystack = [
      customer.profile?.full_name,
      customer.profile?.email,
      customer.profile?.phone,
      customer.name,
      customer.email,
      customer.phone,
      ...(customer.tags ?? []),
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

  const balanceById = new Map<
    string,
    { regular: number; private: number }
  >();

  for (const customer of customers) {
    balanceById.set(customer.id, { regular: 0, private: 0 });
  }

  if (customers.length > 0) {
    const now = new Date();
    const { data: ledgerRows } = await service
      .from("credit_ledger")
      .select("customer_id,delta,pool,expires_at")
      .in(
        "customer_id",
        customers.map((customer) => customer.id),
      );

    for (const row of ledgerRows ?? []) {
      const item = row as {
        customer_id: string;
        delta: number;
        pool: string | null;
        expires_at: string | null;
      };

      if (item.expires_at && new Date(item.expires_at) <= now) continue;

      const balance = balanceById.get(item.customer_id);
      if (!balance) continue;

      if ((item.pool ?? "regular") === "private") {
        balance.private += item.delta;
      } else {
        balance.regular += item.delta;
      }
    }
  }

  function pageHref(nextPage: number): string {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (status) next.set("status", status);
    if (nextPage > 1) next.set("page", String(nextPage));
    const qs = next.toString();
    return qs ? `/admin/customers?${qs}` : "/admin/customers";
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Customers
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your CRM — contact details, lifecycle status, tags, and credit
          balances for every member.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          <AddCustomer />

          <form
            method="get"
            className="card flex flex-wrap items-end gap-3 p-4"
          >
            <div className="min-w-[14rem] flex-1">
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

            <div className="min-w-[10rem]">
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

            <button type="submit" className="btn-primary">
              Filter
            </button>
            {(q || status) && (
              <a href="/admin/customers" className="btn-secondary">
                Clear
              </a>
            )}
          </form>

          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            {filtered.length} customer{filtered.length === 1 ? "" : "s"}
            {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
          </p>

          {customers.length > 0 ? (
            <ul className="space-y-3">
              {customers.map((customer) => (
                <CustomerRow
                  key={customer.id}
                  customer={customer}
                  regularBalance={
                    balanceById.get(customer.id)?.regular ?? 0
                  }
                  privateBalance={
                    balanceById.get(customer.id)?.private ?? 0
                  }
                  packages={packages}
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
          <div className="card sticky top-24 p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">At a glance</h2>
            <dl className="space-y-3">
              <SummaryStat label="Total members" value={counts.total} />
              <SummaryStat label="Active" value={counts.active} />
              <SummaryStat label="Leads" value={counts.leads} />
              <SummaryStat label="Inactive" value={counts.inactive} />
            </dl>
            <p className="mt-5 text-xs text-ink-soft">
              Only 50 customer records are rendered at a time so the CRM stays
              responsive as your member list grows.
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
