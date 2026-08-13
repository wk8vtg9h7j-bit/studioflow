// ============================================================================
// Admin · Customers (CRM)
//
// The customer book. Records arrive through public sign-up, so this page is
// view/curate-oriented rather than a create form: admins read contact details,
// adjust lifecycle status, tag for segmentation, and keep internal notes.
//
// Each row shows a live credit balance, computed per-customer through the
// credit_balance() security-definer RPC (sum of non-expired ledger deltas).
// ============================================================================
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Package } from "@/lib/types";
import {
  CustomerRow,
  type CustomerWithProfile,
  type PurchaseRow,
} from "./CustomerRow";
import { AddCustomer } from "./AddCustomer";
import { CustomerFilters } from "./CustomerFilters";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams?: { q?: string; status?: string };
}) {
  const q = searchParams?.q?.trim() ?? "";
  const status = searchParams?.status?.trim() ?? "";
  const supabase = await createClient();

  const { data } = await supabase
    .from("customers")
    .select("*, profile:profiles(full_name, email, phone)")
    .order("created_at", { ascending: false });

  const customers = (data ?? []) as CustomerWithProfile[];

  // Search matches the same fields the row displays: the profile values when a
  // login exists, otherwise the details stored directly on the walk-in record.
  // This runs in JS because PostgREST cannot filter an embedded relation
  // without !inner, which would silently drop every walk-in (profile is null).
  const needle = q.toLowerCase();
  const visible = customers.filter((c) => {
    if (status && c.status !== status) return false;
    if (!needle) return true;
    const haystack = [
      c.profile?.full_name ?? c.name,
      c.profile?.email ?? c.email,
      c.profile?.phone ?? c.phone,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });

  // Active packages an admin can grant (sell) to a customer as a clip-card.
  const { data: packageData } = await supabase
    .from("packages")
    .select("*")
    .eq("active", true)
    .order("price_cents", { ascending: true });

  const packages = (packageData ?? []) as Package[];

  // Resolve every customer's live credit balance in parallel via the RPC.
  const balances = await Promise.all(
    customers.map(async (customer) => {
      const { data: balance } = await supabase.rpc("credit_balance", {
        p_customer: customer.id,
      });
      return [customer.id, typeof balance === "number" ? balance : 0] as const;
    }),
  );
  const balanceById = new Map<string, number>(balances);

  // Purchase rows (one per clip-card sold) so admins can correct how each was
  // paid. Read with the service client: credit_ledger RLS is proven for admin
  // inserts but not for reads from this page.
  const purchasesByCustomer = new Map<string, PurchaseRow[]>();
  if (customers.length > 0) {
    const service = createServiceClient();
    const { data: purchases } = await service
      .from("credit_ledger")
      .select("id,customer_id,delta,payment_method,created_at,package:packages(name)")
      .eq("reason", "purchase")
      .in(
        "customer_id",
        customers.map((c) => c.id),
      )
      .order("created_at", { ascending: false });

    for (const row of (purchases ?? []) as unknown as PurchaseRow[]) {
      const list = purchasesByCustomer.get(row.customer_id) ?? [];
      list.push(row);
      purchasesByCustomer.set(row.customer_id, list);
    }
  }

  const counts = customers.reduce(
    (acc, c) => {
      acc.total += 1;
      if (c.status === "active") acc.active += 1;
      else if (c.status === "lead") acc.leads += 1;
      else if (c.status === "inactive") acc.inactive += 1;
      return acc;
    },
    { total: 0, active: 0, leads: 0, inactive: 0 },
  );

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
          <CustomerFilters q={q || undefined} status={status || undefined} />
          {visible.length > 0 ? (
            <ul className="space-y-3">
              {visible.map((customer) => (
                <CustomerRow
                  key={customer.id}
                  customer={customer}
                  creditBalance={balanceById.get(customer.id) ?? 0}
                  packages={packages}
                  purchases={purchasesByCustomer.get(customer.id) ?? []}
                />
              ))}
            </ul>
          ) : (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              {customers.length > 0 ? (
                <>
                  No customers match that search. Try a different name, email,
                  or phone number.
                </>
              ) : (
                <>
                  No customers yet. They&apos;ll appear here as soon as people
                  sign up and start booking classes.
                </>
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
              New customers register through the public sign-up flow. Open any
              record to update its status, tags, or notes.
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
