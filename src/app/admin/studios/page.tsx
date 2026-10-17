// ============================================================================
// Studios admin — the list of every studio plus an inline "add studio" form.
// Studios are the spine of the app: sessions, pay rules, and the per-studio
// Google calendars all hang off them, so this page leads the admin CRM.
// ============================================================================
import { createClient } from "@/lib/supabase/server";
import type { Studio } from "@/lib/types";
import Link from "next/link";
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
    <div className="space-y-8"><div className="flex flex-wrap gap-3"><Link className="btn-secondary" href="/admin/coaching">An Thuong private coaching →</Link><Link className="btn-secondary" href="/admin/studio-images">Studio photos →</Link><Link className="btn-secondary" href="/admin/studio-images/gallery">Photo galleries →</Link></div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Studios
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Each studio has its own timezone, brand colour, and Google calendar.
          Inactive studios are hidden from booking but keep their history.
        </p>
      </div>

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">PRIVATE STUDIO · AN THUONG</p><h2 className="mt-2 text-xl font-semibold text-emerald-950">An Thuong · Private Pilates</h2><p className="mt-2 max-w-lg text-sm text-emerald-900">A separate studio for private customers only. Instructors: Ruby & Violet. Manage individual clients, goals, programs, weekly progress and photos from here.</p></div><div className="flex flex-col gap-2"><Link href="/admin/coaching" className="btn-primary text-center">Open An Thuong coaching →</Link><Link href="/signup?studio=an-thuong-pilates" className="btn-secondary text-center">An Thuong customer signup →</Link></div></div></section>
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
          <div className="card p-4 sm:p-5 lg:sticky lg:top-24">
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
