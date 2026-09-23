// ============================================================================
// Admin overview — a quick pulse of the business: counts across the core
// entities, the next few sessions, and anything waiting on the admin.
// ============================================================================
import Link from "next/link";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import type { SessionWithRelations } from "@/lib/types";
import { formatSessionWhen, formatMoney, FALLBACK_TZ } from "@/lib/format";

// Count helper — uses a head-only count query so we don't pull rows we discard.
async function countOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  filter?: (q: any) => any,
): Promise<number> {
  let query = supabase.from(table).select("*", { count: "exact", head: true });
  if (filter) query = filter(query);
  const { count } = await query;
  return count ?? 0;
}

// Today's numbers change through the day, so never serve this from cache.
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  // "Today" means the studio's wall-clock day, not the server's. Vietnam has no
  // DST, so the day is exactly 24h long and a fixed offset gives us the end.
  const todayKey = formatInTimeZone(new Date(), FALLBACK_TZ, "yyyy-MM-dd");
  const dayStart = fromZonedTime(`${todayKey}T00:00:00`, FALLBACK_TZ);
  const dayStartIso = dayStart.toISOString();
  const dayEndIso = new Date(dayStart.getTime() + 86_400_000).toISOString();

  const [
    studioCount,
    classTypeCount,
    instructorCount,
    customerCount,
    upcomingCount,
    pendingPayrollCount,
    attendanceRes,
    packageRes,
    retailRes,
  ] = await Promise.all([
    countOf(supabase, "studios", (q) => q.eq("active", true)),
    countOf(supabase, "class_types", (q) => q.eq("active", true)),
    countOf(supabase, "instructors", (q) => q.eq("active", true)),
    countOf(supabase, "customers"),
    countOf(supabase, "sessions", (q) =>
      q.gte("starts_at", nowIso).eq("status", "scheduled"),
    ),
    countOf(supabase, "session_payroll", (q) => q.eq("status", "pending")),
    // Bookings carry no time of their own, so join through to the session and
    // filter on the embedded alias. `!inner` drops the booking entirely when its
    // session falls outside today, rather than returning a null embed.
    supabase
      .from("bookings")
      .select("status, session:sessions!inner(starts_at)")
      .gte("session.starts_at", dayStartIso)
      .lt("session.starts_at", dayEndIso)
      .in("status", ["booked", "attended", "no_show"]),
    // Money lives on the package, not the ledger row. reason='purchase' keeps
    // signup starter credits and manual adjustments out of the takings.
    supabase
      .from("credit_ledger")
      .select("package:packages(price_cents,currency)")
      .eq("reason", "purchase")
      .gte("created_at", dayStartIso)
      .lt("created_at", dayEndIso),
    // Counter sales (socks, mats, drinks) — the total is snapshotted on the sale.
    supabase
      .from("sales")
      .select("total_cents,currency")
      .gte("created_at", dayStartIso)
      .lt("created_at", dayEndIso),
  ]);

  const attendanceRows = (attendanceRes.data ?? []) as { status: string }[];
  const attendanceTotal = attendanceRows.length;
  const attendedCount = attendanceRows.filter(
    (b) => b.status === "attended",
  ).length;
  // Null until someone is marked, so an unmarked day reads "—" rather than 0%.
  const attendancePct =
    attendanceTotal === 0
      ? null
      : Math.round((attendedCount / attendanceTotal) * 100);

  const packageRows = (packageRes.data ?? []) as unknown as {
    package: { price_cents: number; currency: string } | null;
  }[];
  const retailRows = (retailRes.data ?? []) as {
    total_cents: number;
    currency: string | null;
  }[];

  const revenueTotal =
    packageRows.reduce((sum, r) => sum + (r.package?.price_cents ?? 0), 0) +
    retailRows.reduce((sum, r) => sum + (r.total_cents ?? 0), 0);
  const revenueCurrency =
    packageRows.find((r) => r.package?.currency)?.package?.currency ??
    retailRows.find((r) => r.currency)?.currency ??
    "VND";

  const { data: nextSessions } = await supabase
    .from("sessions")
    .select(
      "*, studio:studios(id,name,slug,brand_color,timezone), class_type:class_types(id,name,color,credits_cost), instructor:instructors(id,display_name)",
    )
    .gte("starts_at", nowIso)
    .eq("status", "scheduled")
    .order("starts_at", { ascending: true })
    .limit(6);

  const sessions = (nextSessions ?? []) as SessionWithRelations[];

  const stats: { label: string; value: string | number; href: string }[] = [
    {
      label: `Attendance today (${attendedCount}/${attendanceTotal})`,
      value: attendancePct === null ? "—" : `${attendancePct}%`,
      href: "/admin/sessions",
    },
    {
      label: "Revenue today",
      value: formatMoney(revenueTotal, revenueCurrency),
      href: "/admin/payments",
    },
    { label: "Active studios", value: studioCount, href: "/admin/studios" },
    { label: "Class types", value: classTypeCount, href: "/admin/class-types" },
    { label: "Instructors", value: instructorCount, href: "/admin/instructors" },
    { label: "Customers", value: customerCount, href: "/admin/customers" },
    { label: "Upcoming sessions", value: upcomingCount, href: "/admin/sessions" },
    { label: "Payroll pending", value: pendingPayrollCount, href: "/admin/payroll" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Overview
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            A snapshot of your studios, schedule, and what needs attention.
          </p>
        </div>
        <Link href="/admin/sessions/new" className="btn-primary w-full sm:w-auto">
          Schedule a class
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="card p-4 transition hover:shadow-card"
          >
            <p className="text-2xl font-semibold tabular-nums text-ink">
              {s.value}
            </p>
            <p className="mt-1 text-xs text-ink-muted">{s.label}</p>
          </Link>
        ))}
      </div>

      <section className="card">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Next sessions</h2>
          <Link
            href="/admin/sessions"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            View all
          </Link>
        </div>

        {sessions.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">
            No upcoming sessions scheduled.{" "}
            <Link
              href="/admin/sessions/new"
              className="font-medium text-brand-600 hover:text-brand-700"
            >
              Add one
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:flex sm:gap-4 sm:px-5"
              >
                <span
                  className="h-8 w-1 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      s.class_type?.color ?? s.studio?.brand_color ?? "#a8a29e",
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">
                    {s.title ?? s.class_type?.name ?? "Class"}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {s.studio?.name ?? "—"} ·{" "}
                    {s.instructor?.display_name ?? "Unassigned"}
                  </p>
                </div>
                <p className="col-span-2 pl-4 text-left text-xs text-ink-muted sm:col-auto sm:shrink-0 sm:pl-0 sm:text-right">
                  {formatSessionWhen(s.starts_at, s.studio?.timezone)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
