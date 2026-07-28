// ============================================================================
// Admin · Schedule a private class
//
// The dedicated 1:1 booking surface reached from the Overview's "Schedule a
// class" button. The admin picks a customer, a studio, a private class type, a
// time, an instructor, and the instructor's pay for that class. On submit it
// creates the session (assigned to the instructor, so it lands on their
// schedule), reserves the customer's seat, and records the pay for them to
// confirm — no message is sent.
// ============================================================================
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  PrivateClassForm,
  type StudioOption,
  type ClassTypeOption,
  type InstructorOption,
} from "./PrivateClassForm";

export const dynamic = "force-dynamic";

export default async function NewPrivateClassPage() {
  await requireRole("admin", "/admin/sessions/new");
  const supabase = await createClient();

  const [{ data: studioData }, { data: classTypeData }, { data: instructorData }] =
    await Promise.all([
      supabase
        .from("studios")
        .select("id, name, timezone")
        .eq("active", true)
        .order("name", { ascending: true }),
      supabase
        .from("class_types")
        .select("id, name, default_duration_min")
        .eq("active", true)
        .eq("pool", "private")
        .order("name", { ascending: true }),
      supabase
        .from("instructors")
        .select("id, display_name")
        .eq("active", true)
        .order("display_name", { ascending: true }),
    ]);

  const studios = (studioData ?? []) as StudioOption[];
  const classTypes = (classTypeData ?? []) as ClassTypeOption[];
  const instructors = (instructorData ?? []) as InstructorOption[];

  return (
    <div className="space-y-8">
      <header>
        <Link
          href="/admin/sessions"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← All sessions
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          Schedule a private class
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Book a customer into a 1:1 private session, assign an instructor, and
          set their pay for the class. The instructor sees it on their schedule
          straight away.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="card p-5">
            {classTypes.length === 0 ? (
              <div className="text-sm text-ink-muted">
                You don&rsquo;t have a private class type yet. Create one (with
                its pool set to private) on the{" "}
                <Link
                  href="/admin/class-types"
                  className="font-medium text-brand-600 hover:text-brand-700"
                >
                  Class types
                </Link>{" "}
                page first, then come back here.
              </div>
            ) : studios.length === 0 || instructors.length === 0 ? (
              <div className="text-sm text-ink-muted">
                You need at least one active studio and one active instructor
                before scheduling a private class.
              </div>
            ) : (
              <PrivateClassForm
                studios={studios}
                classTypes={classTypes}
                instructors={instructors}
              />
            )}
          </div>
        </section>

        <aside className="lg:col-span-1">
          <div className="card sticky top-24 p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">How it works</h2>
            <ol className="space-y-3 text-sm text-ink-muted">
              <li>
                <span className="font-medium text-ink">1. Pick the customer.</span>{" "}
                Search by name or phone and select an existing member.
              </li>
              <li>
                <span className="font-medium text-ink">2. Set the class.</span>{" "}
                Studio, private class type, date &amp; time, and the instructor.
              </li>
              <li>
                <span className="font-medium text-ink">3. Set the pay.</span> The
                amount the instructor earns for this class (VND).
              </li>
            </ol>
            <p className="mt-5 text-xs text-ink-soft">
              Booking deducts 1 private credit from the customer (add a private
              package to them first). The pay appears on the
              instructor&rsquo;s Salary page to confirm and in the admin pay run.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
