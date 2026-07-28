// ============================================================================
// SessionFilters — studio / day / class filters for the sessions list that
// apply automatically on change (no "Filter" button to press). Navigates with
// updated query params; the server page re-renders the filtered list.
// ============================================================================
"use client";

import { useRouter } from "next/navigation";

type Opt = { id: string; name: string };

export function SessionFilters({
  studios,
  classTypes,
  studio,
  type,
  date,
}: {
  studios: Opt[];
  classTypes: Opt[];
  studio?: string;
  type?: string;
  date?: string;
}) {
  const router = useRouter();
  const hasFilters = Boolean(studio || type || date);

  function apply(key: "studio" | "type" | "date", value: string) {
    const params = new URLSearchParams();
    const next = { studio, type, date, [key]: value };
    if (next.studio) params.set("studio", next.studio);
    if (next.type) params.set("type", next.type);
    if (next.date) params.set("date", next.date);
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
      {hasFilters && (
        <a href="/admin/sessions" className="btn-secondary">
          Clear
        </a>
      )}
    </div>
  );
}
