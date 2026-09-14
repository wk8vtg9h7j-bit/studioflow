// ============================================================================
// Customer browse-and-book page. Lists upcoming, bookable classes with live seat
// counts and the member's current credit balance.
//
// Seat counts are the one thing a member can't read for themselves: the bookings
// RLS policy only exposes a customer's *own* bookings, so a logged-in client can
// never count how many other people hold a seat. We therefore tally booked seats
// with the service-role client (a read-only count, no personal data leaves it)
// and merge those totals into the public session list. The member's own bookings
// are read through their normal authed client so each row knows whether they're
// already booked or waitlisted.
// ============================================================================
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { SessionWithRelations } from "@/lib/types";
import { formatSessionDate } from "@/lib/format";
import { BookSessionRow } from "./BookSessionRow";
import { BookFilters } from "./BookFilters";
import { DayNav } from "./DayNav";

type MyStatus = "booked" | "waitlisted";

// A yyyy-MM-dd stamp for "now". The whole page is scoped to a single day, which
// keeps the list short enough to scan on a phone.
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    notice?: string;
    date?: string;
    studio?: string;
    type?: string;
  }>;
}) {
  const { error, notice, date, studio, type } = await searchParams;
  const supabase = await createClient();

  const nowIso = new Date().toISOString();
  const today = todayStamp();
  // Never show a day in the past — there's nothing bookable back there.
  const day = date && date >= today ? date : today;

  // The chosen day as a half-open window. Studio timezones vary, so we bound
  // generously in UTC and let each row render in its own studio's zone.
  const dayStart = `${day}T00:00:00.000Z`;
  const dayEnd = `${day}T23:59:59.999Z`;

  // Public session list (RLS hides cancelled classes). Only upcoming, scheduled
  // classes are bookable, so we filter to those and order soonest-first.
  let sessionsQuery = supabase
    .from("sessions")
    .select(
      "*, studio:studios(id,name,slug,brand_color,timezone), class_type:class_types(id,name,description,color,credits_cost,pool), instructor:instructors(id,display_name)",
    )
    .eq("status", "scheduled")
    .gt("starts_at", nowIso)
    .gte("starts_at", dayStart)
    .lte("starts_at", dayEnd);

  if (studio) sessionsQuery = sessionsQuery.eq("studio_id", studio);
  if (type) sessionsQuery = sessionsQuery.eq("class_type_id", type);

  const sessionsRes = await sessionsQuery.order("starts_at", {
    ascending: true,
  });

  const sessions = (sessionsRes.data ?? []) as SessionWithRelations[];

  // Options for the filter dropdowns. RLS already limits these to active rows
  // for non-admins, so whatever comes back is safe to offer.
  const [studiosRes, classTypesRes] = await Promise.all([
    supabase.from("studios").select("id,name").order("name"),
    supabase.from("class_types").select("id,name").order("name"),
  ]);
  const studios = (studiosRes.data ?? []) as { id: string; name: string }[];
  const classTypes = (classTypesRes.data ?? []) as {
    id: string;
    name: string;
  }[];

  // Who am I, and how many credits do I have to spend?
  const { data: customerId } = await supabase.rpc("my_customer_id");
  // Credits live in two pools that never mix, so we ask for each separately.
  let regularCredits = 0;
  let privateCredits = 0;
  if (customerId) {
    const [regularRes, privateRes] = await Promise.all([
      supabase.rpc("credit_balance", {
        p_customer: customerId,
        p_pool: "regular",
      }),
      supabase.rpc("credit_balance", {
        p_customer: customerId,
        p_pool: "private",
      }),
    ]);
    regularCredits = typeof regularRes.data === "number" ? regularRes.data : 0;
    privateCredits = typeof privateRes.data === "number" ? privateRes.data : 0;
  }

  // My own bookings — used to mark each row as already booked/waitlisted. RLS
  // scopes this to me, which is exactly what we want here.
  const myStatusBySession = new Map<string, MyStatus>();
  if (customerId) {
    const { data: myBookings } = await supabase
      .from("bookings")
      .select("session_id,status")
      .in("status", ["booked", "waitlisted"]);
    for (const b of myBookings ?? []) {
      const row = b as { session_id: string; status: MyStatus };
      myStatusBySession.set(row.session_id, row.status);
    }
  }

  // Booked-seat tallies for every listed session, counted with the service
  // client so we see everyone's seats (not just mine). Only "booked" rows take a
  // seat; waitlisted members don't.
  const bookedBySession = new Map<string, number>();
  if (sessions.length > 0) {
    const service = createServiceClient();
    const { data: seatRows } = await service
      .from("bookings")
      .select("session_id")
      .eq("status", "booked")
      .in(
        "session_id",
        sessions.map((s) => s.id),
      );
    for (const r of seatRows ?? []) {
      const id = (r as { session_id: string }).session_id;
      bookedBySession.set(id, (bookedBySession.get(id) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Book a class
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          One day at a time. Times are shown in each studio&apos;s local
          timezone. Booking spends credits from your balance.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          <DayNav
            date={day}
            today={today}
            label={formatSessionDate(`${day}T12:00:00.000Z`)}
          />
          <BookFilters
            studios={studios}
            classTypes={classTypes}
            studio={studio}
            type={type}
            date={day}
          />

          {sessions.length === 0 ? (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              No classes open for booking on this day. Try another date or clear
              your filters.
            </div>
          ) : (
            <ul className="space-y-3">
              {sessions.map((session) => (
                <BookSessionRow
                  key={session.id}
                  session={session}
                  booked={bookedBySession.get(session.id) ?? 0}
                  myStatus={myStatusBySession.get(session.id) ?? null}
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="order-first lg:order-last lg:col-span-1">
          <div className="card p-5 lg:sticky lg:top-24">
            <h2 className="text-sm font-semibold text-ink">Your credits</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-1">
              <div className="rounded-lg bg-stone-50 px-3 py-2">
                <dt className="text-xs text-ink-muted">Regular</dt>
                <dd className="text-2xl font-semibold tracking-tight text-ink">
                  {regularCredits}
                </dd>
              </div>
              <div className="rounded-lg bg-brand-50 px-3 py-2">
                <dt className="text-xs text-brand-700">Private</dt>
                <dd className="text-2xl font-semibold tracking-tight text-brand-700">
                  {privateCredits}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-ink-muted">
              Regular credits book regular classes and private credits book
              private ones — the two never mix. Out of credits? Purchase a
              package to top up.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
