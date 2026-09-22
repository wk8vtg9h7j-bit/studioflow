// ============================================================================
// Sessions admin — the scheduled-class calendar list plus an inline "schedule a
// class" form. A session pins a class type to a studio at a wall-clock time,
// with an optional instructor, room and capacity. The list and the form both
// need the same option arrays (studios, class types, instructors), so we fetch
// them once here and hand them to every row as well as the sidebar form.
//
// The list defaults to the CURRENT WEEK only (Mon–Sun in studio time), which
// keeps it scannable once a schedule has months of history. Anything outside
// that window is reachable through the search box, which drops the week bound
// and looks across the whole schedule instead.
//
// Only active studios/class types/instructors are offered for new sessions, but
// existing sessions still render their relations even if those have since been
// deactivated (the joins below are independent of the active filters).
// ============================================================================
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { FALLBACK_TZ } from "@/lib/format";
import type { SessionWithRelations } from "@/lib/types";
import { SessionFilters } from "./SessionFilters";
import { SessionForm } from "./SessionForm";
import type {
  StudioOption,
  ClassTypeOption,
  InstructorOption,
} from "./SessionForm";
import { SessionRow, type CustomerOption } from "./SessionRow";

const DAY_MS = 86_400_000;

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    studio?: string;
    type?: string;
    date?: string;
    q?: string;
  }>;
}) {
  const params = await searchParams;
  const studio = params.studio?.trim() || undefined;
  const type = params.type?.trim() || undefined;
  const date = params.date?.trim() || undefined;
  const q = params.q?.trim() || undefined;

  const supabase = await createClient();
  const service = createServiceClient();

  // The option lists come first: resolving a text search against class-type
  // names needs their ids before the sessions query can be built.
  const [studiosRes, classTypesRes, instructorsRes, customersRes] = await Promise.all([
    supabase
      .from("studios")
      .select("id,name,timezone")
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("class_types")
      .select("id,name,default_duration_min,default_capacity,credits_cost,pool")
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("instructors")
      .select("id,display_name")
      .eq("active", true)
      .order("display_name", { ascending: true }),
    service
      .from("customers")
      .select("id,name,email,profile:profiles(full_name,email)")
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  const studios = (studiosRes.data ?? []) as StudioOption[];
  const classTypes = (classTypesRes.data ?? []) as ClassTypeOption[];
  const instructors = (instructorsRes.data ?? []) as InstructorOption[];
  const customers = ((customersRes.data ?? []) as unknown as {
    id: string;
    name: string | null;
    email: string | null;
    profile: { full_name: string | null; email: string | null } | null;
  }[])
    .map(
      (customer): CustomerOption => ({
        id: customer.id,
        name:
          customer.profile?.full_name ??
          customer.name ??
          customer.profile?.email ??
          customer.email ??
          "Unnamed customer",
        email: customer.profile?.email ?? customer.email ?? null,
      }),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Week bounds, anchored on Monday in studio time. Vietnam has no DST, so the
  // day length is a constant and plain millisecond arithmetic is safe here.
  const todayKey = formatInTimeZone(new Date(), FALLBACK_TZ, "yyyy-MM-dd");
  const todayStart = fromZonedTime(`${todayKey}T00:00:00`, FALLBACK_TZ);
  const dowSun0 = new Date(`${todayKey}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const weekStart = new Date(
    todayStart.getTime() - ((dowSun0 + 6) % 7) * DAY_MS,
  );
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);

  let query = supabase
    .from("sessions")
    .select(
      "*, studio:studios(id,name,slug,brand_color,timezone), class_type:class_types(id,name,color,credits_cost,pool), instructor:instructors(id,display_name)",
    );

  if (studio) query = query.eq("studio_id", studio);
  if (type) query = query.eq("class_type_id", type);

  // A picked day wins over a text search; a search drops the week bound so it
  // can reach the whole schedule; otherwise we stay inside the current week.
  let rangeLabel: string;
  if (date) {
    const dayStart = fromZonedTime(`${date}T00:00:00`, FALLBACK_TZ);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    query = query
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString());
    rangeLabel = formatInTimeZone(dayStart, FALLBACK_TZ, "EEE, d MMM yyyy");
  } else if (q) {
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
    rangeLabel = `${formatInTimeZone(weekStart, FALLBACK_TZ, "d MMM")} – ${formatInTimeZone(
      new Date(weekEnd.getTime() - DAY_MS),
      FALLBACK_TZ,
      "d MMM yyyy",
    )}`;
  }

  const sessionsRes = await query.order("starts_at", { ascending: true });
  const sessions = (sessionsRes.data ?? []) as SessionWithRelations[];

  // Live seat counts for the list. The bookings RLS policy scopes reads to the
  // caller's own rows, so we tally with the service client — the same read the
  // customer book page does. Seeded with any seats reception is holding, so a
  // filled class reads as booked here too without a row entering bookings.
  const bookedBySession = new Map<string, number>();
  for (const s of sessions) {
    if (s.filler_seats > 0) bookedBySession.set(s.id, s.filler_seats);
  }
  if (sessions.length > 0) {
    const { data: seatRows } = await service
      .from("bookings")
      .select("session_id,spots_count")
      .in("status", ["booked", "attended"])
      .in(
        "session_id",
        sessions.map((s) => s.id),
      );
    for (const r of seatRows ?? []) {
      const row = r as { session_id: string; spots_count: number | null };
      bookedBySession.set(
        row.session_id,
        (bookedBySession.get(row.session_id) ?? 0) + (row.spots_count ?? 1),
      );
    }
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
                  customers={customers}
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
