"use client";

// ============================================================================
// Interactive consumer landing for the Recharged Da Nang studios. The location
// toggle re-themes the page accent and swaps in that studio's real "today"
// schedule (passed in from the server). The pricing schedule is interactive
// (select a package to see the per-class price and savings). Motion follows
// emil-design-eng: custom ease-out curves, transform/opacity only, press +
// hover-lift, and reduced-motion fallbacks (utilities live in globals.css).
// ============================================================================
import { useState } from "react";
import Link from "next/link";

export type LandingClass = {
  name: string;
  description: string;
  credits: number;
  color: string;
  time: string;
};

export type LandingStudio = {
  key: string;
  name: string;
  short: string;
  address: string;
  accent: string; // hex, drives the --accent custom property
  blurb: string;
  classes: LandingClass[];
  scheduleLabel: string; // the day the shown lineup is for, e.g. "Fri 26 Jun"
};

type Pkg = {
  name: string;
  credits: number;
  price: number; // VND
  validity: number; // days
  note?: string;
  highlight?: boolean;
};

const PACKAGES: Pkg[] = [
  { name: "Single Class", credits: 1, price: 400_000, validity: 30 },
  { name: "5 Class Pack", credits: 5, price: 1_700_000, validity: 90 },
  {
    name: "10 Class Pack",
    credits: 10,
    price: 3_200_000,
    validity: 120,
    note: "Best value for regulars",
    highlight: true,
  },
  { name: "20 Class Pack", credits: 20, price: 5_600_000, validity: 180 },
];

const SINGLE_PER_CLASS = 400_000;
const vnd = (n: number) => `${n.toLocaleString("vi-VN")} ₫`;

