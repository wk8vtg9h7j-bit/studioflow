/** Pure, read-only payment evidence replay. Never changes credit balances or receipts. */
export type BookingPaymentStatus = "package" | "payment_due";
export type BookingPaymentInput = {
  id: string;
  customerId: string;
  creditsSpent: number;
  pool: string;
  bookedAt?: string;
  startsAt?: string | null;
  status?: string;
  sessionStatus?: string | null;
};
export type PaymentDetail = { status: BookingPaymentStatus; renewalDue: boolean; paymentReview?: boolean };
export type PaymentLedgerRow = {
  id: string;
  customer_id: string;
  delta: number;
  reason: string;
  expires_at: string | null;
  created_at: string;
  booking_id: string | null;
  pool: string | null;
  package_id?: string | null;
};
type Bucket = { remaining: number; expiresAt: number | null; paid: boolean; packageId: string | null };
const keyFor = (customer: string, pool: string | null | undefined) => `${customer}:${pool ?? "regular"}`;
const isActive = (b: BookingPaymentInput) =>
  ["booked", "attended", "no_show"].includes(b.status ?? "booked") && b.sessionStatus !== "cancelled";

export function calculateBookingPaymentDetails(
  bookings: BookingPaymentInput[],
  ledger: PaymentLedgerRow[],
  checkoutIds: ReadonlySet<string> = new Set(),
  overrides: ReadonlyMap<string, BookingPaymentStatus> = new Map(),
  now = Date.now(),
): Map<string, PaymentDetail> {
  const buckets = new Map<string, Bucket[]>();
  const spent = new Map<string, { total: number; paid: number }>();
  // Track each source separately: mixed paid/manual bookings must refund the
  // paid portion too, without turning the manual portion into purchased credit.
  const refundSources = new Map<string, Bucket[]>();
  const ordered = [...ledger].sort((a, b) =>
    Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
  for (const row of ordered) {
    const key = keyFor(row.customer_id, row.pool);
    const available = buckets.get(key) ?? [];
    buckets.set(key, available);
    const expiresAt = row.expires_at ? Date.parse(row.expires_at) : null;
    const packageId = row.package_id ?? null;
    if (row.delta > 0) {
      if (row.reason === "refund" && row.booking_id) {
        let untraced = row.delta;
        let paidRefunded = 0;
        for (const source of refundSources.get(`${key}:${row.booking_id}`) ?? []) {
          if (untraced <= 0) break;
          if (source.expiresAt !== expiresAt || source.packageId !== packageId) continue;
          const take = Math.min(source.remaining, untraced);
          if (take <= 0) continue;
          available.push({ ...source, remaining: take });
          if (source.paid) paidRefunded += take;
          source.remaining -= take;
          untraced -= take;
        }
        const spendKey = `${key}:${row.booking_id}`;
        const previous = spent.get(spendKey);
        if (previous) spent.set(spendKey, {
          total: Math.max(0, previous.total - row.delta),
          paid: Math.max(0, previous.paid - paidRefunded),
        });
        if (untraced > 0) available.push({ remaining: untraced, expiresAt, packageId, paid: false });
      } else {
        available.push({ remaining: row.delta, expiresAt, packageId,
          paid: row.reason === "purchase" || row.reason === "single_class_credit" });
      }
      continue;
    }
    if (row.delta >= 0) continue;
    let owed = -row.delta;
    let paid = 0;
    const sources: Bucket[] = [];
    for (const bucket of available) {
      if (owed <= 0) break;
      if (bucket.remaining <= 0 || (bucket.expiresAt !== null && bucket.expiresAt <= Date.parse(row.created_at))) continue;
      const take = Math.min(owed, bucket.remaining);
      sources.push({ ...bucket, remaining: take });
      bucket.remaining -= take;
      owed -= take;
      if (bucket.paid) paid += take;
    }
    if (row.reason === "booking" && row.booking_id) {
      const id = `${key}:${row.booking_id}`;
      const previous = spent.get(id) ?? { total: 0, paid: 0 };
      spent.set(id, { total: previous.total - row.delta, paid: previous.paid + paid });
      refundSources.set(id, [...(refundSources.get(id) ?? []), ...sources]);
    }
  }
  const remainingPaid = new Map<string, number>();
  for (const [key, available] of buckets) remainingPaid.set(key, available.reduce((sum, b) =>
    sum + (b.paid && b.remaining > 0 && (b.expiresAt === null || b.expiresAt > now) ? b.remaining : 0), 0));
  const details = new Map<string, PaymentDetail>();
  for (const booking of bookings) {
    const evidence = spent.get(`${keyFor(booking.customerId, booking.pool)}:${booking.id}`);
    const needed = Math.max(booking.creditsSpent, 1);
    // A later unrelated purchase is not evidence that an old class was paid.
    const paid = checkoutIds.has(booking.id) ||
      Boolean(evidence && evidence.total >= needed && evidence.paid >= evidence.total);
    // Older records were labelled covered using today's unused credits. Keep
    // their existing billing treatment until staff review; explicitly flag the
    // uncertainty instead of silently creating historical customer debts.
    const legacyReview = !paid && !overrides.has(booking.id) &&
      (!booking.bookedAt || booking.bookedAt < "2026-10-11T17:00:00.000Z") &&
      (remainingPaid.get(keyFor(booking.customerId, booking.pool)) ?? 0) >= needed;
    details.set(booking.id, {
      status: overrides.get(booking.id) ?? (paid || legacyReview ? "package" : "payment_due"),
      renewalDue: false,
      ...(legacyReview ? { paymentReview: true } : {}),
    });
  }
  const finalByPool = new Map<string, BookingPaymentInput>();
  for (const booking of bookings) {
    if (!isActive(booking) || !["booked", "attended"].includes(booking.status ?? "booked")) continue;
    if (details.get(booking.id)?.status !== "package" || details.get(booking.id)?.paymentReview || !booking.startsAt) continue;
    const key = keyFor(booking.customerId, booking.pool);
    const previous = finalByPool.get(key);
    const order = (a: BookingPaymentInput, b: BookingPaymentInput) =>
      Date.parse(a.startsAt!) - Date.parse(b.startsAt!) ||
      (a.bookedAt ?? "").localeCompare(b.bookedAt ?? "") || a.id.localeCompare(b.id);
    if (!previous || order(booking, previous) > 0) finalByPool.set(key, booking);
  }
  for (const [key, booking] of finalByPool) {
    const paidRemaining = remainingPaid.get(key) ?? 0;
    if (paidRemaining === 0) details.get(booking.id)!.renewalDue = true;
  }
  return details;
}
