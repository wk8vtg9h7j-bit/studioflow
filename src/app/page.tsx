// ============================================================================
// Public landing page. Signed-in users are sent straight to their dashboard.
// ============================================================================
import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile, homePathForRole } from "@/lib/auth";

export default async function HomePage() {
  const profile = await getProfile();
  if (profile) redirect(homePathForRole(profile.role));

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

      <section className="mx-auto max-w-3xl px-6 pb-16 pt-20 text-center">
        <p className="mb-4 inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
          For boutique Pilates studios
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Run your studio, not your spreadsheets.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-pretty text-lg text-ink-muted">
          Class bookings, customer CRM, instructor payroll by attendance, and
          per-studio Google Calendar sync — in one place.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/signup" className="btn-primary">
            Create an account
          </Link>
          <Link href="/login" className="btn-secondary">
            I already have one
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-24 sm:grid-cols-3">
        {[
          {
            title: "Smart bookings",
            body: "Credit packages, capacity limits, and automatic waitlist promotion.",
          },
          {
            title: "Instructor payroll",
            body: "Pay rules by class, studio, and headcount — confirmed by instructors.",
          },
          {
            title: "Calendar sync",
            body: "Each studio mirrors its schedule to its own Google Calendar.",
          },
        ].map((f) => (
          <div key={f.title} className="card p-5">
            <h3 className="text-sm font-semibold text-ink">{f.title}</h3>
            <p className="mt-1.5 text-sm text-ink-muted">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