export default function LandingExperience({
  studios,
}: {
  studios: LandingStudio[];
}) {
  const [studioKey, setStudioKey] = useState<string>(studios[0]?.key ?? "");
  const [selected, setSelected] = useState<number>(2); // default: 10 Class Pack

  const studio = studios.find((s) => s.key === studioKey) ?? studios[0];
  const pkg = PACKAGES[selected];
  const perClass = Math.round(pkg.price / pkg.credits);
  const savedPerClass = SINGLE_PER_CLASS - perClass;
  const savedTotal = savedPerClass * pkg.credits;
  const savedPct = Math.round((savedPerClass / SINGLE_PER_CLASS) * 100);

  const accent = studio?.accent ?? "#7c3aed";

  return (
    <main
      className="min-h-screen transition-colors duration-500"
      style={{ ["--accent" as string]: accent }}
    >
      {/* Header ----------------------------------------------------------- */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight text-ink">
          Recharged
          <span className="text-[var(--accent)] transition-colors duration-500">
            {" "}
            Da Nang
          </span>
        </span>
        <nav className="flex items-center gap-2">
          <Link href="/login" className="btn-ghost press">
            Log in
          </Link>
          <Link
            href="/signup"
            className="press inline-flex items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-500 hover:opacity-90"
          >
            Book a class
          </Link>
        </nav>
      </header>

      {/* Hero ------------------------------------------------------------- */}
      <section className="mx-auto max-w-3xl px-6 pb-10 pt-16 text-center sm:pt-20">
        {/* Location toggle */}
        {studios.length > 1 && (
          <div className="reveal reveal-1 mb-7 inline-flex rounded-full border border-stone-200 bg-white p-1 shadow-sm">
            {studios.map((s) => {
              const active = s.key === studio?.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStudioKey(s.key)}
                  aria-pressed={active}
                  className="press relative rounded-full px-5 py-2 text-sm font-medium transition-colors duration-300"
                  style={
                    active
                      ? { backgroundColor: s.accent, color: "#fff" }
                      : { color: "#57534e" }
                  }
                >
                  {s.short}
                </button>
              );
            })}
          </div>
        )}

        <p className="reveal reveal-2 mb-4 inline-flex items-center rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-ink-muted">
          {studio?.name}
          {studio?.address ? ` · ${studio.address}` : ""}
        </p>
        <h1 className="reveal reveal-3 text-balance text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Move with intention.
          <br />
          Leave recharged.
        </h1>
        <p className="reveal reveal-4 mx-auto mt-5 max-w-xl text-pretty text-lg text-ink-muted">
          {studio?.blurb}
        </p>
        <div className="reveal reveal-5 mt-8 flex items-center justify-center gap-3">
          <Link
            href="/signup"
            className="press inline-flex items-center justify-center rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors duration-500 hover:opacity-90"
          >
            Book your first class
          </Link>
          <Link href="/login" className="btn-secondary press">
            I have an account
          </Link>
        </div>
      </section>

      {/* Classes ---------------------------------------------------------- */}
      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-ink">
              Weekly schedule · {studio?.short}
            </h2>
            {studio?.scheduleLabel && (
              <p className="mt-1 text-sm text-ink-muted">
                Classes from {studio.scheduleLabel}
              </p>
            )}
          </div>
          <span className="text-sm text-ink-muted">50 min · max 4 people</span>
        </div>
        {studio && studio.classes.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {studio.classes.map((c, i) => (
              <article
                key={`${c.name}-${c.time}`}
                className={`card hover-lift reveal reveal-${Math.min(i + 1, 6)} p-5`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
                    style={{ backgroundColor: c.color }}
                    aria-hidden
                  >
                    {c.name.charAt(0)}
                  </span>
                  <span className="text-xs font-medium text-ink-soft">
                    {c.time}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-ink">{c.name}</h3>
                {c.description && (
                  <p className="mt-1.5 text-sm text-ink-muted">
                    {c.description}
                  </p>
                )}
                <p className="mt-3 text-xs font-medium text-ink-soft">
                  {c.credits} credit{c.credits > 1 ? "s" : ""}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="card px-5 py-12 text-center text-sm text-ink-muted">
            Schedule coming soon — check back shortly.
          </div>
        )}
      </section>

      {/* Pricing ---------------------------------------------------------- */}
      <section className="mx-auto max-w-5xl px-6 pb-24 pt-4">
        <div className="mb-6 text-center">
          <h2 className="text-xl font-semibold tracking-tight text-ink">
            Class packages
          </h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            One set of credits, valid at both studios. Tap a pack to compare.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PACKAGES.map((p, i) => {
            const active = i === selected;
            const each = Math.round(p.price / p.credits);
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => setSelected(i)}
                aria-pressed={active}
                className={`press relative rounded-xl border bg-white p-5 text-left transition-[transform,box-shadow,border-color] duration-200 ${
                  active
                    ? "shadow-card"
                    : "border-stone-200 hover:border-stone-300"
                }`}
                style={
                  active
                    ? {
                        borderColor: accent,
                        boxShadow: `0 0 0 1px ${accent}`,
                      }
                    : undefined
                }
              >
                {p.highlight && (
                  <span
                    className="absolute -top-2.5 right-4 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                    style={{ backgroundColor: accent }}
                  >
                    Popular
                  </span>
                )}
                <h3 className="text-sm font-semibold text-ink">{p.name}</h3>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">
                  {vnd(p.price)}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  {vnd(each)} / class · {p.credits} credit
                  {p.credits > 1 ? "s" : ""}
                </p>
                <p className="mt-3 text-xs text-ink-soft">
                  Valid {p.validity} days
                </p>
              </button>
            );
          })}
        </div>

        {/* Selected summary */}
        <div
          key={`${selected}-${studio?.key}`}
          className="reveal card mt-6 flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center"
        >
          <div>
            <p className="text-sm font-medium text-ink">
              {pkg.name} — {vnd(pkg.price)}
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              {vnd(perClass)} per class
              {savedTotal > 0 ? (
                <>
                  {" · "}
                  <span className="font-medium" style={{ color: accent }}>
                    save {vnd(savedTotal)} ({savedPct}%)
                  </span>{" "}
                  vs single classes
                </>
              ) : (
                " · pay as you go"
              )}
            </p>
          </div>
          <Link
            href="/signup"
            className="press inline-flex shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors duration-500 hover:opacity-90"
          >
            Get {pkg.credits} credit{pkg.credits > 1 ? "s" : ""}
          </Link>
        </div>
      </section>
    </main>
  );
}
