// ============================================================================
// CustomerFilters — search + status filter bar for the admin customer book.
//
// Filtering happens server-side in page.tsx over the already-fetched array
// (the searchable fields live on the embedded profiles relation, which
// PostgREST cannot filter without an !inner join that would drop walk-ins).
// This component only drives the URL; the page reads searchParams.
// ============================================================================
"use client";

import { useRouter } from "next/navigation";

const KEYS = ["q", "status"] as const;
type FilterKey = (typeof KEYS)[number];

export function CustomerFilters({
  q,
  status,
}: {
  q?: string;
  status?: string;
}) {
  const router = useRouter();
  const hasFilters = Boolean(q || status);

  function apply(key: FilterKey, value: string) {
    const next: Record<FilterKey, string | undefined> = { q, status };
    next[key] = value;

    const params = new URLSearchParams();
    for (const k of KEYS) {
      const v = next[k];
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    router.push(qs ? `/admin/customers?${qs}` : "/admin/customers");
  }

  return (
    <div className="card flex flex-wrap items-end gap-3 p-4">
      <div className="min-w-[220px] flex-1">
        <label className="label" htmlFor="cf-q">
          Search
        </label>
        <input
          id="cf-q"
          key={q ?? ""}
          type="search"
          className="input"
          placeholder="Name, email, or phone"
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

      <div>
        <label className="label" htmlFor="cf-status">
          Status
        </label>
        <select
          id="cf-status"
          className="input"
          value={status ?? ""}
          onChange={(e) => apply("status", e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="lead">Lead</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {hasFilters && (
        <a href="/admin/customers" className="btn-secondary">
          Clear
        </a>
      )}
    </div>
  );
}
