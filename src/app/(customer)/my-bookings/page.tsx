// ============================================================================
// Customer "My bookings" page. Lists the member's own bookings joined to their
// sessions, split into Upcoming and Past. RLS scopes the bookings query to the
// signed-in member automatically, so a plain authed client is all we need here.
//
// Cancellation is only offered for bookings the member still actively holds
// (booked or waitlisted) on a class that hasn't started yet — that mirrors what
// the cancel_booking RPC will actually allow, so we don't show a dead button.
// ============================================================================
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getDict, localeFromCookieString } from "@/lib/i18n";
import { BookingRow, type BookingWithSession } from "./BookingRow";

export default async function MyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;
  const cookieStore = await cookies();
  const dict = getDict(localeFromCookieString(cookieStore.toString()));
  const supabase = await createClient();

  // RLS limits this to the member's own bookings. We pull the full session
  // context for each so every row can render when/where/who without extra round
  // trips, newest classes first.
  const { data } = await supabase
    .from("bookings")
    .select(
      "id,status,credits_spent,session:sessions(*, studio:studios(id,name,slug,brand_color,timezone), class_type:class_types(id,name,color,credits_cost), instructor:instructors(id,display_name))",
    )
    .order("created_at", { ascending: false });

  const bookings = (data ?? []) as unknown as BookingWithSession[];

  // Split into upcoming vs past by the session start time. Bookings whose class
  // has been removed (no session) fall into past so they're out of the way.
  const nowMs = Date.now();
  const upcoming: BookingWithSession[] = [];
  const past: BookingWithSession[] = [];
  for (const b of bookings) {
    const startsMs = b.session ? Date.parse(b.session.starts_at) : 0;
    if (b.session && startsMs > nowMs) {
      upcoming.push(b);
    } else {
      past.push(b);
    }
  }

  // Show soonest-first within Upcoming (the query came back newest-first).
  upcoming.sort((a, b) =>
    a.session && b.session
      ? Date.parse(a.session.starts_at) - Date.parse(b.session.starts_at)
      : 0,
  );

  const canCancel = (b: BookingWithSession) =>
    !!b.session &&
    Date.parse(b.session.starts_at) > nowMs &&
    (b.status === "booked" || b.status === "waitlisted");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {dict.bookings_title}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{dict.bookings_intro}</p>
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

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">
          {dict.bookings_upcoming}
        </h2>
        {upcoming.length === 0 ? (
          <div className="card px-5 py-10 text-center text-sm text-ink-muted">
            {dict.bookings_none_upcoming}{" "}
            <a href="/book" className="font-medium text-ink underline">
              {dict.bookings_book_now}
            </a>
            .
          </div>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((b) => (
              <BookingRow
                key={b.id}
                booking={b}
                cancellable={canCancel(b)}
                dict={dict}
              />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-ink">
            {dict.bookings_past}
          </h2>
          <ul className="space-y-3">
            {past.map((b) => (
              <BookingRow
                key={b.id}
                booking={b}
                cancellable={false}
                dict={dict}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
