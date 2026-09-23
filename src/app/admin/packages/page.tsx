// ============================================================================
// Admin · Packages (clip-cards)
//
// The catalog of clip-cards the studio sells: each package grants N credits
// (clips) that expire after `validity_days`. Customers spend those clips when
// they book a session (book_session deducts from credit_ledger); admins author
// the catalog here and then GRANT a package to a specific customer from the
// Customers page.
//
// Mirrors the admin Pay rules page: a list of existing packages on the left and
// a sticky "new package" form on the right. Packages are referenced by
// credit_ledger, so rows soft-disable instead of delete.
// ============================================================================
import { createClient } from "@/lib/supabase/server";
import type { Package } from "@/lib/types";
import { PackageRow } from "./PackageRow";
import { PackageForm } from "./PackageForm";

export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("packages")
    .select("*")
    .order("active", { ascending: false })
    .order("price_cents", { ascending: true });

  const packages = (data ?? []) as Package[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Packages
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Author the clip-cards customers can buy — how many credits each grants,
          its price, and how long the clips stay valid. Grant a package to a
          customer from their profile on the Customers page.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          {packages.length === 0 ? (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              No packages yet. Create your first clip-card with the form.
            </div>
          ) : (
            <ul className="space-y-3">
              {packages.map((pkg) => (
                <PackageRow key={pkg.id} pkg={pkg} />
              ))}
            </ul>
          )}
        </section>

        <aside className="lg:col-span-1">
          <div className="card p-4 sm:p-5 lg:sticky lg:top-24">
            <h2 className="mb-4 text-sm font-semibold text-ink">New package</h2>
            <PackageForm />
          </div>
        </aside>
      </div>
    </div>
  );
}
