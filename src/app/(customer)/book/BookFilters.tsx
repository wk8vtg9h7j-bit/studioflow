// ============================================================================
// BookFilters — studio / class filters for the booking page that apply
// automatically on change (no "Filter" button). The selected day is preserved.
// ============================================================================
"use client";

import { useRouter } from "next/navigation";

type Opt = { id: string; name: string };

export function BookFilters({
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
  date: string;
}) {
  const router = useRouter();
  const hasFilters = Boolean(studio || type);

  function apply(key: "studio" | "type", value: string) {
    const params = new URLSearchParams();
    params.set("date", date);
    const next = { studio, type, [key]: value };
    if (next.studio) params.set("studio", next.studio);
    if (next.type) params.set("type", next.type);
    router.push(`/book?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[9rem] flex-1">
        <label className="label" htmlFor="f-studio">
          Studio
        </label>
        <select
          id="f-studio"
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
        <label className="label" htmlFor="f-type">
          Class
        </label>
        <select
          id="f-type"
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
        <a href={`/book?date=${date}`} className="btn-ghost">
          Clear
        </a>
      )}
    </div>
  );
}
