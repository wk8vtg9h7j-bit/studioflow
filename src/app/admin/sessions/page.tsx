// ============================================================================
// Sessions admin — the scheduled-class calendar list plus an inline "schedule a
// class" form. A session pins a class type to a studio at a wall-clock time,
// with an optional instructor, room and capacity. The list and the form both
// need the same option arrays (studios, class types, instructors), so we fetch
// them once here and hand them to every row as well as the sidebar form.
//
// Only active studios/class types/instructors are offered for new sessions, but
// existing sessions still render their relations even if those have since been
// deactivated (the joins below are independent of the active filters).
//
// The list defaults to the CURRENT WEEK only (Mon-Sun in studio time). Anything
// outside that window is reachable through the search box, which drops the week
// bound and looks across the whole schedule instead.
// ============================================================================
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import type { SessionWithRelations } from "@/lib/types";
import { SessionForm } from "./SessionForm";
import type {
  StudioOption,
  ClassTypeOption,
  InstructorOption,
} from "./SessionForm";
import { SessionRow } from "./SessionRow";
import { SessionFilters } from "./SessionFilters";

const STUDIO_TZ = "Asia/Ho_Chi_Minh";
const DAY_MS = 86_400_000;

export default async function SessionsPage({
  searchParams,
}: {
  searchParams?: {
    studio?: string;
    type?: string;
    date?: string;
    q?: string;
  };
}) {
  const supabase = await createClient();

  const studio = searchParams?.studio?.trim() || undefined;
  const type = searchParams?.type?.trim() || undefined;
  const date = searchParams?.date?.trim() || undefined;
  const q = searchParams?.q?.trim() || undefined;

  // The option lists come first: resolving a text search against class-type
  // names needs their ids before the sessions query can be built.
  const [studiosRes, classTypesRes, instructorsRes] = await Promise.all([
    supabase
      .from("studios")
      .select("id,name,timezone")
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("class_types")
      .select("id,name,default_duration_min,default_capacity,credits_cost")
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("instructors")
      .select("id,display_name")
      .eq("active", true)
      .order("display_name", { ascending: true }),
  ]);

  const studios = (studiosRes.data ?? []) as StudioOption[];
  const classTypes = (classTypesRes.data ?? []) as ClassTypeOption[];
  const instructors = (instructorsRes.data ?? []) as InstructorOption[];

  // Current week, Monday-anchored, in the studio's wall clock. Vietnam has no
  // DST so every day is exactly 24h and fixed offsets are safe.
  const todayKey = formatInTimeZone(new Date(), STUDIO_TZ, "yyyy-MM-dd");
  const todayStart = fromZonedTime(`${todayKey}T00:00:00`, STUDIO_TZ);
  const dowSun0 = new Date(`${todayKey}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const weekStart = new Date(
    todayStart.getTime() - ((dowSun0 + 6) % 7) * DAY_MS,
  );
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);

  let query = supabase
    .from("sessions")
    .select(
      "*, studio:studios(id,name,slug,brand_color,timezone), class_type:class_types(id,name,color,credits_cost), instructor:instructors(id,display_name)",
    );

  if (studio) query = query.eq("studio_id", studio);
  if (type) query = query.eq("class_type_id", type);

  let rangeLabel: string;

  if (date) {
    // A picked day always wins, even outside this week.
    const dayStart = fromZonedTime(`${date}T00:00:00`, STUDIO_TZ);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    query = query
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString());
    rangeLabel = formatInTimeZone(dayStart, STUDIO_TZ, "EEE, d MMM yyyy");
  } else if (q) {
    // Search escapes the week window so older/newer classes can be found.
    // Inside an .or() filter string the ilike wildcard is *, not %, and
    // commas/parens would break the grammar — strip them from user input.
    const safe = q.replace(/[,()%*]/g, " ").trim();
    const needle = safe.toLowerCase();
    const matchedTypeIds = classTypes
      .filter((t) => t.name.toLowerCase().includes(needle))
      .map((t) => t.id);
    const orFilter = matchedTypeIds.length
      ? `title.ilike.*${safe}*,class_type_id.in.(${matchedTypeIds.join(",")})`
      : `title.ilike.*${safe}*`;
    query = query.or(orFilter).limit(200);
    rangeLabel = `All dates matching “${q}”`;
  } else {
    query = query
      .gte("starts_at", weekStart.toISOString())
      .lt("starts_at", weekEnd.toISOString());
    rangeLabel = `${formatInTimeZone(weekStart, STUDIO_TZ, "d MMM")} – ${formatInTimeZone(
      new Date(weekEnd.getTime() - DAY_MS),
      STUDIO_TZ,
      "d MMM yyyy",
    )}`;
  }

  const sessionsRes = await query.order("starts_at", { ascending: true });
  const sessions = (sessionsRes.data ?? []) as SessionWithRelations[];

  // Live seat counts for the rows we are about to render. This is a companion
  // query rather than an embedded `bookings(count)` because an embedded count
  // needs an inner join, which would silently drop every session that has no
  // bookings yet — exactly the rows an admin most needs to see.
  //
  // A seat counts as taken when a booking is 'booked' OR 'attended', matching
  // book_session and the register's check-in (see 0010_capacity_count_fix.sql),
  // so the number here agrees with the capacity the database itself enforces.
  const sessionIds = sessions.map((s) => s.id);
  const bookedRes = sessionIds.length
    ? await supabase
        .from("bookings")
        .select("session_id")
        .in("session_id", sessionIds)
        .in("status", ["booked", "attended"])
    : { data: [] };

  const bookedBySession = new Map<string, number>();
  for (const row of (bookedRes.data ?? []) as { session_id: string }[]) {
    bookedBySession.set(
      row.session_id,
      (bookedBySession.get(row.session_id) ?? 0) + 1,
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Sessions
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Scheduled classes customers can book. Times are shown in each
          studio&apos;s own timezone. Cancelling keeps a session for history but
          hides it from booking. Only this week is listed — use search to reach
          any other date.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          <SessionFilters
            studios={studios}
            classTypes={classTypes}
            studio={studio}
            type={type}
            date={date}
            q={q}
          />

          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            {rangeLabel} · {sessions.length}{" "}
            {sessions.length === 1 ? "class" : "classes"}
          </p>

          {sessions.length === 0 ? (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              {q
                ? `No classes match “${q}”.`
                : date
                  ? "No classes on this day."
                  : "No classes scheduled this week. Search to find classes on other dates, or schedule one with the form."}
            </div>
          ) : (
            <ul className="space-y-3">
              {sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  booked={bookedBySession.get(session.id) ?? 0}
                  studios={studios}
                  classTypes={classTypes}
                  instructors={instructors}
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="lg:col-span-1">
          <div className="card sticky top-24 p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">
              Schedule a class
            </h2>
            <SessionForm
              studios={studios}
              classTypes={classTypes}
              instructors={instructors}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
