// ============================================================================
// SessionFilters — studio / day / class filters plus a search box for the
// sessions list. The three dropdown-style filters apply automatically on change
// (no "Filter" button); the search box applies on Enter or on blur, because
// navigating on every keystroke would be unusable.
//
// The list only shows the current week by default, so search is the way to
// reach any other date — it drops the week bound server-side. Because the
// server gives a picked day precedence over a text search, the "Day" and
// "Search" controls are mutually exclusive here: setting one clears the other.
// ============================================================================
"use client";

import { useRouter } from "next/navigation";

type Opt = { id: string; name: string };

const KEYS = ["studio", "type", "date", "q"] as const;
type FilterKey = (typeof KEYS)[number];

export function SessionFilters({
  studios,
  classTypes,
  studio,
  type,
  date,
  q,
}: {
  studios: Opt[];
  classTypes: Opt[];
  studio?: string;
  type?: string;
  date?: string;
  q?: string;
}) {
  const router = useRouter();
  const hasFilters = Boolean(studio || type || date || q);

  function apply(key: FilterKey, value: string) {
    const next: Record<FilterKey, string | undefined> = {
      studio,
      type,
      date,
      q,
    };
    next[key] = value;
    if (key === "q" && value) next.date = undefined;
    if (key === "date" && value) next.q = undefined;

    const params = new URLSearchParams();
    for (const k of KEYS) {
      const v = next[k];
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    router.push(qs ? `/admin/sessions?${qs}` : "/admin/sessions");
  }

  return (
    <div className="card flex flex-wrap items-end gap-3 p-4">
      <div className="min-w-[10rem] flex-1">
        <label className="label" htmlFor="sf-studio">
          Studio
        </label>
        <select
          id="sf-studio"
          className="input"
          value={studio ?? ""}
          onChange={(e) => apply("studio", e.target.value)}
        >
          <option value="">All studios</option>
          {studios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-[9rem] flex-1">
        <label className="label" htmlFor="sf-date">
          Day
        </label>
        <input
          id="sf-date"
          type="date"
          className="input"
          value={date ?? ""}
          onChange={(e) => apply("date", e.target.value)}
        />
      </div>
      <div className="min-w-[10rem] flex-1">
        <label className="label" htmlFor="sf-type">
          Class
        </label>
        <select
          id="sf-type"
          className="input"
          value={type ?? ""}
          onChange={(e) => apply("type", e.target.value)}
        >
          <option value="">All classes</option>
          {classTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-[12rem] flex-1">
        <label className="label" htmlFor="sf-q">
          Search
        </label>
        <input
          id="sf-q"
          key={q ?? ""}
          type="search"
          className="input"
          placeholder="Class name — searches all dates"
          defaultValue={q ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply("q", e.currentTarget.value.trim());
            }
          }}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v !== (q ?? "")) apply("q", v);
          }}
        />
      </div>
      {hasFilters && (
        <a href="/admin/sessions" className="btn-secondary">
          Clear
        </a>
      )}
    </div>
  );
}
