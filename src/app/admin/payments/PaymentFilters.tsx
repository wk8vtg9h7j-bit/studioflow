// ============================================================================
// PaymentFilters — month picker for the daily payments sheet.
//
// Filtering happens server-side in page.tsx over the already-grouped days; this
// component only drives the URL (?month=yyyy-MM) and the page reads searchParams.
// The month options are the months that actually have takings, newest first.
// ============================================================================
"use client";

import { useRouter } from "next/navigation";

export type MonthOption = { value: string; label: string };

export function PaymentFilters({
  month,
  months,
}: {
  month?: string;
  months: MonthOption[];
}) {
  const router = useRouter();

  function apply(value: string) {
    const params = new URLSearchParams();
    if (value) params.set("month", value);
    const qs = params.toString();
    router.push(qs ? `/admin/payments?${qs}` : "/admin/payments");
  }

  return (
    <div className="card flex flex-wrap items-end gap-3 p-4">
      <div className="min-w-[200px]">
        <label className="label" htmlFor="pf-month">
          Month
        </label>
        <select
          id="pf-month"
          className="input"
          value={month ?? ""}
          onChange={(e) => apply(e.target.value)}
        >
          <option value="">All time</option>
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {month && (
        <a href="/admin/payments" className="btn-secondary">
          Clear
        </a>
      )}
    </div>
  );
}
