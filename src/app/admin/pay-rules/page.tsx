// ============================================================================
// Admin · Pay rules
//
// Where the admin answers the core payroll question for every instructor:
// "for THIS instructor, at THIS studio, for (optionally) THIS class type, how
// much do they earn when 1, 2, 3, or 4+ students show up?" Each rule stores the
// four per-headcount amounts as the `tiered` bands compute_pay() walks, and
// resolve_pay_rule() later picks the most specific active rule (instructor +
// class_type + studio, priority desc) when a session is recalculated.
//
// Mirrors the admin Sessions page: a Promise.all fan-out for the rules plus the
// option lists the form/rows need, then a list + sticky "new rule" sidebar. We
// resolve each rule's studio / instructor / class-type NAME here (via lookup
// maps) so the row can render a human label without its own round-trip.
// ============================================================================
import { createClient } from "@/lib/supabase/server";
import type { PayRule } from "@/lib/types";
import { PayRuleRow } from "./PayRuleRow";
import {
  PayRuleForm,
  type StudioOption,
  type InstructorOption,
  type ClassTypeOption,
} from "./PayRuleForm";

export const dynamic = "force-dynamic";

export default async function PayRulesPage() {
  const supabase = await createClient();

  const [rulesRes, studiosRes, instructorsRes, classTypesRes] =
    await Promise.all([
      supabase
        .from("pay_rules")
        .select("*")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("studios")
        .select("id,name")
        .eq("active", true)
        .order("name", { ascending: true }),
      supabase
        .from("instructors")
        .select("id,display_name")
        .eq("active", true)
        .order("display_name", { ascending: true }),
      supabase
        .from("class_types")
        .select("id,name")
        .eq("active", true)
        .order("name", { ascending: true }),
    ]);

  const rules = (rulesRes.data ?? []) as PayRule[];
  const studios = (studiosRes.data ?? []) as StudioOption[];
  const instructors = (instructorsRes.data ?? []) as InstructorOption[];
  const classTypes = (classTypesRes.data ?? []) as ClassTypeOption[];

  // Lookup maps so each row can show a name instead of a uuid. A rule with a
  // null foreign key means "applies to all" on that axis, so we leave the name
  // null and let the row render its own fallback ("Any instructor" / "All
  // class types").
  const studioById = new Map(studios.map((s) => [s.id, s.name]));
  const instructorById = new Map(instructors.map((i) => [i.id, i.display_name]));
  const classTypeById = new Map(classTypes.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Pay rules
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Set what each instructor earns at a studio by how many students show
          up — a rate for 1, 2, 3, and 4+ in class. When a session is recomputed,
          the most specific active rule wins.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          {rules.length === 0 ? (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              No pay rules yet. Author your first per-headcount rate with the
              form.
            </div>
          ) : (
            <ul className="space-y-3">
              {rules.map((rule) => (
                <PayRuleRow
                  key={rule.id}
                  rule={rule}
                  studios={studios}
                  instructors={instructors}
                  classTypes={classTypes}
                  studioName={
                    rule.studio_id
                      ? studioById.get(rule.studio_id) ?? null
                      : null
                  }
                  instructorName={
                    rule.instructor_id
                      ? instructorById.get(rule.instructor_id) ?? null
                      : null
                  }
                  classTypeName={
                    rule.class_type_id
                      ? classTypeById.get(rule.class_type_id) ?? null
                      : null
                  }
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="lg:col-span-1">
          <div className="card p-4 sm:p-5 lg:sticky lg:top-24">
            <h2 className="mb-4 text-sm font-semibold text-ink">New pay rule</h2>
            <PayRuleForm
              studios={studios}
              instructors={instructors}
              classTypes={classTypes}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
