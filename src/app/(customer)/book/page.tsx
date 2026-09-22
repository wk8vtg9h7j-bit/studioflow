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
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { SessionWithRelations } from "@/lib/types";
import { FALLBACK_TZ, formatSessionDate } from "@/lib/format";
import { BookSessionRow } from "./BookSessionRow";
import { BookFilters } from "./BookFilters";
import { DayNav } from "./DayNav";
import { getLocale } from "@/lib/locale-server";

type MyStatus = "booked" | "waitlisted";

// A yyyy-MM-dd stamp for "now". The whole page is scoped to a single day, which
// keeps the list short enough to scan on a phone.
function todayStamp(): string {
  return formatInTimeZone(new Date(), FALLBACK_TZ, "yyyy-MM-dd");
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
  const locale = await getLocale();
  const vi = locale === "vi";
  const supabase = await createClient();

  const nowIso = new Date().toISOString();
  const today = todayStamp();
  // Never show a day in the past — there's nothing bookable back there.
  const day = date && date >= today ? date : today;

  // The chosen day is interpreted in Vietnam/studio local time, then converted
  // to UTC for the database query. This prevents early-morning classes from
  // slipping onto the previous/next date because of UTC midnight boundaries.
  const dayStart = fromZonedTime(`${day}T00:00:00`, FALLBACK_TZ);
  const dayEnd = fromZonedTime(`${day}T00:00:00`, FALLBACK_TZ);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // Public session list (RLS hides cancelled classes). Only upcoming, scheduled
  // classes are bookable, so we filter to those and order soonest-first.
  let sessionsQuery = supabase
    .from("sessions")
    .select(
      "*, studio:studios(id,name,slug,brand_color,timezone), class_type:class_types(id,name,description,color,credits_cost,pool), instructor:instructors(id,display_name)",
    )
    .eq("status", "scheduled")
    .gt("starts_at", nowIso)
    .gte("starts_at", dayStart.toISOString())
    .lt("starts_at", dayEnd.toISOString());

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

  // Occupied-seat tallies for every listed session, counted with the service
  // client so we see everyone's seats (not just mine). Both booked and attended
  // rows occupy seats; waitlisted members do not. Multi-spot bookings contribute
  // their full spots_count.
  // Seeded with any seats reception is holding (filler_seats), so a held class
  // reads as full here without a single row being written to bookings.
  const bookedBySession = new Map<string, number>();
  for (const s of sessions) {
    if (s.filler_seats > 0) bookedBySession.set(s.id, s.filler_seats);
  }
  if (sessions.length > 0) {
    const service = createServiceClient();
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
          {vi ? "Đặt lớp" : "Book a class"}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {vi
            ? "Chọn lớp theo từng ngày. Thời gian hiển thị theo múi giờ của studio. Khi đặt lớp, tín dụng sẽ được trừ khỏi số dư của bạn."
            : "One day at a time. Times are shown in each studio's local timezone. Booking spends credits from your balance."}
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
              {vi
                ? "Không có lớp nào mở để đặt trong ngày này. Hãy chọn ngày khác hoặc xóa bộ lọc."
                : "No classes open for booking on this day. Try another date or clear your filters."}
            </div>
          ) : (
            <ul className="space-y-3">
              {sessions.map((session) => (
                <BookSessionRow
                  key={session.id}
                  session={session}
                  booked={bookedBySession.get(session.id) ?? 0}
                  myStatus={myStatusBySession.get(session.id) ?? null}
                  locale={locale}
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="order-first lg:order-last lg:col-span-1">
          <div className="card p-5 lg:sticky lg:top-24">
            <h2 className="text-sm font-semibold text-ink">
              {vi ? "Tín dụng của bạn" : "Your credits"}
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-1">
              <div className="rounded-lg bg-stone-50 px-3 py-2">
                <dt className="text-xs text-ink-muted">{vi ? "Thường" : "Regular"}</dt>
                <dd className="text-2xl font-semibold tracking-tight text-ink">
                  {regularCredits}
                </dd>
              </div>
              <div className="rounded-lg bg-brand-50 px-3 py-2">
                <dt className="text-xs text-brand-700">{vi ? "Riêng" : "Private"}</dt>
                <dd className="text-2xl font-semibold tracking-tight text-brand-700">
                  {privateCredits}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-ink-muted">
              {vi
                ? "Tín dụng thường dùng cho lớp thường và tín dụng riêng dùng cho lớp riêng. Hai loại không được dùng lẫn nhau. Hết tín dụng? Hãy mua thêm gói tập."
                : "Regular credits book regular classes and private credits book private ones — the two never mix. Out of credits? Purchase a package to top up."}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
