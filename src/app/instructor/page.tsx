import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatSessionTimeRange } from "@/lib/format";
import {
  INSTRUCTOR_TIME_ZONE,
  instructorWeek,
  instructorStudioKey,
  instructorStudioName,
  instructorStudioOrder,
  instructorPortalHref,
  studioParam,
} from "@/lib/instructorWeek";
import { PushNotificationsCard } from "./PushNotificationsCard";

export const dynamic = "force-dynamic";

type InstructorSessionRow = {
  id: string;
  title: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  studio?: { name: string | null; timezone: string | null } | null;
  class_type?: { name: string | null; color: string | null } | null;
  bookings?: { status: string; spots_count: number | null }[] | null;
};

type PageParams = {
  week?: string | string[];
  studio?: string | string[];
};

function bookedHeads(row: InstructorSessionRow): number {
  return (row.bookings ?? []).reduce(
    (count, booking) =>
      booking.status === "booked" || booking.status === "attended"
        ? count + (booking.spots_count ?? 1)
        : count,
    0,
  );
}

function weekdayLabel(startsAt: string, zone?: string | null): string {
  return formatInTimeZone(new Date(startsAt), zone || INSTRUCTOR_TIME_ZONE, "EEEE, d MMMM");
}

function dayKey(startsAt: string, zone?: string | null): string {
  return formatInTimeZone(new Date(startsAt), zone || INSTRUCTOR_TIME_ZONE, "yyyy-MM-dd");
}

