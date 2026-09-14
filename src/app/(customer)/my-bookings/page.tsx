// ============================================================================
// Customer "My bookings" page. Lists the member's own bookings joined to their
// sessions, split into Upcoming and Past. RLS scopes the bookings query to the
// signed-in member automatically, so a plain authed client is all we need here.
//
// Cancellation is only offered for bookings the member still actively holds
// (booked or waitlisted) on a class that is still more than three hours away.
// The same window is re-checked server-side in cancelBookingAction, so hiding
// the button here is a courtesy, not the enforcement.
// ============================================================================
import { createClient } from "@/lib/supabase/server";
import { BookingRow, type BookingWithSession } from "./BookingRow";

// Members may cancel up to three hours before the class starts. Inside that
// window the spot is held for them and the credit stays spent.
const CANCEL_WINDOW_MS = 3 * 60 * 60 * 1000;

export default async function MyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;
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

  // A booking is still cancellable only while the class is more than the cancel
  // window away. Inside that window the row stays visible but the button is
  // replaced with a short note explaining why.
  const canCancel = (b: BookingWithSession) =>
    !!b.session &&
    Date.parse(b.session.starts_at) - nowMs > CANCEL_WINDOW_MS &&
    (b.status === "booked" || b.status === "waitlisted");

  // Upcoming, still held, but inside the three-hour window — the credit is gone.
  const isLocked = (b: BookingWithSession) =>
    !!b.session &&
    Date.parse(b.session.starts_at) > nowMs &&
    (b.status === "booked" || b.status === "waitlisted") &&
    !canCancel(b);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          My bookings
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your upcoming classes and booking history.
        </p>
      </div>

      <div className="card px-5 py-4">
        <h2 className="text-sm font-semibold text-ink">Cancellation policy</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          You can cancel a class up to{" "}
          <span className="font-medium text-ink">3 hours before it starts</span>{" "}
          and your credit goes straight back to your balance. After that the
          spot is held for you and the credit is used, whether you make it or
          not.
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

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Upcoming</h2>
        {upcoming.length === 0 ? (
          <div className="card px-5 py-10 text-center text-sm text-ink-muted">
            You have no upcoming classes.{" "}
            <a href="/book" className="font-medium text-ink underline">
              Book one now
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
                locked={isLocked(b)}
              />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-ink">Past</h2>
          <ul className="space-y-3">
            {past.map((b) => (
              <BookingRow key={b.id} booking={b} cancellable={false} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
