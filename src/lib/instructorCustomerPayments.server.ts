import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { getBookingPaymentStatuses } from "@/lib/bookingPaymentStatus.server";

export type PaymentDueBooking = {
  id: string;
  startsAt: string | null;
  title: string;
  status: string;
};

export type CustomerPurchase = {
  id: string;
  createdAt: string;
  packageName: string;
  credits: number;
  pool: string;
  amountCents: number;
  currency: string;
  paymentMethod: string | null;
  expiresAt: string | null;
};

type BookingRow = {
  id: string;
  customer_id: string;
  status: string;
  credits_spent: number | null;
  spots_count: number | null;
  session: {
    starts_at: string;
    title: string | null;
    class_type: { name: string | null; pool: string | null } | null;
  } | null;
};

type PurchaseRow = {
  id: string;
  customer_id: string;
  created_at: string;
  delta: number;
  pool: string | null;
  sale_amount_cents: number | null;
  sale_currency: string | null;
  payment_method: string | null;
  expires_at: string | null;
  package: {
    name: string | null;
    price_cents: number | null;
    currency: string | null;
  } | null;
};

const PAGE_SIZE = 1000;

// Uses exactly the same paid-package versus starter/manual-credit rules as
// the admin attendance register. Never equate "has credits" with "paid".
export async function getInstructorPaymentOverview(): Promise<{
  dueByCustomer: Map<string, PaymentDueBooking[]>;
  bookingCounts: Map<string, number>;
}> {
  const service = createServiceClient();
  const bookings: BookingRow[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await service
      .from("bookings")
      .select("id,customer_id,status,credits_spent,spots_count,session:sessions(starts_at,title,class_type:class_types(name,pool))")
      .in("status", ["booked", "attended", "no_show"])
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as BookingRow[];
    bookings.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const statuses = await getBookingPaymentStatuses(
    bookings.map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      creditsSpent: row.credits_spent ?? row.spots_count ?? 1,
      pool: row.session?.class_type?.pool ?? "regular",
    })),
  );

  const dueByCustomer = new Map<string, PaymentDueBooking[]>();
  const bookingCounts = new Map<string, number>();
  for (const booking of bookings) {
    bookingCounts.set(
      booking.customer_id,
      (bookingCounts.get(booking.customer_id) ?? 0) + 1,
    );
    if (statuses.get(booking.id) !== "payment_due") continue;
    const entries = dueByCustomer.get(booking.customer_id) ?? [];
    entries.push({
      id: booking.id,
      startsAt: booking.session?.starts_at ?? null,
      title: booking.session?.title || booking.session?.class_type?.name || "Class",
      status: booking.status,
    });
    dueByCustomer.set(booking.customer_id, entries);
  }

  for (const entries of dueByCustomer.values()) {
    entries.sort((a, b) => (b.startsAt ?? "").localeCompare(a.startsAt ?? ""));
  }

  return { dueByCustomer, bookingCounts };
}

// A purchase row is proof of a recorded package sale, not an unpaid invoice.
// Store the original sale amount when available; package list prices can change.
export async function getInstructorCustomerPurchases(
  customerIds: string[],
): Promise<Map<string, CustomerPurchase[]>> {
  const byCustomer = new Map<string, CustomerPurchase[]>();
  if (customerIds.length === 0) return byCustomer;

  const service = createServiceClient();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await service
      .from("credit_ledger")
      .select("id,customer_id,created_at,delta,pool,sale_amount_cents,sale_currency,payment_method,expires_at,package:packages(name,price_cents,currency)")
      .in("customer_id", customerIds)
      .eq("reason", "purchase")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;

    const rows = (data ?? []) as unknown as PurchaseRow[];
    for (const row of rows) {
      const entries = byCustomer.get(row.customer_id) ?? [];
      entries.push({
        id: row.id,
        createdAt: row.created_at,
        packageName: row.package?.name ?? "Package purchase",
        credits: row.delta,
        pool: row.pool ?? "regular",
        amountCents: row.sale_amount_cents ?? row.package?.price_cents ?? 0,
        currency: row.sale_currency ?? row.package?.currency ?? "VND",
        paymentMethod: row.payment_method,
        expiresAt: row.expires_at,
      });
      byCustomer.set(row.customer_id, entries);
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return byCustomer;
}
