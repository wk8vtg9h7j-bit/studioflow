// ============================================================================
// Instructor · My classes
//
// The instructor's home surface: the sessions assigned to them, split into
// upcoming and past. This is a read view — the only write an instructor owns is
// confirming their own pay count, which lives on /instructor/salary. Here we
// just surface what they're teaching, the studio + class type, when it runs,
// and (for past sessions) the roster headcount so they can sanity-check before
// they go confirm pay.
//
// Sessions are RLS-scoped: the "instructors own sessions read" policy means this
// query only ever returns rows where instructor_id = my_instructor_id(). We
// still resolve the instructor id explicitly so an unlinked profile degrades to
// an empty list rather than leaking anything.
// ============================================================================
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatSessionWhen } from "@/lib/format";

export const dynamic = "force-dynamic";

type InstructorSessionRow = {
  id: string;
  title: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  studio?: { name: string | null; timezone: string | null } | null;
  class_type?: { name: string | null; color: string | null } | null;
  bookings?: { count: number }[] | null;
};

export default async function InstructorHomePage() {
  const profile = await requireRole("instructor", "/instructor");
  const supabase = await createClient();

  // Resolve the signed-in instructor. An admin viewing the portal, or a profile
  // not yet linked to an instructor row, simply has no classes here.
  const { data: instructor } = await supabase
    .from("instructors")
    .select("id, display_name")
    .eq("profile_id", profile.id)
    .single();

  const { data } = instructor
    ? await supabase
        .from("sessions")
        .select(
          `id, title, starts_at, ends_at, status,
           studio:studios(name, timezone),
           class_type:class_types(name, color),
           bookings(count)`,
        )
        .eq("instructor_id", instructor.id)
        .order("starts_at", { ascending: true })
    : { data: [] };

  const rows = (data ?? []) as unknown as InstructorSessionRow[];

  // Split on now. Booked sessions in the future are "upcoming"; everything else
  // (already started/finished, or cancelled) drops into the history list.
  const now = Date.now();
  const upcoming: InstructorSessionRow[] = [];
  const past: InstructorSessionRow[] = [];
  for (const row of rows) {
    const started = new Date(row.starts_at).getTime();
    if (Number.isFinite(started) && started >= now && row.status !== "cancelled") {
      upcoming.push(row);
    } else {
      past.push(row);
    }
  }
  // Past reads most-recent-first; upcoming stays soonest-first.
  past.reverse();

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            My classes
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            The sessions you&rsquo;re teaching. Once a class has run, head to{" "}
            <Link href="/instructor/salary" className="text-brand-700 underline">
              Salary
            </Link>{" "}
            to confirm the headcount you taught.
          </p>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Upcoming</h2>
        {upcoming.length > 0 ? (
          <ul className="space-y-3">
            {upcoming.map((row) => (
              <SessionCard key={row.id} row={row} />
            ))}
          </ul>
        ) : (
          <div className="card px-5 py-10 text-center text-sm text-ink-muted">
            No upcoming classes on your schedule.
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-ink">Earlier</h2>
          <ul className="space-y-3">
            {past.map((row) => (
              <SessionCard key={row.id} row={row} past />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SessionCard({
  row,
  past = false,
}: {
  row: InstructorSessionRow;
  past?: boolean;
}) {
  const heading = row.title ?? row.class_type?.name ?? "Class";
  const studioName = row.studio?.name ?? null;
  const when = formatSessionWhen(row.starts_at, row.studio?.timezone ?? undefined);
  const color = row.class_type?.color ?? "#d6d3d1";
  const headcount = row.bookings?.[0]?.count ?? 0;
  const cancelled = row.status === "cancelled";

  return (
    <li className="card flex items-stretch overflow-hidden">
      <span
        className="w-1.5 shrink-0"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 items-center gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-ink">{heading}</p>
            {cancelled && (
              <span className="badge bg-rose-50 text-rose-700">Cancelled</span>
            )}
          </div>
          <p className="truncate text-xs text-ink-muted">
            {studioName ? `${studioName} · ` : ""}
            {when}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-ink">{headcount}</p>
          <p className="text-[11px] uppercase tracking-wide text-ink-soft">
            {headcount === 1 ? "head" : "heads"}
            {past ? " booked" : ""}
          </p>
        </div>
      </div>
    </li>
  );
}
