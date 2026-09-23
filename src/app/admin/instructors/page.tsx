// ============================================================================
// Instructors admin — the list of every teacher who logs in to confirm their
// classes and salary, plus an inline "add instructor" form. Each instructor is
// backed by an auth user + profile (role = 'instructor'); the login email comes
// from that joined profile and is shown for reference. Inactive instructors
// drop out of the "assign an instructor" pickers but keep their history.
// ============================================================================
import { createClient } from "@/lib/supabase/server";
import type { Instructor, Profile } from "@/lib/types";
import { InstructorForm } from "./InstructorForm";
import { InstructorRow } from "./InstructorRow";

type InstructorWithProfile = Instructor & {
  profile?: Pick<Profile, "email" | "full_name"> | null;
};

export default async function InstructorsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("instructors")
    .select("*, profile:profiles(email, full_name)")
    .order("display_name", { ascending: true });

  const instructors = (data ?? []) as InstructorWithProfile[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Instructors
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Teachers who log in to confirm their classes and salary. Adding one
          creates their login account; deactivating keeps their history but
          hides them from the &ldquo;assign an instructor&rdquo; pickers.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          {instructors.length === 0 ? (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              No instructors yet. Add your first one with the form.
            </div>
          ) : (
            <ul className="space-y-3">
              {instructors.map((instructor) => (
                <InstructorRow
                  key={instructor.id}
                  instructor={instructor}
                  email={instructor.profile?.email}
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="lg:col-span-1">
          <div className="card p-4 sm:p-5 lg:sticky lg:top-24">
            <h2 className="mb-4 text-sm font-semibold text-ink">
              Add an instructor
            </h2>
            <InstructorForm />
          </div>
        </aside>
      </div>
    </div>
  );
}
