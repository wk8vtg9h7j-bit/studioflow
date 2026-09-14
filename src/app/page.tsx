// ============================================================================
// Public landing page. Signed-in users are sent straight to their dashboard.
//
// Everything below the hero is live studio data: the next scheduled classes,
// the packages we actually sell, and the studios themselves. Visitors here have
// no session, so we read with the service client — these are read-only catalogue
// queries with no personal data in them. Note the explicit column lists on
// `studios`: that table also carries Google OAuth tokens, which must never leave
// the server.
// ============================================================================
import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile, homePathForRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  formatMoney,
  formatSessionDate,
  formatSessionTimeRange,
} from "@/lib/format";
import type { SessionWithRelations } from "@/lib/types";

type PublicPackage = {
  id: string;
  name: string;
  description: string | null;
  credits: number;
  price_cents: number;
  currency: string;
  validity_days: number;
  pool: string | null;
};

type PublicStudio = {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  brand_color: string | null;
  timezone: string;
};

export default async function HomePage() {
  const profile = await getProfile();
  if (profile) redirect(homePathForRole(profile.role));

  const service = createServiceClient();
  const nowIso = new Date().toISOString();

  const [sessionsRes, packagesRes, studiosRes] = await Promise.all([
    service
      .from("sessions")
      .select(
        "*, studio:studios(id,name,slug,brand_color,timezone), class_type:class_types(id,name,description,color,credits_cost,pool), instructor:instructors(id,display_name)",
      )
      .eq("status", "scheduled")
      .gt("starts_at", nowIso)
      .order("starts_at", { ascending: true })
      .limit(24),
    service
      .from("packages")
      .select(
        "id,name,description,credits,price_cents,currency,validity_days,pool",
      )
      .eq("active", true)
      .gt("price_cents", 0)
      .not("name", "ilike", "%share%")
      .order("price_cents", { ascending: true }),
    service
      .from("studios")
      .select("id,name,slug,address,brand_color,timezone")
      .eq("active", true)
      .order("name"),
  ]);

  const sessions = (sessionsRes.data ?? []) as SessionWithRelations[];
  const packages = (packagesRes.data ?? []) as PublicPackage[];
  const studios = (studiosRes.data ?? []) as PublicStudio[];

  // Group the upcoming classes under the studio they run at, capped so the
  // section stays short on a phone. Studios drive the order so the two columns
  // stay put between page loads.
  const sessionsByStudio = studios
    .map((studio) => ({
      studio,
      sessions: sessions
        .filter((s) => s.studio?.id === studio.id)
        .slice(0, 4),
    }))
    .filter((group) => group.sessions.length > 0);

  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight text-ink">
          Studio<span className="text-brand-600">Flow</span>
        </span>
        <nav className="flex items-center gap-2">
          <Link href="/login" className="btn-ghost">
            Log in
          </Link>
          <Link href="/signup" className="btn-primary">
            Get started
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 pb-14 pt-16 text-center sm:pt-20">
        <p className="mb-4 inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
          Reformer &amp; Mat Pilates in Da Nang
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Book your next class in a few taps.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-lg text-ink-muted">
          Two studios, small classes, and credit packages that never expire on
          you mid-week. See what&apos;s on below and grab a spot.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/signup" className="btn-primary w-full sm:w-auto">
            Create an account
          </Link>
          <Link href="/login" className="btn-secondary w-full sm:w-auto">
            I already have one
          </Link>
        </div>
      </section>

      {/* Upcoming classes */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-ink">
            Next classes
          </h2>
          <Link
            href="/login"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            See full schedule
          </Link>
        </div>

        {sessionsByStudio.length === 0 ? (
          <div className="card mt-4 px-5 py-10 text-center text-sm text-ink-muted">
            No classes on the schedule right now. Check back shortly.
          </div>
        ) : (
          <div className="mt-4 space-y-8">
            {sessionsByStudio.map(({ studio, sessions: studioSessions }) => (
              <div key={studio.id}>
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: studio.brand_color ?? "#7c3aed" }}
                  />
                  <h3 className="text-sm font-semibold text-ink">
                    {studio.name}
                  </h3>
                </div>
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {studioSessions.map((session) => {
                    const tz = session.studio?.timezone;
                    const isPrivate = session.class_type?.pool === "private";
                    return (
                      <li key={session.id} className="card overflow-hidden">
                        <div className="flex gap-3 p-4">
                          <span
                            aria-hidden
                            className="w-1 shrink-0 rounded-full"
                            style={{
                              backgroundColor:
                                session.class_type?.color ?? "#8b5cf6",
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-sm font-semibold text-ink">
                                {session.title ??
                                  session.class_type?.name ??
                                  "Class"}
                              </h4>
                              {isPrivate && (
                                <span className="badge">Private</span>
                              )}
                            </div>
                            <p className="mt-1 text-sm text-ink-muted">
                              {formatSessionDate(session.starts_at, tz)}
                            </p>
                            <p className="text-sm font-medium text-ink">
                              {formatSessionTimeRange(
                                session.starts_at,
                                session.ends_at,
                                tz,
                              )}
                            </p>
                            {session.instructor?.display_name && (
                              <p className="mt-2 text-xs text-ink-soft">
                                {session.instructor.display_name}
                              </p>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Packages */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <h2 className="text-xl font-semibold tracking-tight text-ink">
          Packages
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Buy credits once, spend them on any class in the pool.
        </p>

        {packages.length === 0 ? (
          <div className="card mt-4 px-5 py-10 text-center text-sm text-ink-muted">
            Pricing is being updated. Get in touch and we&apos;ll sort you out.
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {packages.map((pkg) => (
              <li key={pkg.id} className="card flex flex-col p-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">{pkg.name}</h3>
                  {pkg.pool === "private" && (
                    <span className="badge">Private</span>
                  )}
                </div>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-ink">
                  {formatMoney(pkg.price_cents, pkg.currency)}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  {pkg.credits} {pkg.credits === 1 ? "credit" : "credits"} ·
                  valid {pkg.validity_days} days
                </p>
                {pkg.description && (
                  <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                    {pkg.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Studios */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <h2 className="text-xl font-semibold tracking-tight text-ink">
          Our studios
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {studios.map((studio) => (
            <li key={studio.id} className="card p-5">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: studio.brand_color ?? "#7c3aed" }}
                />
                <h3 className="text-sm font-semibold text-ink">
                  {studio.name}
                </h3>
              </div>
              {studio.address && (
                <p className="mt-2 text-sm text-ink-muted">{studio.address}</p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
