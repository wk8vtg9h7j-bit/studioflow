// ============================================================================
// DayNav — the booking page's day picker. The class list shows one day at a
// time; this lets a member step to the previous/next day, jump to any date with
// the native calendar, or snap back to today. Existing studio/class filters in
// the URL are preserved as the day changes.
// ============================================================================
"use client";

import { useRouter, useSearchParams } from "next/navigation";

function addDays(yyyyMmDd: string, n: number): string {
  const d = new Date(`${yyyyMmDd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function DayNav({
  date,
  today,
  label,
  previousLabel,
  nextLabel,
  todayLabel,
}: {
  date: string;
  today: string;
  label: string;
  previousLabel: string;
  nextLabel: string;
  todayLabel: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function go(next: string) {
    const p = new URLSearchParams(params.toString());
    p.set("date", next);
    router.push(`/book?${p.toString()}`);
  }

  const isToday = date === today;

  return (
    <div className="card flex items-center gap-2 p-2">
      <button
        type="button"
        onClick={() => go(addDays(date, -1))}
        aria-label={previousLabel}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink-muted transition hover:bg-stone-100 hover:text-ink active:scale-95"
      >
        ‹
      </button>

      <div className="min-w-0 flex-1 text-center">
        <p className="truncate text-sm font-semibold text-ink">{label}</p>
        <label className="mt-0.5 inline-flex cursor-pointer items-center gap-1 text-xs text-brand-600">
          <input
            type="date"
            value={date}
            min={today}
            onChange={(e) => e.target.value && go(e.target.value)}
            className="cursor-pointer bg-transparent text-xs text-brand-600 outline-none"
          />
        </label>
      </div>

      {!isToday && (
        <button
          type="button"
          onClick={() => go(today)}
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-stone-100 hover:text-ink active:scale-95"
        >
          {todayLabel}
        </button>
      )}

      <button
        type="button"
        onClick={() => go(addDays(date, 1))}
        aria-label={nextLabel}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink-muted transition hover:bg-stone-100 hover:text-ink active:scale-95"
      >
        ›
      </button>
    </div>
  );
}
