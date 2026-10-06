import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { Package } from "@/lib/types";
import { InstructorCustomerCard } from "./InstructorCustomerCard";

export const dynamic = "force-dynamic";

type CustomerRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  profile:
    | {
        full_name: string | null;
        email: string | null;
        phone: string | null;
      }
    | null;
};

export type InstructorCustomer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  regularBalance: number;
  privateBalance: number;
};

const MAX_RESULTS = 30;

export default async function InstructorCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireRole("instructor", "/instructor/customers");

  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const service = createServiceClient();

  const [{ data: rawCustomers, error: customersError }, { data: packageRows }] =
    await Promise.all([
      service
        .from("customers")
        .select(
          "id,name,email,phone,created_at,profile:profiles(full_name,email,phone)",
        )
        .order("created_at", { ascending: false })
        .limit(1000),
      service
        .from("packages")
        .select("*")
        .eq("active", true)
        .gt("price_cents", 0)
        .order("pool", { ascending: true })
        .order("price_cents", { ascending: true }),
    ]);

  if (customersError) throw customersError;

  const needle = q.toLocaleLowerCase();
  const filtered = ((rawCustomers ?? []) as unknown as CustomerRow[])
    .filter((customer) => {
      if (!needle) return true;
      const haystack = [
        customer.profile?.full_name,
        customer.name,
        customer.profile?.email,
        customer.email,
        customer.profile?.phone,
        customer.phone,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, MAX_RESULTS);

  const customers: InstructorCustomer[] = await Promise.all(
    filtered.map(async (customer) => {
      const [regularRes, privateRes] = await Promise.all([
        service.rpc("credit_balance", {
          p_customer: customer.id,
          p_pool: "regular",
        }),
        service.rpc("credit_balance", {
          p_customer: customer.id,
          p_pool: "private",
        }),
      ]);

      return {
        id: customer.id,
        name:
          customer.profile?.full_name?.trim() ||
          customer.name?.trim() ||
          customer.profile?.email ||
          customer.email ||
          "Customer",
        email: customer.profile?.email ?? customer.email ?? null,
        phone: customer.profile?.phone ?? customer.phone ?? null,
        regularBalance:
          typeof regularRes.data === "number" ? regularRes.data : 0,
        privateBalance:
          typeof privateRes.data === "number" ? privateRes.data : 0,
      };
    }),
  );

  const packages = (packageRows ?? []) as Package[];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Customers
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Check classes left and issue paid packages. Customer editing and
          manual credit adjustments remain admin-only.
        </p>
      </header>

      <form method="get" className="card flex flex-col gap-3 p-4 sm:flex-row">
        <div className="min-w-0 flex-1">
          <label className="label" htmlFor="instructor-customer-search">
            Search customer
          </label>
          <input
            id="instructor-customer-search"
            name="q"
            type="search"
            className="input"
            defaultValue={q}
            placeholder="Name, email or phone"
          />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn-primary">
            Search
          </button>
          {q ? (
            <a href="/instructor/customers" className="btn-secondary">
              Clear
            </a>
          ) : null}
        </div>
      </form>

      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {q
          ? `${customers.length} result${customers.length === 1 ? "" : "s"}`
          : `Latest ${customers.length} customers`}
      </p>

      {customers.length > 0 ? (
        <ul className="space-y-3">
          {customers.map((customer) => (
            <InstructorCustomerCard
              key={customer.id}
              customer={customer}
              packages={packages}
            />
          ))}
        </ul>
      ) : (
        <div className="card px-5 py-12 text-center text-sm text-ink-muted">
          No customers found.
        </div>
      )}
    </div>
  );
}
