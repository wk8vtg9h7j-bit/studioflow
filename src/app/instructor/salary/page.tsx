// ============================================================================
// Instructor · Salary
//
// The instructor's own pay run. This mirrors the admin payroll page, but it is
// read-mostly: the only write an instructor owns is confirming their own count
// (pending → instructor_confirmed), which lives inline on each SalaryRow.
//
// The list is RLS-scoped: the "instructors read own payroll" policy means this
// query only ever returns session_payroll rows where instructor_id =
// my_instructor_id(). We still resolve the instructor id explicitly so an
// unlinked profile degrades to an empty list rather than erroring.
//
// Pay amounts are numeric(10,2) DECIMALS (e.g. 25.00), so totals are summed as
// plain numbers and formatted with Intl.NumberFormat — never the /100
// formatMoney helper.
// ============================================================================
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SalaryRow, type SalaryListRow } from "./SalaryRow";

export const dynamic = "force-dynamic";

export default async function InstructorSalaryPage() {
  const profile = await requireRole("instructor", "/instructor/salary");
  const supabase = await createClient();

  // Resolve the signed-in instructor. An admin viewing the portal, or a profile
  // not yet linked to an instructor row, simply has no salary here.
  const { data: instructor } = await supabase
    .from("instructors")
    .select("id")
    .eq("profile_id", profile.id)
    .single();

  const { data } = instructor
    ? await supabase
        .from("session_payroll")
        .select(
          `id, session_id, attendance_count, computed_amount, currency, status,
           instructor_confirmed_at, admin_approved_at, paid_at,
           session:sessions(
             title, starts_at,
             studio:studios(name, timezone),
             class_type:class_types(name)
           )`,
        )
        .eq("instructor_id", instructor.id)
        .order("created_at", { ascending: false })
    : { data: [] };

  const rows = (data ?? []) as unknown as SalaryListRow[];

  // Totals from the instructor's point of view. "Owed" is everything not yet
  // paid and not in dispute; "paid" is settled. "To confirm" nudges them toward
  // the rows still waiting on their sign-off. Currency is read off the first row.
  const currency = rows[0]?.currency ?? "GBP";
  const totals = rows.reduce(
    (acc, r) => {
      const amount = r.computed_amount ?? 0;
      if (r.status === "paid") acc.paid += amount;
      else if (r.status !== "disputed") acc.owed += amount;

      if (r.status === "pending") acc.toConfirm += 1;
      return acc;
    },
    { owed: 0, paid: 0, toConfirm: 0 },
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Salary</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your pay per session, computed from the attendance you taught. Confirm
          a pending row to stand behind its headcount — the admin reviews and
          approves it next.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          {rows.length > 0 ? (
            <ul className="space-y-3">
              {rows.map((row) => (
                <SalaryRow key={row.id} row={row} />
              ))}
            </ul>
          ) : (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              No salary records yet. Once a class you taught is recomputed, its
              pay appears here for you to confirm.
            </div>
          )}
        </section>

        <aside className="lg:col-span-1">
          <div className="card sticky top-24 p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">At a glance</h2>
            <dl className="space-y-3">
              <SummaryStat label="Owed" value={formatTotal(totals.owed, currency)} />
              <SummaryStat label="Paid" value={formatTotal(totals.paid, currency)} />
              <SummaryStat label="To confirm" value={totals.toConfirm} />
            </dl>

            <p className="mt-5 text-xs text-ink-soft">
              &ldquo;Owed&rdquo; counts every record not yet paid and not in
              dispute. Confirming a row doesn&rsquo;t change the amount — it tells
              the admin you stand behind the headcount.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

function formatTotal(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "GBP",
    }).format(amount ?? 0);
  } catch {
    return `${(amount ?? 0).toFixed(2)} ${currency || "GBP"}`;
  }
}