export default async function InstructorHomePage({
  searchParams,
}: {
  searchParams?: PageParams | Promise<PageParams>;
}) {
  const params = (await searchParams) ?? {};
  const week = instructorWeek(params.week);
  const selectedStudio = studioParam(params.studio);
  const profile = await requireRole("instructor", "/instructor");
  const supabase = await createClient();

  const { data: instructor } = await supabase
    .from("instructors")
    .select("id, display_name")
    .eq("profile_id", profile.id)
    .single();

  // RLS still scopes these results to the signed-in instructor. Querying one
  // week avoids the massive generated multi-year schedule and the 1,000-row cap.
  const { data, error } = instructor
    ? await supabase
        .from("sessions")
        .select(
          "id, title, starts_at, ends_at, status, studio:studios(name, timezone), class_type:class_types(name, color), bookings(status, spots_count)",
        )
        .eq("instructor_id", instructor.id)
        .gte("starts_at", week.from)
        .lt("starts_at", week.until)
        .order("starts_at", { ascending: true })
    : { data: [], error: null };

  const now = Date.now();
  const all = ((data ?? []) as unknown as InstructorSessionRow[]).filter((row) => {
    const timestamp = Date.parse(row.starts_at);
    // Preserve past cancellations as history, but don't show cancelled future
    // slots as classes the instructor is expected to teach.
    return Number.isFinite(timestamp) && (timestamp < now || row.status !== "cancelled");
  });
  const rows = all.filter(
    (row) => selectedStudio === "all" || instructorStudioKey(row.studio?.name) === selectedStudio,
  );
  const active = rows.filter((row) => row.status !== "cancelled");
  const upcomingCount = active.filter((row) => Date.parse(row.starts_at) >= now).length;
  const totalHeads = active.reduce((sum, row) => sum + bookedHeads(row), 0);
  const cancelledCount = rows.length - active.length;

  const groups = new Map<string, InstructorSessionRow[]>();
  for (const row of rows) {
    const key = instructorStudioKey(row.studio?.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  const studioKeys = Array.from(
    new Set([
      ...(selectedStudio === "all" ? ["downtown", "hideaway"] : [selectedStudio]),
      ...groups.keys(),
    ]),
  ).sort(instructorStudioOrder);

  const classesUrl = (weekStart: string, studio = selectedStudio) =>
    instructorPortalHref("/instructor", weekStart, studio);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2"><Link href="/instructor/today" className="btn-primary">Today · Check-ins & payments →</Link><Link href="/instructor/customers" className="btn-secondary">Customer packages →</Link></div>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">My classes</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Your weekly teaching schedule, organised by studio and day.
          </p>
        </div>
        <Link
          href={instructorPortalHref("/instructor/salary", week.start, selectedStudio)}
          className="btn-secondary"
        >
          View this week&apos;s salary →
        </Link>
      </header>

      <div className="card space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={classesUrl(week.previous)} className="btn-secondary" aria-label="Previous week">
            ← Previous
          </Link>
          <div className="text-center">
            <p className="text-base font-semibold text-ink">{week.label}</p>
            <p className="text-xs text-ink-soft">{week.isCurrent ? "This week" : "Monday – Sunday"}</p>
          </div>
          <Link href={classesUrl(week.next)} className="btn-secondary" aria-label="Next week">
            Next →
          </Link>
        </div>
        {!week.isCurrent && (
          <div className="text-center">
            <Link href={classesUrl(instructorWeek().start)} className="text-sm font-medium text-brand-700 underline">
              Jump to this week
            </Link>
          </div>
        )}
        <nav className="flex flex-wrap gap-2 border-t border-stone-100 pt-4" aria-label="Studio filter">
          {[
            { value: "all", label: "All studios" },
            { value: "downtown", label: "Downtown" },
            { value: "hideaway", label: "Hideaway" },
          ].map((option) => (
            <Link
              key={option.value}
              href={classesUrl(week.start, option.value)}
              aria-current={selectedStudio === option.value ? "page" : undefined}
              className={
                "rounded-full px-4 py-2 text-sm font-medium transition-colors " +
                (selectedStudio === option.value
                  ? "bg-ink text-white"
                  : "border border-stone-200 bg-white text-ink-muted hover:border-stone-400")
              }
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryCard label="Classes this week" value={active.length} />
        <SummaryCard label="Still to teach" value={upcomingCount} />
        <SummaryCard label="Booked spots" value={totalHeads} />
      </section>

      {error && (
        <div className="card border-rose-200 p-4 text-sm text-rose-700">
          The schedule could not be loaded. Please refresh the page.
        </div>
      )}

      {!error && studioKeys.map((key) => {
        const studioRows = groups.get(key) ?? [];
        const days = new Map<string, InstructorSessionRow[]>();
        for (const row of studioRows) {
          const date = dayKey(row.starts_at, row.studio?.timezone);
          if (!days.has(date)) days.set(date, []);
          days.get(date)!.push(row);
        }
        return (
          <section key={key} className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-4 py-4 sm:px-5">
              <div>
                <h2 className="text-lg font-semibold text-ink">
                  {instructorStudioName(key, studioRows[0]?.studio?.name)}
                </h2>
                <p className="text-xs text-ink-muted">
                  {studioRows.filter((row) => row.status !== "cancelled").length} scheduled classes
                </p>
              </div>
              <Link href={classesUrl(week.start, key)} className="text-xs font-medium text-brand-700 underline">
                Show only this studio
              </Link>
            </div>
            {studioRows.length === 0 ? (
              <p className="px-5 py-7 text-sm text-ink-muted">No classes assigned at this studio this week.</p>
            ) : (
              <div className="divide-y divide-stone-100">
                {Array.from(days.entries()).map(([date, dailyRows]) => (
                  <div key={date} className="px-4 py-4 sm:px-5">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      {weekdayLabel(dailyRows[0].starts_at, dailyRows[0].studio?.timezone)}
                    </h3>
                    <ul className="space-y-2">
                      {dailyRows.map((row) => <SessionCard key={row.id} row={row} now={now} />)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {cancelledCount > 0 && (
        <p className="text-xs text-ink-soft">
          {cancelledCount} past cancelled class{cancelledCount === 1 ? "" : "es"} shown for reference; excluded from the weekly class total.
        </p>
      )}

      <PushNotificationsCard vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null} />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function SessionCard({ row, now }: { row: InstructorSessionRow; now: number }) {
  const heading = row.title ?? row.class_type?.name ?? "Class";
  const zone = row.studio?.timezone ?? INSTRUCTOR_TIME_ZONE;
  const when = formatSessionTimeRange(row.starts_at, row.ends_at, zone);
  const count = bookedHeads(row);
  const cancelled = row.status === "cancelled";
  const past = Date.parse(row.starts_at) < now;
  return (
    <li className="flex overflow-hidden rounded-lg border border-stone-200 bg-white">
      <span className="w-1.5 shrink-0" style={{ backgroundColor: row.class_type?.color ?? "#d6d3d1" }} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-3 sm:px-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold tabular-nums text-ink-muted">{when}</p>
          <p className="mt-1 break-words text-sm font-semibold text-ink">{heading}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {cancelled && <span className="badge bg-rose-50 text-rose-700">Cancelled</span>}
            {!cancelled && past && <span className="text-xs text-ink-soft">Completed time</span>}
            {!cancelled && !past && count === 0 && <span className="text-xs text-ink-soft">No bookings yet</span>}
          </div>
        </div>
        <div className="shrink-0 rounded-lg bg-stone-50 px-3 py-2 text-center">
          <p className="text-lg font-semibold tabular-nums text-ink">{count}</p>
          <p className="text-[11px] text-ink-soft">{count === 1 ? "spot" : "spots"}</p>
        </div>
      </div>
    </li>
  );
}
