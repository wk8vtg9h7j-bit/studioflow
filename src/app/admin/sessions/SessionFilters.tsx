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
    // A picked day beats a text search server-side, so never leave both set.
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
    <div className="card grid min-w-0 grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-4">
      <div className="min-w-0">
        <label className="label" htmlFor="sf-studio">
          Studio
        </label>
        <select
          id="sf-studio"
          className="input min-w-0 max-w-full"
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

      <div className="min-w-0">
        <label className="label" htmlFor="sf-date">
          Day
        </label>
        <input
          id="sf-date"
          type="date"
          className="input min-w-0 max-w-full"
          value={date ?? ""}
          onChange={(e) => apply("date", e.target.value)}
        />
      </div>

      <div className="min-w-0">
        <label className="label" htmlFor="sf-type">
          Class
        </label>
        <select
          id="sf-type"
          className="input min-w-0 max-w-full"
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

      <div className="min-w-0 sm:col-span-2 xl:col-span-1">
        <label className="label" htmlFor="sf-q">
          Search
        </label>
        {/* Uncontrolled so typing doesn't navigate; the key remounts it when the
            URL changes so the box always reflects the applied search. */}
        <input
          id="sf-q"
          key={q ?? ""}
          type="search"
          className="input min-w-0 max-w-full"
          placeholder="Search classes…"
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
        <a href="/admin/sessions" className="btn-secondary w-full sm:col-span-2 xl:col-span-4 xl:w-auto xl:justify-self-start">
          Clear
        </a>
      )}
    </div>
  );
}
