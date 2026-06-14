// ============================================================================
// Studios admin — the list of every studio plus an inline "add studio" form.
// Studios are the spine of the app: sessions, pay rules, and the per-studio
// Google calendars all hang off them, so this page leads the admin CRM.
// ============================================================================
import { createClient } from "@/lib/supabase/server";
import type { Studio } from "@/lib/types";
import { StudioForm } from "./StudioForm";
import { StudioRow } from "./StudioRow";

export default async function StudiosPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("studios")
    .select("*")
    .order("name", { ascending: true });

  const studios = (data ?? []) as Studio[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Studios
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Each studio has its own timezone, brand colour, and Google calendar.
          Inactive studios are hidden from booking but keep their history.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          {studios.length === 0 ? (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              No studios yet. Add your first one with the form.
            </div>
          ) : (
            <ul className="space-y-3">
              {studios.map((studio) => (
                <StudioRow key={studio.id} studio={studio} />
              ))}
            </ul>
          )}
        </section>

        <aside className="lg:col-span-1">
          <div className="card sticky top-24 p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">
              Add a studio
            </h2>
            <StudioForm />
          </div>
        </aside>
      </div>
    </div>
  );
}
