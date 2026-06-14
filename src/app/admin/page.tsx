// ============================================================================
// Admin overview — a quick pulse of the business: counts across the core
// entities, the next few sessions, and anything waiting on the admin.
// ============================================================================
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { SessionWithRelations } from "@/lib/types";
import { formatSessionWhen } from "@/lib/format";

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

  const [
    studioCount,
    classTypeCount,
    instructorCount,
    customerCount,
    upcomingCount,
    pendingPayrollCount,
  ] = await Promise.all([
    countOf(supabase, "studios", (q) => q.eq("active", true)),
    countOf(supabase, "class_types", (q) => q.eq("active", true)),
    countOf(supabase, "instructors", (q) => q.eq("active", true)),
    countOf(supabase, "customers"),
    countOf(supabase, "sessions", (q) =>
      q.gte("starts_at", nowIso).eq("status", "scheduled"),
    ),
    countOf(supabase, "session_payroll", (q) => q.eq("status", "pending")),
  ]);

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

  const stats = [
    { label: "Active studios", value: studioCount, href: "/admin/studios" },
    { label: "Class types", value: classTypeCount, href: "/admin/class-types" },
    { label: "Instructors", value: instructorCount, href: "/admin/instructors" },
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
