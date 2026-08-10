// ============================================================================
// Admin overview — a quick pulse of the business: counts across the core
// entities, the next few sessions, and anything waiting on the admin.
// ============================================================================
import Link from "next/link";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import type { SessionWithRelations } from "@/lib/types";
import { formatSessionWhen, formatMoney } from "@/lib/format";

const STUDIO_TZ = "Asia/Ho_Chi_Minh";

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

export default async function AdminOverviewPage() {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  // Today's window, anchored to the studio's wall clock (Vietnam has no DST, so
  // the day is exactly 24h long and we can add a fixed offset for the end.)
  const todayKey = formatInTimeZone(new Date(), STUDIO_TZ, "yyyy-MM-dd");
  const dayStart = fromZonedTime(`${todayKey}T00:00:00`, STUDIO_TZ);
  const dayStartIso = dayStart.toISOString();
  const dayEndIso = new Date(dayStart.getTime() + 86_400_000).toISOString();

  const [
    classTypeCount,
    customerCount,
    upcomingCount,
    pendingPayrollCount,
    attendanceRes,
    revenueRes,
  ] = await Promise.all([
    countOf(supabase, "class_types", (q) => q.eq("active", true)),
    countOf(supabase, "customers"),
    countOf(supabase, "sessions", (q) =>
      q.gte("starts_at", nowIso).eq("status", "scheduled"),
    ),
    countOf(supabase, "session_payroll", (q) => q.eq("status", "pending")),
    // Bookings carry no session time of their own, so join through to sessions
    // and filter on the embedded alias. Cancelled seats don't count either way.
    supabase
      .from("bookings")
      .select("status, session:sessions!inner(starts_at)")
      .gte("session.starts_at", dayStartIso)
      .lt("session.starts_at", dayEndIso)
      .in("status", ["booked", "attended", "no_show"]),
    // Money lives on the package, not the ledger row. reason='purchase' keeps
    // signup starter credits (reason='adjustment') out of the takings.
    supabase
      .from("credit_ledger")
      .select("package:packages(price_cents,currency)")
      .eq("reason", "purchase")
      .gte("created_at", dayStartIso)
      .lt("created_at", dayEndIso),
  ]);

  const attendanceRows = (attendanceRes.data ?? []) as { status: string }[];
  const attendanceTotal = attendanceRows.length;
  const attendedCount = attendanceRows.filter(
    (b) => b.status === "attended",
  ).length;
  const attendancePct =
    attendanceTotal === 0
      ? null
      : Math.round((attendedCount / attendanceTotal) * 100);

  const revenueRows = (revenueRes.data ?? []) as {
    package: { price_cents: number; currency: string } | null;
  }[];
  const revenueTotal = revenueRows.reduce(
    (sum, r) => sum + (r.package?.price_cents ?? 0),
    0,
  );
  const revenueCurrency =
    revenueRows.find((r) => r.package?.currency)?.package?.currency ?? "VND";

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
    { label: "Class types", value: classTypeCount, href: "/admin/class-types" },
    { label: "Customers", value: customerCount, href: "/admin/customers" },
    { label: "Upcoming sessions", value: upcomingCount, href: "/admin/sessions" },
    { label: "Payroll pending", value: pendingPayrollCount, href: "/admin/payroll" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Overview
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            A snapshot of your studios, schedule, and what needs attention.
          </p>
        </div>
        <Link href="/admin/sessions/new" className="btn-primary">
          Schedule a class
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
                className="flex items-center gap-4 px-5 py-3 text-sm"
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
                <p className="shrink-0 text-right text-xs text-ink-muted">
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
