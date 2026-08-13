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
import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { SessionWithRelations } from "@/lib/types";
import { LOCALE_COOKIE, getDict, normalizeLocale } from "@/lib/i18n";
import { BookSessionRow } from "./BookSessionRow";

type MyStatus = "booked" | "waitlisted";

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const dict = getDict(locale);
  const supabase = await createClient();

  const nowIso = new Date().toISOString();

  // Public session list (RLS hides cancelled classes). Only upcoming, scheduled
  // classes are bookable, so we filter to those and order soonest-first.
  const sessionsRes = await supabase
    .from("sessions")
    .select(
      "*, studio:studios(id,name,slug,brand_color,timezone), class_type:class_types(id,name,color,credits_cost,description), instructor:instructors(id,display_name)",
    )
    .eq("status", "scheduled")
    .gt("starts_at", nowIso)
    .order("starts_at", { ascending: true });

  const sessions = (sessionsRes.data ?? []) as SessionWithRelations[];

  // Who am I, and how many credits do I have to spend?
  const { data: customerId } = await supabase.rpc("my_customer_id");
  let credits = 0;
  if (customerId) {
    const { data: balance } = await supabase.rpc("credit_balance", {
      p_customer: customerId,
    });
    credits = typeof balance === "number" ? balance : 0;
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
        <section className="lg:col-span-2">
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

        <aside className="lg:col-span-1">
          <div className="card sticky top-24 p-5">
            <h2 className="text-sm font-semibold text-ink">
              {dict.book_credits_heading}
            </h2>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-ink">
              {credits}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {dict.credits_available(credits)}
            </p>
            <p className="mt-4 text-xs leading-relaxed text-ink-muted">
              {dict.book_credits_help}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
