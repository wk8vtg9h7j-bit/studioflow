import "server-only";

import { createServiceClient } from "@/lib/supabase/server";

export type BookingPaymentStatus = "package" | "payment_due";

export type BookingPaymentInput = {
  id: string;
  customerId: string;
  creditsSpent: number;
  pool: string;
};

type LedgerRow = {
  id: string;
  customer_id: string;
  delta: number;
  reason: string;
  expires_at: string | null;
  created_at: string;
  booking_id: string | null;
  pool: string | null;
};

type Bucket = {
  remaining: number;
  expiresAt: number | null;
  paid: boolean;
};

const PAGE_SIZE = 1000;

/**
 * Returns whether each booking is covered by a genuinely paid package.
 *
 * Starter/manual credits are intentionally NOT treated as a package. We replay
 * the same FIFO ledger order as credit_balance(), while preserving the source
 * of each positive bucket. A refunded paid-package credit stays paid.
 */
export async function getBookingPaymentStatuses(
  bookings: BookingPaymentInput[],
): Promise<Map<string, BookingPaymentStatus>> {
  const result = new Map<string, BookingPaymentStatus>();
  if (bookings.length === 0) return result;

  const customerIds = Array.from(
    new Set(bookings.map((booking) => booking.customerId).filter(Boolean)),
  );
  if (customerIds.length === 0) {
    for (const booking of bookings) result.set(booking.id, "payment_due");
    return result;
  }

  const service = createServiceClient();
  const ledgerRows: LedgerRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await service
      .from("credit_ledger")
      .select(
        "id,customer_id,delta,reason,expires_at,created_at,booking_id,pool",
      )
      .in("customer_id", customerIds)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const page = (data ?? []) as unknown as LedgerRow[];
    ledgerRows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const bucketsByCustomerPool = new Map<string, Bucket[]>();
  const paidCoveredBookingIds = new Set<string>();

  const bucketKey = (customerId: string, pool: string | null | undefined) =>
    `${customerId}:${pool ?? "regular"}`;

  for (const row of ledgerRows) {
    const key = bucketKey(row.customer_id, row.pool);
    const buckets = bucketsByCustomerPool.get(key) ?? [];

    if (row.delta > 0) {
      const refundedPaidBooking =
        row.reason === "refund" &&
        row.booking_id !== null &&
        paidCoveredBookingIds.has(row.booking_id);

      buckets.push({
        remaining: row.delta,
        expiresAt: row.expires_at ? Date.parse(row.expires_at) : null,
        paid: row.reason === "purchase" || refundedPaidBooking,
      });
      bucketsByCustomerPool.set(key, buckets);
      continue;
    }

    if (row.delta >= 0) continue;

    let owed = -row.delta;
    let paidTaken = 0;
    const spentAt = Date.parse(row.created_at);

    for (const bucket of buckets) {
      if (owed <= 0) break;
      if (bucket.remaining <= 0) continue;
      if (bucket.expiresAt !== null && bucket.expiresAt <= spentAt) continue;

      const take = Math.min(owed, bucket.remaining);
      bucket.remaining -= take;
      owed -= take;
      if (bucket.paid) paidTaken += take;
    }

    if (
      row.reason === "booking" &&
      row.booking_id &&
      owed === 0 &&
      paidTaken >= -row.delta
    ) {
      paidCoveredBookingIds.add(row.booking_id);
    }
  }

  const nowMs = Date.now();
  const activePaidByCustomerPool = new Map<string, number>();
  for (const booking of bookings) {
    const key = bucketKey(booking.customerId, booking.pool);
    if (activePaidByCustomerPool.has(key)) continue;

    const paidRemaining = (bucketsByCustomerPool.get(key) ?? []).reduce(
      (sum, bucket) => {
        if (!bucket.paid || bucket.remaining <= 0) return sum;
        if (bucket.expiresAt !== null && bucket.expiresAt <= nowMs) return sum;
        return sum + bucket.remaining;
      },
      0,
    );
    activePaidByCustomerPool.set(key, paidRemaining);
  }

  for (const booking of bookings) {
    const bookingAlreadyPaid = paidCoveredBookingIds.has(booking.id);
    const creditsNeeded = Math.max(booking.creditsSpent, 1);
    const activePaidCredits =
      activePaidByCustomerPool.get(
        bucketKey(booking.customerId, booking.pool),
      ) ?? 0;

    result.set(
      booking.id,
      bookingAlreadyPaid || activePaidCredits >= creditsNeeded
        ? "package"
        : "payment_due",
    );
  }

  return result;
}

/**
 * Package grants/deletions can change a future booking from PAYMENT DUE to
 * PACKAGE (or vice versa) without changing the booking row itself. Mark those
 * future sessions dirty so the normal Google Calendar cron refreshes the label.
 */
export async function queueCustomerBookingCalendarSync(
  customerId: string,
): Promise<void> {
  const service = createServiceClient();

  const { data: bookings, error } = await service
    .from("bookings")
    .select("session_id")
    .eq("customer_id", customerId)
    .in("status", ["booked", "attended", "no_show"]);

  if (error) throw error;

  const sessionIds = Array.from(
    new Set(
      (bookings ?? [])
        .map((row) => (row as { session_id: string | null }).session_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  if (sessionIds.length === 0) return;

  const { error: updateError } = await service
    .from("sessions")
    .update({ google_sync_pending_at: new Date().toISOString() })
    .in("id", sessionIds)
    .gte("starts_at", new Date().toISOString());

  if (updateError) throw updateError;
}
