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

export async function loadCustomerAnalytics(): Promise<CustomerAnalytics[]> {
  const service = createServiceClient();

  const [customersRes, ledgerRes, bookingsRes, salesRes] = await Promise.all([
    service
      .from("customers")
      .select("*, profile:profiles(full_name,email,phone)")
      .order("created_at", { ascending: false }),
    service
      .from("credit_ledger")
      .select(
        "id,customer_id,delta,reason,pool,expires_at,created_at,sale_amount_cents,sale_currency,package_id",
      )
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
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
  if (ledgerRes.error) throw ledgerRes.error;
  if (bookingsRes.error) throw bookingsRes.error;
  if (salesRes.error) throw salesRes.error;

  return buildCustomerAnalytics(
    (customersRes.data ?? []) as unknown as AnalyticsCustomer[],
    (ledgerRes.data ?? []) as unknown as AnalyticsLedgerRow[],
    (bookingsRes.data ?? []) as unknown as AnalyticsBookingRow[],
    (salesRes.data ?? []) as unknown as AnalyticsSaleRow[],
  );
}
