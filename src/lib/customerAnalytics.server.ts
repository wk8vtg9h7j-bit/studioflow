import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import {
  buildCustomerAnalytics,
  type AnalyticsBookingRow,
  type AnalyticsCustomer,
  type AnalyticsLedgerRow,
  type AnalyticsSaleRow,
  type CustomerAnalytics,
} from "@/lib/customerAnalytics";

const PAGE_SIZE = 1000;

export async function loadCustomerAnalytics(): Promise<CustomerAnalytics[]> {
  const service = createServiceClient();

  // Supabase/PostgREST caps a single select at 1,000 rows. The credit ledger can
  // easily exceed that, and truncating it makes newer customers appear to have
  // zero credits even though their customer-scoped History view is correct.
  // Read the ledger in ordered pages so the CRM always sees the complete ledger.
  const loadAllLedgerRows = async (): Promise<AnalyticsLedgerRow[]> => {
    const rows: AnalyticsLedgerRow[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await service
        .from("credit_ledger")
        .select(
          "id,customer_id,delta,reason,pool,expires_at,created_at,sale_amount_cents,sale_currency,package_id",
        )
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;

      const page = (data ?? []) as unknown as AnalyticsLedgerRow[];
      rows.push(...page);

      if (page.length < PAGE_SIZE) break;
    }

    return rows;
  };

  const [customersRes, ledgerRows, bookingsRes, salesRes] = await Promise.all([
    service
      .from("customers")
      .select("*, profile:profiles(full_name,email,phone)")
      .order("created_at", { ascending: false }),
    loadAllLedgerRows(),
    service
      .from("bookings")
      .select(
        "id,customer_id,status,spots_count,booked_at,session:sessions(id,starts_at,ends_at,studio_id,status)",
      ),
    service
      .from("sales")
      .select("customer_id,total_cents,currency,created_at"),
  ]);

  if (customersRes.error) throw customersRes.error;
  if (bookingsRes.error) throw bookingsRes.error;
  if (salesRes.error) throw salesRes.error;

  return buildCustomerAnalytics(
    (customersRes.data ?? []) as unknown as AnalyticsCustomer[],
    ledgerRows,
    (bookingsRes.data ?? []) as unknown as AnalyticsBookingRow[],
    (salesRes.data ?? []) as unknown as AnalyticsSaleRow[],
  );
}
