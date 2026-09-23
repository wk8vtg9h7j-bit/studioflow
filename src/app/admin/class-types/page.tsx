// ============================================================================
// Class types admin — the list of every class template plus an inline "add
// class type" form. Class types feed the "schedule a class" picker: each one
// carries a default length, capacity, credit cost and a colour for the
// schedule. Inactive types are hidden from booking but keep their history.
// ============================================================================
import { createClient } from "@/lib/supabase/server";
import type { ClassType } from "@/lib/types";
import { ClassTypeForm } from "./ClassTypeForm";
import { ClassTypeRow } from "./ClassTypeRow";

export default async function ClassTypesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("class_types")
    .select("*")
    .order("name", { ascending: true });

  const classTypes = (data ?? []) as ClassType[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Class types
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Templates a session is built from — they set the default length,
          capacity and credit cost. Inactive types stay out of the schedule
          picker but keep their history.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          {classTypes.length === 0 ? (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              No class types yet. Add your first one with the form.
            </div>
          ) : (
            <ul className="space-y-3">
              {classTypes.map((classType) => (
                <ClassTypeRow key={classType.id} classType={classType} />
              ))}
            </ul>
          )}
        </section>

        <aside className="lg:col-span-1">
          <div className="card p-4 sm:p-5 lg:sticky lg:top-24">
            <h2 className="mb-4 text-sm font-semibold text-ink">
              Add a class type
            </h2>
            <ClassTypeForm />
          </div>
        </aside>
      </div>
    </div>
  );
}
