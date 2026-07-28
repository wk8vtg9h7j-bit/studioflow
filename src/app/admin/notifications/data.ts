// ============================================================================
// Notifications data — recent booking + cancellation activity for the admin.
//
// "Unseen" is tracked with a cookie (the timestamp the admin last opened the
// notifications page), so no extra DB schema is needed. Events come straight off
// the bookings table: a row's booked_at is a "new booking" event and its
// cancelled_at is a "cancellation" event, both within a rolling window.
// ============================================================================
import { createServiceClient } from "@/lib/supabase/server";

export const NOTIF_SEEN_COOKIE = "admin_notif_seen";

// How far back the activity feed reaches.
const WINDOW_DAYS = 30;

export type NotifEvent = {
  id: string;
  type: "booked" | "cancelled";
  atISO: string;
  customer: string;
  klass: string;
  studio: string | null;
  whenISO: string | null;
  timezone: string;
};

export async function getNotificationEvents(): Promise<NotifEvent[]> {
  const svc = createServiceClient();
  const windowStart = new Date(
    Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data } = await svc
    .from("bookings")
    .select(
      `id, status, booked_at, cancelled_at,
       customer:customers(name, profile:profiles(full_name)),
       session:sessions(title, starts_at, studio:studios(name, timezone), class_type:class_types(name))`,
    )
    .or(`booked_at.gte.${windowStart},cancelled_at.gte.${windowStart}`)
    .order("booked_at", { ascending: false })
    .limit(300);

  type Row = {
    id: string;
    status: string;
    booked_at: string | null;
    cancelled_at: string | null;
    customer: {
      name: string | null;
      profile: { full_name: string | null } | null;
    } | null;
    session: {
      title: string | null;
      starts_at: string | null;
      studio: { name: string | null; timezone: string | null } | null;
      class_type: { name: string | null } | null;
    } | null;
  };

  const events: NotifEvent[] = [];
  for (const b of (data ?? []) as unknown as Row[]) {
    const customer =
      b.customer?.profile?.full_name ?? b.customer?.name ?? "Member";
    const klass = b.session?.title ?? b.session?.class_type?.name ?? "Class";
    const studio = b.session?.studio?.name ?? null;
    const timezone = b.session?.studio?.timezone ?? "Asia/Ho_Chi_Minh";
    const whenISO = b.session?.starts_at ?? null;

    if (b.cancelled_at && b.cancelled_at >= windowStart) {
      events.push({
        id: `${b.id}:c`,
        type: "cancelled",
        atISO: b.cancelled_at,
        customer,
        klass,
        studio,
        whenISO,
        timezone,
      });
    }
    if (b.booked_at && b.booked_at >= windowStart) {
      events.push({
        id: `${b.id}:b`,
        type: "booked",
        atISO: b.booked_at,
        customer,
        klass,
        studio,
        whenISO,
        timezone,
      });
    }
  }

  events.sort((a, b) => (a.atISO < b.atISO ? 1 : -1));
  return events;
}

// How many events are newer than the admin's last-seen timestamp.
export function countNewSince(
  events: NotifEvent[],
  seenISO: string | null,
): number {
  if (!seenISO) return events.length;
  return events.filter((e) => e.atISO > seenISO).length;
}

// Lightweight badge count — a single head-only count query (no rows, no joins),
// used by the admin header on every page instead of fetching the full feed.
export async function countNotificationsSince(
  seenISO: string | null,
): Promise<number> {
  const svc = createServiceClient();
  const windowStart = new Date(
    Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  // Never look further back than the feed window.
  const since = seenISO && seenISO > windowStart ? seenISO : windowStart;

  const { count } = await svc
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .or(`booked_at.gte.${since},cancelled_at.gte.${since}`);

  return count ?? 0;
}
