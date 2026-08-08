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
import { createClient } from "@/lib/supabase/server";
import type { Package } from "@/lib/types";
import { CustomerRow, type CustomerWithProfile } from "./CustomerRow";
import { AddCustomer } from "./AddCustomer";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("customers")
    .select("*, profile:profiles(full_name, email, phone)")
    .order("created_at", { ascending: false });

  const customers = (data ?? []) as CustomerWithProfile[];

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
          {customers.length > 0 ? (
            <ul className="space-y-3">
              {customers.map((customer) => (
                <CustomerRow
                  key={customer.id}
                  customer={customer}
                  creditBalance={balanceById.get(customer.id) ?? 0}
                  packages={packages}
                />
              ))}
            </ul>
          ) : (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              No customers yet. They&apos;ll appear here as soon as people sign
              up and start booking classes.
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
