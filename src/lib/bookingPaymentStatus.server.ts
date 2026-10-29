import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { calculateBookingPaymentDetails, type PaymentLedgerRow, type PaymentDetail } from "./bookingPaymentHistory";
import type { BookingPaymentInput, BookingPaymentStatus } from "./bookingPaymentHistory";
export type { BookingPaymentInput, BookingPaymentStatus } from "./bookingPaymentHistory";
const PAGE_SIZE = 1000;

/** Always evaluate the full history, independently of the day/class on screen. */
export async function getBookingPaymentDetails(bookings: BookingPaymentInput[]): Promise<Map<string, PaymentDetail>> {
  if (!bookings.length) return new Map();
  const service = createServiceClient();
  const customerIds = [...new Set(bookings.map(b => b.customerId).filter(Boolean))];
  const ledger: PaymentLedgerRow[] = [];
  const history = new Map<string, BookingPaymentInput>();
  for (let offset = 0; offset < customerIds.length; offset += 100) {
    const ids = customerIds.slice(offset, offset + 100);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await service.from("credit_ledger")
        .select("id,customer_id,delta,reason,expires_at,created_at,booking_id,pool,package_id")
        .in("customer_id", ids).order("created_at", { ascending: true })
        .order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      ledger.push(...(data ?? []) as PaymentLedgerRow[]);
      if ((data ?? []).length < PAGE_SIZE) break;
    }
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await service.from("bookings")
        .select("id,customer_id,credits_spent,spots_count,booked_at,status,session:sessions(starts_at,status,class_type:class_types(pool))")
        .in("customer_id", ids).in("status", ["booked", "attended", "no_show"])
        .order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      type Row = { id: string; customer_id: string; credits_spent: number | null; spots_count: number | null;
        booked_at: string; status: string; session: { starts_at: string; status: string; class_type: { pool: string | null } | null } | null };
      for (const row of (data ?? []) as unknown as Row[]) history.set(row.id, {
        id: row.id, customerId: row.customer_id, creditsSpent: row.credits_spent ?? row.spots_count ?? 1,
        bookedAt: row.booked_at, status: row.status, startsAt: row.session?.starts_at,
        sessionStatus: row.session?.status, pool: row.session?.class_type?.pool ?? "regular",
      });
      if ((data ?? []).length < PAGE_SIZE) break;
    }
  }
  // Keep authoritative history metadata even when callers only supply one class.
  for (const booking of bookings) if (!history.has(booking.id)) history.set(booking.id, booking);
  const checkoutIds = new Set<string>();
  const overrides = new Map<string, BookingPaymentStatus>();
  const allIds = [...history.keys()];
  let overridesAvailable = true;
  for (let offset = 0; offset < allIds.length; offset += 200) {
    const ids = allIds.slice(offset, offset + 200);
    const { data: receipts, error } = await service.from("class_checkouts").select("booking_id").in("booking_id", ids);
    if (error) throw error;
    for (const receipt of receipts ?? []) checkoutIds.add(receipt.booking_id);
    if (!overridesAvailable) continue;
    const { data, error: overrideError } = await service.from("booking_payment_overrides")
      .select("booking_id,status").in("booking_id", ids);
    if (overrideError) {
      if (overrideError.code === "42P01" || overrideError.code === "PGRST205") { overridesAvailable = false; continue; }
      throw overrideError;
    }
    for (const row of data ?? []) if (row.status === "package" || row.status === "payment_due") overrides.set(row.booking_id, row.status);
  }
  const allDetails = calculateBookingPaymentDetails([...history.values()], ledger, checkoutIds, overrides);
  return new Map(bookings.map(b => [b.id, allDetails.get(b.id)!]));
}

/** Financial status deliberately excludes renewal reminders. */
export async function getBookingPaymentStatuses(bookings: BookingPaymentInput[]): Promise<Map<string, BookingPaymentStatus>> {
  const details = await getBookingPaymentDetails(bookings);
  return new Map([...details].map(([id, detail]) => [id, detail.status]));
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

  const sessionIds: string[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await service.from("bookings").select("id,session_id")
      .eq("customer_id", customerId).in("status", ["booked", "attended", "no_show"])
      .order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of data ?? []) if (row.session_id) sessionIds.push(row.session_id);
    if ((data ?? []).length < PAGE_SIZE) break;
  }

  if (sessionIds.length === 0) return;

  const uniqueIds = [...new Set(sessionIds)];
  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    const { error } = await service.from("sessions")
      .update({ google_sync_pending_at: new Date().toISOString() })
      .in("id", uniqueIds.slice(offset, offset + 100))
      .gte("starts_at", new Date().toISOString());
    if (error) throw error;
  }
}

/** Booking is already committed: a queue failure must not suggest booking it again. */
export async function queueCustomerBookingCalendarSyncSafely(customerId: string): Promise<void> {
  try { await queueCustomerBookingCalendarSync(customerId); }
  catch (error) { console.warn("Booking saved; payment calendar queue failed", error); }
}
