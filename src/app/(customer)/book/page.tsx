// ============================================================================
// Customer browse-and-book page. One-day-at-a-time class list with studio/class
// filters, live seat counts, booking status and separate regular/private credit
// balances. Built on the current production auth/i18n behavior.
// ============================================================================
import { cookies } from "next/headers";
import { formatInTimeZone } from "date-fns-tz";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { SessionWithRelations } from "@/lib/types";
import { LOCALE_COOKIE, getDict, normalizeLocale } from "@/lib/i18n";
import { formatSessionDate } from "@/lib/format";
import { BookSessionRow } from "./BookSessionRow";
import { BookFilters } from "./BookFilters";
import { DayNav } from "./DayNav";

type MyStatus = "booked" | "waitlisted";

function todayStamp(): string {
  return formatInTimeZone(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd");
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
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const dict = getDict(locale);
  const supabase = await createClient();

  const nowIso = new Date().toISOString();
  const today = todayStamp();
  const day = date && date >= today ? date : today;

  // StudioFlow currently operates in Vietnam; use the local studio day rather
  // than UTC so early-morning/evening classes stay on the date customers expect.
  const dayStart = new Date(`${day}T00:00:00+07:00`).toISOString();
  const nextDayDate = new Date(`${day}T12:00:00+07:00`);
  nextDayDate.setUTCDate(nextDayDate.getUTCDate() + 1);
  const nextDay = formatInTimeZone(nextDayDate, "Asia/Ho_Chi_Minh", "yyyy-MM-dd");
  const dayEnd = new Date(`${nextDay}T00:00:00+07:00`).toISOString();

  let sessionsQuery = supabase
    .from("sessions")
    .select(
      "*, studio:studios(id,name,slug,brand_color,timezone), class_type:class_types(id,name,description,color,credits_cost,pool), instructor:instructors(id,display_name)",
    )
    .eq("status", "scheduled")
    .gt("starts_at", nowIso)
    .gte("starts_at", dayStart)
    .lt("starts_at", dayEnd);

  if (studio) sessionsQuery = sessionsQuery.eq("studio_id", studio);
  if (type) sessionsQuery = sessionsQuery.eq("class_type_id", type);

  const sessionsRes = await sessionsQuery.order("starts_at", { ascending: true });
  const sessions = (sessionsRes.data ?? []) as SessionWithRelations[];

  const [studiosRes, classTypesRes] = await Promise.all([
    supabase.from("studios").select("id,name").order("name"),
    supabase.from("class_types").select("id,name").order("name"),
  ]);
  const studios = (studiosRes.data ?? []) as { id: string; name: string }[];
  const classTypes = (classTypesRes.data ?? []) as { id: string; name: string }[];

  const { data: customerId } = await supabase.rpc("my_customer_id");
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
          {dict.book_title}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{dict.book_intro}</p>
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
            label={formatSessionDate(`${day}T12:00:00+07:00`)}
            previousLabel={dict.day_previous}
            nextLabel={dict.day_next}
            todayLabel={dict.day_today}
          />
          <BookFilters
            studios={studios}
            classTypes={classTypes}
            studio={studio}
            type={type}
            date={day}
            labels={{
              studio: dict.filter_studio,
              allStudios: dict.filter_all_studios,
              classType: dict.filter_class,
              allClasses: dict.filter_all_classes,
              clear: dict.filter_clear,
            }}
          />

          {sessions.length === 0 ? (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              {dict.book_empty}
            </div>
          ) : (
            <ul className="space-y-3">
              {sessions.map((session) => (
                <BookSessionRow
                  key={session.id}
                  session={session}
                  booked={bookedBySession.get(session.id) ?? 0}
                  myStatus={myStatusBySession.get(session.id) ?? null}
                  dict={dict}
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="order-first lg:order-last lg:col-span-1">
          <div className="card p-5 lg:sticky lg:top-24">
            <h2 className="text-sm font-semibold text-ink">
              {dict.book_credits_heading}
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-1">
              <div className="rounded-lg bg-stone-50 px-3 py-2">
                <dt className="text-xs text-ink-muted">
                  {dict.packages_pool_regular}
                </dt>
                <dd className="text-2xl font-semibold tracking-tight text-ink">
                  {regularCredits}
                </dd>
              </div>
              <div className="rounded-lg bg-brand-50 px-3 py-2">
                <dt className="text-xs text-brand-700">
                  {dict.packages_pool_private}
                </dt>
                <dd className="text-2xl font-semibold tracking-tight text-brand-700">
                  {privateCredits}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-ink-muted">
              {dict.book_credits_help}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
