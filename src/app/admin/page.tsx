// ============================================================================
// Admin overview — business dashboard.
//
// Revenue uses immutable sale snapshots, customer opportunity counts use the
// shared CRM analytics model, and studio comparisons stay operational because
// package purchases are not currently attributed to a studio in the schema.
// ============================================================================
import Link from "next/link";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { createServiceClient } from "@/lib/supabase/server";
import { formatSessionWhen, formatMoney, FALLBACK_TZ } from "@/lib/format";
import { loadCustomerAnalytics } from "@/lib/customerAnalytics.server";
import { segmentMeta, type CustomerSegmentKey } from "@/lib/customerAnalytics";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

type DashboardSession = {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  filler_seats: number;
  title: string | null;
  studio_id: string;
  studio: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    brand_color: string | null;
  } | null;
  class_type: {
    name: string;
    color: string | null;
  } | null;
};

type DashboardBooking = {
  id: string;
  session_id: string;
  customer_id: string;
  status: string;
  spots_count: number | null;
  booked_at: string;
};

type StudioRow = {
  id: string;
  name: string;
  slug: string;
};

function startOfVietnamDay(date: Date): Date {
  const key = formatInTimeZone(date, FALLBACK_TZ, "yyyy-MM-dd");
  return fromZonedTime(`${key}T00:00:00`, FALLBACK_TZ);
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function relativeChange(current: number, previous: number): string | null {
  if (previous <= 0) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  return `${change >= 0 ? "+" : ""}${change}% vs previous period`;
}

export default async function AdminOverviewPage() {
  const service = createServiceClient();
  const now = new Date();
  const nowIso = now.toISOString();

  const todayStart = startOfVietnamDay(now);
  const todayEnd = new Date(todayStart.getTime() + DAY_MS);
  const todayKey = formatInTimeZone(now, FALLBACK_TZ, "yyyy-MM-dd");

  const dowSun0 = new Date(`${todayKey}T00:00:00Z`).getUTCDay();
  const weekStart = new Date(
    todayStart.getTime() - ((dowSun0 + 6) % 7) * DAY_MS,
  );
  const nextWeekStart = new Date(weekStart.getTime() + 7 * DAY_MS);
  const previousWeekStart = new Date(weekStart.getTime() - 7 * DAY_MS);

  const monthKey = formatInTimeZone(now, FALLBACK_TZ, "yyyy-MM");
  const monthStart = fromZonedTime(`${monthKey}-01T00:00:00`, FALLBACK_TZ);
  const previousMonthDate = new Date(monthStart.getTime() - DAY_MS);
  const previousMonthKey = formatInTimeZone(
    previousMonthDate,
    FALLBACK_TZ,
    "yyyy-MM",
  );
  const previousMonthStart = fromZonedTime(
    `${previousMonthKey}-01T00:00:00`,
    FALLBACK_TZ,
  );

  const sevenDaysOut = new Date(now.getTime() + 7 * DAY_MS);

  const [
    analytics,
    studiosRes,
    monthPurchasesRes,
    monthSalesRes,
    previousMonthPurchasesRes,
    previousMonthSalesRes,
    weekPurchasesRes,
    weekSalesRes,
    previousWeekPurchasesRes,
    previousWeekSalesRes,
    todaySessionsRes,
    monthSessionsRes,
    upcomingSessionsRes,
    allAttendedRes,
    recentBookingsRes,
    recentPurchasesRes,
    recentSalesRes,
    payrollRes,
  ] = await Promise.all([
    loadCustomerAnalytics(),
    service
      .from("studios")
      .select("id,name,slug")
      .eq("active", true)
      .order("name", { ascending: true }),
    service
      .from("credit_ledger")
      .select("sale_amount_cents,sale_currency,created_at")
      .eq("reason", "purchase")
      .gte("created_at", monthStart.toISOString())
      .lt("created_at", todayEnd.toISOString()),
    service
      .from("sales")
      .select("total_cents,currency,created_at,studio_id")
      .gte("created_at", monthStart.toISOString())
      .lt("created_at", todayEnd.toISOString()),
    service
      .from("credit_ledger")
      .select("sale_amount_cents,sale_currency,created_at")
      .eq("reason", "purchase")
      .gte("created_at", previousMonthStart.toISOString())
      .lt("created_at", monthStart.toISOString()),
    service
      .from("sales")
      .select("total_cents,currency,created_at")
      .gte("created_at", previousMonthStart.toISOString())
      .lt("created_at", monthStart.toISOString()),
    service
      .from("credit_ledger")
      .select("sale_amount_cents,sale_currency,created_at")
      .eq("reason", "purchase")
      .gte("created_at", weekStart.toISOString())
      .lt("created_at", todayEnd.toISOString()),
    service
      .from("sales")
      .select("total_cents,currency,created_at")
      .gte("created_at", weekStart.toISOString())
      .lt("created_at", todayEnd.toISOString()),
    service
      .from("credit_ledger")
      .select("sale_amount_cents,sale_currency,created_at")
      .eq("reason", "purchase")
      .gte("created_at", previousWeekStart.toISOString())
      .lt("created_at", weekStart.toISOString()),
    service
      .from("sales")
      .select("total_cents,currency,created_at")
      .gte("created_at", previousWeekStart.toISOString())
      .lt("created_at", weekStart.toISOString()),
    service
      .from("sessions")
      .select(
        "id,starts_at,ends_at,capacity,filler_seats,title,studio_id,studio:studios(id,name,slug,timezone,brand_color),class_type:class_types(name,color)",
      )
      .gte("starts_at", todayStart.toISOString())
      .lt("starts_at", todayEnd.toISOString())
      .neq("status", "cancelled")
      .order("starts_at", { ascending: true }),
    service
      .from("sessions")
      .select("id,starts_at,capacity,filler_seats,studio_id,status")
      .gte("starts_at", monthStart.toISOString())
      .lt("starts_at", todayEnd.toISOString())
      .neq("status", "cancelled"),
    service
      .from("sessions")
      .select(
        "id,starts_at,ends_at,capacity,filler_seats,title,studio_id,studio:studios(id,name,slug,timezone,brand_color),class_type:class_types(name,color)",
      )
      .gte("starts_at", nowIso)
      .eq("status", "scheduled")
      .order("starts_at", { ascending: true })
      .limit(10),
    service
      .from("bookings")
      .select(
        "id,customer_id,status,spots_count,booked_at,session:sessions!inner(id,starts_at,studio_id,status)",
      )
      .eq("status", "attended")
      .order("booked_at", { ascending: true }),
    service
      .from("bookings")
      .select(
        "id,status,booked_at,cancelled_at,spots_count,customer:customers(name,email,profile:profiles(full_name,email)),session:sessions(title,starts_at,studio:studios(name,timezone),class_type:class_types(name))",
      )
      .order("updated_at", { ascending: false })
      .limit(12),
    service
      .from("credit_ledger")
      .select(
        "id,created_at,sale_amount_cents,sale_currency,customer:customers(name,email,profile:profiles(full_name,email)),package:packages(name)",
      )
      .eq("reason", "purchase")
      .order("created_at", { ascending: false })
      .limit(8),
    service
      .from("sales")
      .select(
        "id,created_at,total_cents,currency,customer:customers(name,email,profile:profiles(full_name,email))",
      )
      .order("created_at", { ascending: false })
      .limit(8),
    service
      .from("session_payroll")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  const studios = (studiosRes.data ?? []) as StudioRow[];
  const todaySessions =
    (todaySessionsRes.data ?? []) as unknown as DashboardSession[];
  const monthSessions = (monthSessionsRes.data ?? []) as unknown as Array<{
    id: string;
    starts_at: string;
    capacity: number;
    filler_seats: number;
    studio_id: string;
    status: string;
  }>;
  const upcomingSessions =
    (upcomingSessionsRes.data ?? []) as unknown as DashboardSession[];

  const sessionIds = Array.from(
    new Set([
      ...todaySessions.map((session) => session.id),
      ...monthSessions.map((session) => session.id),
      ...upcomingSessions.map((session) => session.id),
    ]),
  );

  const { data: seatData } =
    sessionIds.length > 0
      ? await service
          .from("bookings")
          .select("id,session_id,customer_id,status,spots_count,booked_at")
          .in("session_id", sessionIds)
          .in("status", ["booked", "attended"])
      : { data: [] };

  const seatRows = (seatData ?? []) as DashboardBooking[];
  const bookedBySession = new Map<string, number>();
  for (const row of seatRows) {
    bookedBySession.set(
      row.session_id,
      (bookedBySession.get(row.session_id) ?? 0) + (row.spots_count ?? 1),
    );
  }

  const amountOfPackages = (
    rows: Array<{ sale_amount_cents: number | null }>
  ) => rows.reduce((sum, row) => sum + (row.sale_amount_cents ?? 0), 0);
  const amountOfSales = (rows: Array<{ total_cents: number | null }>) =>
    rows.reduce((sum, row) => sum + (row.total_cents ?? 0), 0);

  const monthPurchases = (monthPurchasesRes.data ?? []) as Array<{
    sale_amount_cents: number | null;
    sale_currency: string | null;
    created_at: string;
  }>;
  const monthSales = (monthSalesRes.data ?? []) as Array<{
    total_cents: number;
    currency: string | null;
    created_at: string;
    studio_id: string | null;
  }>;
  const previousMonthPurchases = (previousMonthPurchasesRes.data ?? []) as Array<{
    sale_amount_cents: number | null;
  }>;
  const previousMonthSales = (previousMonthSalesRes.data ?? []) as Array<{
    total_cents: number;
  }>;
  const weekPurchases = (weekPurchasesRes.data ?? []) as Array<{
    sale_amount_cents: number | null;
    created_at: string;
  }>;
  const weekSales = (weekSalesRes.data ?? []) as Array<{
    total_cents: number;
    created_at: string;
  }>;
  const previousWeekPurchases = (previousWeekPurchasesRes.data ?? []) as Array<{
    sale_amount_cents: number | null;
  }>;
  const previousWeekSales = (previousWeekSalesRes.data ?? []) as Array<{
    total_cents: number;
  }>;

  const monthRevenue =
    amountOfPackages(monthPurchases) + amountOfSales(monthSales);
  const previousMonthRevenue =
    amountOfPackages(previousMonthPurchases) +
    amountOfSales(previousMonthSales);
  const weekRevenue = amountOfPackages(weekPurchases) + amountOfSales(weekSales);
  const previousWeekRevenue =
    amountOfPackages(previousWeekPurchases) + amountOfSales(previousWeekSales);

  const todayRevenue =
    amountOfPackages(
      monthPurchases.filter(
        (row) =>
          Date.parse(row.created_at) >= todayStart.getTime() &&
          Date.parse(row.created_at) < todayEnd.getTime(),
      ),
    ) +
    amountOfSales(
      monthSales.filter(
        (row) =>
          Date.parse(row.created_at) >= todayStart.getTime() &&
          Date.parse(row.created_at) < todayEnd.getTime(),
      ),
    );

  const revenueCurrency =
    monthPurchases.find((row) => row.sale_currency)?.sale_currency ??
    monthSales.find((row) => row.currency)?.currency ??
    "VND";

  const todaySessionIds = new Set(todaySessions.map((session) => session.id));
  const todayConfirmedSeats = seatRows
    .filter((row) => todaySessionIds.has(row.session_id))
    .reduce((sum, row) => sum + (row.spots_count ?? 1), 0);
  const todayCapacity = todaySessions.reduce(
    (sum, session) => sum + session.capacity,
    0,
  );
  const todayOccupancy = percent(todayConfirmedSeats, todayCapacity);

  const allAttended = (allAttendedRes.data ?? []) as unknown as Array<{
    id: string;
    customer_id: string;
    status: string;
    spots_count: number | null;
    booked_at: string;
    session: {
      id: string;
      starts_at: string;
      studio_id: string;
      status: string;
    } | null;
  }>;

  const todayVisits = allAttended
    .filter(
      (row) =>
        row.session &&
        Date.parse(row.session.starts_at) >= todayStart.getTime() &&
        Date.parse(row.session.starts_at) < todayEnd.getTime(),
    )
    .reduce((sum, row) => sum + (row.spots_count ?? 1), 0);

  const next7SessionIds = new Set(
    upcomingSessions
      .filter((session) => Date.parse(session.starts_at) < sevenDaysOut.getTime())
      .map((session) => session.id),
  );
  const next7Bookings = seatRows
    .filter((row) => next7SessionIds.has(row.session_id))
    .reduce((sum, row) => sum + (row.spots_count ?? 1), 0);

  const activeCustomers30 = analytics.filter(
    (row) =>
      row.lastVisitAt &&
      Date.parse(row.lastVisitAt) >= now.getTime() - 30 * DAY_MS,
  ).length;
  const newCustomersMonth = analytics.filter(
    (row) => Date.parse(row.customer.created_at) >= monthStart.getTime(),
  ).length;

  const segmentCount = (segment: CustomerSegmentKey) =>
    analytics.filter((row) => row.segments.includes(segment)).length;

  const attentionSegments: CustomerSegmentKey[] = [
    "registered_never_booked",
    "one_credit",
    "expiring_7d",
    "first_visit_no_package",
    "inactive_30",
    "zero_credits",
  ];

  const firstVisitByCustomerStudio = new Map<string, number>();
  for (const row of allAttended) {
    if (!row.session) continue;
    const key = `${row.customer_id}:${row.session.studio_id}`;
    const at = Date.parse(row.session.starts_at);
    const existing = firstVisitByCustomerStudio.get(key);
    if (existing === undefined || at < existing) {
      firstVisitByCustomerStudio.set(key, at);
    }
  }

  const studioMetrics = studios.map((studio) => {
    const sessions = monthSessions.filter(
      (session) => session.studio_id === studio.id,
    );
    const sessionIdSet = new Set(sessions.map((session) => session.id));
    const confirmedSeats = seatRows
      .filter((row) => sessionIdSet.has(row.session_id))
      .reduce((sum, row) => sum + (row.spots_count ?? 1), 0);
    const capacity = sessions.reduce((sum, session) => sum + session.capacity, 0);
    const visits = allAttended
      .filter(
        (row) =>
          row.session &&
          row.session.studio_id === studio.id &&
          Date.parse(row.session.starts_at) >= monthStart.getTime() &&
          Date.parse(row.session.starts_at) < todayEnd.getTime(),
      )
      .reduce((sum, row) => sum + (row.spots_count ?? 1), 0);

    const newToStudio = Array.from(firstVisitByCustomerStudio.entries()).filter(
      ([key, at]) =>
        key.endsWith(`:${studio.id}`) &&
        at >= monthStart.getTime() &&
        at < todayEnd.getTime(),
    ).length;

    return {
      ...studio,
      sessions: sessions.length,
      confirmedSeats,
      capacity,
      occupancy: percent(confirmedSeats, capacity),
      visits,
      newToStudio,
      retailRevenue: monthSales
        .filter((sale) => sale.studio_id === studio.id)
        .reduce((sum, sale) => sum + sale.total_cents, 0),
    };
  });

  const upcomingCards = upcomingSessions.map((session) => {
    const booked = bookedBySession.get(session.id) ?? 0;
    return {
      session,
      booked,
      occupancy: percent(booked, session.capacity),
    };
  });

  type Activity = {
    id: string;
    at: string;
    title: string;
    detail: string;
    kind: "booking" | "cancel" | "package" | "retail";
  };
  const activity: Activity[] = [];

  for (const raw of (recentBookingsRes.data ?? []) as unknown as Array<any>) {
    const customer =
      raw.customer?.profile?.full_name ??
      raw.customer?.name ??
      raw.customer?.profile?.email ??
      raw.customer?.email ??
      "Customer";
    const klass =
      raw.session?.title ?? raw.session?.class_type?.name ?? "Class";
    const studio = raw.session?.studio?.name ?? "Studio";
    const cancelled = raw.status === "cancelled";
    activity.push({
      id: `booking-${raw.id}`,
      at: cancelled ? raw.cancelled_at ?? raw.booked_at : raw.booked_at,
      title: cancelled
        ? `${customer} cancelled ${klass}`
        : `${customer} booked ${klass}`,
      detail: studio,
      kind: cancelled ? "cancel" : "booking",
    });
  }

  for (const raw of (recentPurchasesRes.data ?? []) as unknown as Array<any>) {
    const customer =
      raw.customer?.profile?.full_name ??
      raw.customer?.name ??
      raw.customer?.profile?.email ??
      raw.customer?.email ??
      "Customer";
    activity.push({
      id: `package-${raw.id}`,
      at: raw.created_at,
      title: `${customer} purchased ${raw.package?.name ?? "a package"}`,
      detail: formatMoney(
        raw.sale_amount_cents ?? 0,
        raw.sale_currency ?? "VND",
      ),
      kind: "package",
    });
  }

  for (const raw of (recentSalesRes.data ?? []) as unknown as Array<any>) {
    const customer =
      raw.customer?.profile?.full_name ??
      raw.customer?.name ??
      raw.customer?.profile?.email ??
      raw.customer?.email ??
      "Walk-in";
    activity.push({
      id: `sale-${raw.id}`,
      at: raw.created_at,
      title: `${customer} made a retail purchase`,
      detail: formatMoney(raw.total_cents ?? 0, raw.currency ?? "VND"),
      kind: "retail",
    });
  }

  activity.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const recentActivity = activity.slice(0, 10);

  const businessCards = [
    {
      label: "Revenue today",
      value: formatMoney(todayRevenue, revenueCurrency),
      detail: `${todayVisits} attended visit${todayVisits === 1 ? "" : "s"}`,
      href: "/admin/payments",
    },
    {
      label: "Revenue this week",
      value: formatMoney(weekRevenue, revenueCurrency),
      detail: relativeChange(weekRevenue, previousWeekRevenue) ?? "Current week",
      href: "/admin/payments",
    },
    {
      label: "Revenue this month",
      value: formatMoney(monthRevenue, revenueCurrency),
      detail:
        relativeChange(monthRevenue, previousMonthRevenue) ?? "Month to date",
      href: "/admin/payments",
    },
    {
      label: "Occupancy today",
      value: `${todayOccupancy}%`,
      detail: `${todayConfirmedSeats}/${todayCapacity} booked seats`,
      href: "/admin/sessions",
    },
    {
      label: "Active customers",
      value: activeCustomers30,
      detail: "Attended in the last 30 days",
      href: "/admin/customers",
    },
    {
      label: "Bookings next 7 days",
      value: next7Bookings,
      detail: "Confirmed booked seats",
      href: "/admin/sessions",
    },
    {
      label: "New customers MTD",
      value: newCustomersMonth,
      detail: "New CRM records this month",
      href: "/admin/customers",
    },
    {
      label: "Package sales MTD",
      value: monthPurchases.length,
      detail: "Recorded package purchases",
      href: "/admin/payments",
    },
  ];

  return (
    <div className="space-y-8">
      <header className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Business overview
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Revenue, customers, class demand and the opportunities that need attention.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href="/admin/marketing" className="btn-secondary">
            Marketing opportunities
          </Link>
          <Link href="/admin/sessions/new" className="btn-primary">
            Schedule a class
          </Link>
        </div>
      </header>

      <section>
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Business performance
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {businessCards.map((card) => (
            <Link
              key={card.label}
              href={card.href}
              className="card p-4 transition hover:shadow-card"
            >
              <p className="text-xl font-semibold tabular-nums text-ink sm:text-2xl">
                {card.value}
              </p>
              <p className="mt-1 text-xs font-medium text-ink-muted">
                {card.label}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                {card.detail}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Needs attention
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              CRM audiences that can turn into bookings or package sales.
            </p>
          </div>
          <Link
            href="/admin/marketing"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            View marketing
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {attentionSegments.map((key) => {
            const meta = segmentMeta(key)!;
            return (
              <Link
                key={key}
                href={`/admin/customers?segment=${key}`}
                className="card p-4 transition hover:shadow-card"
              >
                <p className="text-2xl font-semibold tabular-nums text-ink">
                  {segmentCount(key)}
                </p>
                <p className="mt-1 text-sm font-medium text-ink">
                  {meta.shortLabel}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                  {meta.campaign}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Next sessions</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              Live booked seats and occupancy.
            </p>
          </div>
          <Link
            href="/admin/sessions"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            View all
          </Link>
        </div>

        {upcomingCards.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">
            No upcoming sessions scheduled.
          </p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {upcomingCards.map(({ session, booked, occupancy }) => (
              <li
                key={session.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-5"
              >
                <span
                  className="h-full min-h-10 w-1 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      session.class_type?.color ??
                      session.studio?.brand_color ??
                      "#a8a29e",
                  }}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-ink">
                      {session.title ?? session.class_type?.name ?? "Class"}
                    </p>
                    <span
                      className={`badge ${
                        booked >= session.capacity
                          ? "bg-emerald-50 text-emerald-700"
                          : occupancy <= 25
                            ? "bg-amber-50 text-amber-700"
                            : "bg-stone-100 text-ink-muted"
                      }`}
                    >
                      {booked >= session.capacity
                        ? "Full"
                        : occupancy <= 25
                          ? "Low bookings"
                          : `${occupancy}% full`}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {session.studio?.name ?? "Studio"} ·{" "}
                    {formatSessionWhen(session.starts_at, session.studio?.timezone)}
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-stone-100 sm:max-w-52">
                      <div
                        className="h-full rounded-full bg-stone-700"
                        style={{ width: `${Math.min(100, occupancy)}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold tabular-nums text-ink-muted">
                      {booked}/{session.capacity}
                    </span>
                  </div>
                </div>
                <Link
                  href="/admin/sessions"
                  className="col-span-2 text-xs font-medium text-brand-600 sm:col-span-1"
                >
                  Manage
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-stone-200 px-4 py-4 sm:px-5">
          <h2 className="text-sm font-semibold text-ink">Studio comparison</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Month-to-date operating performance. Package revenue remains
            system-wide because package purchases are not attributed to a studio.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs text-ink-soft">
              <tr>
                <th className="px-4 py-3 font-medium sm:px-5">Studio</th>
                <th className="px-4 py-3 font-medium">Visits</th>
                <th className="px-4 py-3 font-medium">Occupancy</th>
                <th className="px-4 py-3 font-medium">Booked seats</th>
                <th className="px-4 py-3 font-medium">Classes</th>
                <th className="px-4 py-3 font-medium">New to studio</th>
                <th className="px-4 py-3 font-medium">Retail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {studioMetrics.map((studio) => (
                <tr key={studio.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-ink sm:px-5">
                    {studio.name}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-muted">
                    {studio.visits}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-muted">
                    {studio.occupancy}%
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-muted">
                    {studio.confirmedSeats}/{studio.capacity}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-muted">
                    {studio.sessions}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-muted">
                    {studio.newToStudio}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-ink-muted">
                    {formatMoney(studio.retailRevenue, revenueCurrency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Recent activity</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              Bookings, cancellations and recorded sales.
            </p>
          </div>
          <Link
            href="/admin/notifications"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Notifications
          </Link>
        </div>

        {recentActivity.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">
            No recent activity.
          </p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {recentActivity.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-4 px-4 py-3 sm:px-5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {item.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {item.detail}
                  </p>
                </div>
                <p className="shrink-0 text-xs text-ink-soft">
                  {formatInTimeZone(
                    new Date(item.at),
                    FALLBACK_TZ,
                    "d MMM, HH:mm",
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Link href="/admin/customers" className="card p-4">
          <p className="text-xl font-semibold text-ink">{analytics.length}</p>
          <p className="mt-1 text-xs text-ink-muted">Customers in CRM</p>
        </Link>
        <Link href="/admin/payroll" className="card p-4">
          <p className="text-xl font-semibold text-ink">
            {payrollRes.count ?? 0}
          </p>
          <p className="mt-1 text-xs text-ink-muted">Payroll items pending</p>
        </Link>
        <Link href="/admin/marketing" className="card p-4">
          <p className="text-xl font-semibold text-ink">
            {segmentCount("inactive_30")}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            30-day win-back opportunities
          </p>
        </Link>
      </section>
    </div>
  );
}
