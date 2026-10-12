import { requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { Package } from "@/lib/types";
import { InstructorCustomerCard } from "./InstructorCustomerCard";
import {
  getInstructorPaymentOverview,
  getInstructorCustomerPurchases,
  type PaymentDueBooking,
  type CustomerPurchase,
} from "@/lib/instructorCustomerPayments.server";

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
  bookingCount: number;
  paymentDueBookings: PaymentDueBooking[];
  purchaseHistory: CustomerPurchase[];
  checkoutHistory: Array<{id:string;kind:string;createdAt:string;amount:number;currency:string;method:string}>;
};

const MAX_RESULTS = 30;

export default async function InstructorCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; due?: string }>;
}) {
  await requireRole("instructor", "/instructor/customers");

  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const onlyDue = params.due === "1";
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

  // The admin attendance register and instructor view share the same
  // paid-package coverage calculation, including starter/manual credits.
  const { dueByCustomer, bookingCounts } = await getInstructorPaymentOverview();

  const needle = q.toLocaleLowerCase();
  const matching = ((rawCustomers ?? []) as unknown as CustomerRow[])
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
    .filter((customer) => !onlyDue || (dueByCustomer.get(customer.id)?.length ?? 0) > 0);
  const filtered = matching.slice(0, MAX_RESULTS);
  // One batched RPC uses the exact existing credit_balance() logic for both
  // pools, instead of up to 60 individual network round trips per page.
  const selectedIds = filtered.map((customer) => customer.id);
  const [purchasesByCustomer, balanceResult, checkoutResult] = await Promise.all([
    getInstructorCustomerPurchases(selectedIds),
    selectedIds.length > 0
      ? service.rpc("instructor_customer_balances", { p_customer_ids: selectedIds })
      : Promise.resolve({ data: [], error: null }),
    selectedIds.length > 0 ? service.from("class_checkouts")
      .select("id,customer_id,kind,created_at,amount_cents,currency,payment_method")
      .in("customer_id",selectedIds).order("created_at",{ascending:false}).limit(500)
      : Promise.resolve({data:[],error:null}),
  ]);
  if (balanceResult.error) throw balanceResult.error;
  if(checkoutResult.error)throw checkoutResult.error;
  type Receipt={id:string;customer_id:string;kind:string;created_at:string;amount_cents:number;currency:string;payment_method:string};
  const checkoutByCustomer=new Map<string,InstructorCustomer["checkoutHistory"]>();
  for(const receipt of (checkoutResult.data||[]) as Receipt[]){
    const list=checkoutByCustomer.get(receipt.customer_id)||[];
    list.push({id:receipt.id,kind:receipt.kind,createdAt:receipt.created_at,amount:receipt.amount_cents,currency:receipt.currency,method:receipt.payment_method});
    checkoutByCustomer.set(receipt.customer_id,list);
  }
  type BalanceRow = { customer_id: string; regular_balance: number; private_balance: number };
  const balanceById = new Map(
    ((balanceResult.data ?? []) as BalanceRow[]).map((balance) => [balance.customer_id, balance]),
  );

  const customers: InstructorCustomer[] = filtered.map((customer) => {
    const balance = balanceById.get(customer.id);
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
      regularBalance: balance?.regular_balance ?? 0,
      privateBalance: balance?.private_balance ?? 0,
      bookingCount: bookingCounts.get(customer.id) ?? 0,
      paymentDueBookings: dueByCustomer.get(customer.id) ?? [],
      purchaseHistory: purchasesByCustomer.get(customer.id) ?? [],
      checkoutHistory: checkoutByCustomer.get(customer.id) ?? [],
    };
  });

  const packages = (packageRows ?? []) as Package[];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Customers
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Check classes left, package purchases, recorded payments and who still
          needs to pay. Customer editing and manual credit adjustments remain admin-only.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={onlyDue
            ? (q ? "/instructor/customers?q=" + encodeURIComponent(q) : "/instructor/customers")
            : "/instructor/customers?due=1" + (q ? "&q=" + encodeURIComponent(q) : "")}
          className={onlyDue ? "btn-primary" : "btn-secondary"}
        >
          {onlyDue ? "Show all customers" : "Show payment due only"}
        </a>
      </div>

      <form method="get" className="card flex flex-col gap-3 p-4 sm:flex-row">
        {onlyDue ? <input type="hidden" name="due" value="1" /> : null}
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
            <a href={onlyDue ? "/instructor/customers?due=1" : "/instructor/customers"} className="btn-secondary">
              Clear
            </a>
          ) : null}
        </div>
      </form>

      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {matching.length === 0
          ? "No matching customers"
          : `Showing ${customers.length} of ${matching.length} customer${matching.length === 1 ? "" : "s"}${onlyDue ? " needing payment" : ""}`}
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
