// ============================================================================
// Sessions admin — the scheduled-class calendar list plus an inline "schedule a
// class" form. A session pins a class type to a studio at a wall-clock time,
// with an optional instructor, room and capacity. The list and the form both
// need the same option arrays (studios, class types, instructors), so we fetch
// them once here and hand them to every row as well as the sidebar form.
//
// Only active studios/class types/instructors are offered for new sessions, but
// existing sessions still render their relations even if those have since been
// deactivated (the joins below are independent of the active filters).
// ============================================================================
import { createClient } from "@/lib/supabase/server";
import type { SessionWithRelations } from "@/lib/types";
import { SessionForm } from "./SessionForm";
import type {
  StudioOption,
  ClassTypeOption,
  InstructorOption,
} from "./SessionForm";
import { SessionRow } from "./SessionRow";

export default async function SessionsPage() {
  const supabase = await createClient();

  const [sessionsRes, studiosRes, classTypesRes, instructorsRes] =
    await Promise.all([
      supabase
        .from("sessions")
        .select(
          "*, studio:studios(id,name,slug,brand_color,timezone), class_type:class_types(id,name,color,credits_cost), instructor:instructors(id,display_name)",
        )
        .order("starts_at", { ascending: true }),
      supabase
        .from("studios")
        .select("id,name,timezone")
        .eq("active", true)
        .order("name", { ascending: true }),
      supabase
        .from("class_types")
        .select("id,name,default_duration_min,default_capacity,credits_cost")
        .eq("active", true)
        .order("name", { ascending: true }),
      supabase
        .from("instructors")
        .select("id,display_name")
        .eq("active", true)
        .order("display_name", { ascending: true }),
    ]);

  const sessions = (sessionsRes.data ?? []) as SessionWithRelations[];
  const studios = (studiosRes.data ?? []) as StudioOption[];
  const classTypes = (classTypesRes.data ?? []) as ClassTypeOption[];
  const instructors = (instructorsRes.data ?? []) as InstructorOption[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Sessions
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Scheduled classes customers can book. Times are shown in each
          studio&apos;s own timezone. Cancelling keeps a session for history but
          hides it from booking.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          {sessions.length === 0 ? (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              No sessions yet. Schedule your first class with the form.
            </div>
          ) : (
            <ul className="space-y-3">
              {sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  studios={studios}
                  classTypes={classTypes}
                  instructors={instructors}
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="lg:col-span-1">
          <div className="card sticky top-24 p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">
              Schedule a class
            </h2>
            <SessionForm
              studios={studios}
              classTypes={classTypes}
              instructors={instructors}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
