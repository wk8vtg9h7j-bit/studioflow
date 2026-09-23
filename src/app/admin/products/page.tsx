// ============================================================================
// Admin · Products (retail goods)
//
// The price list for things sold over the counter: socks, grip gloves, water,
// merch. Unlike packages these grant no credits — they are rung up on the
// Payments page, which records a row in sales/sale_items (0008) and never
// touches credit_ledger.
//
// Mirrors the admin Packages page: a list of existing products on the left and
// a sticky "new product" form on the right. Products are referenced by
// sale_items, so rows soft-disable instead of delete.
// ============================================================================
import { createClient } from "@/lib/supabase/server";
import type { Product } from "@/lib/types";
import { ProductRow } from "./ProductRow";
import { ProductForm } from "./ProductForm";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("products")
    .select("*")
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  const products = (data ?? []) as Product[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Products
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          The retail price list — socks, grip gloves, water, merch. Ring a sale
          up from the Payments page; the name and price are snapshotted at that
          moment, so editing a product here never rewrites past takings.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          {products.length === 0 ? (
            <div className="card px-5 py-12 text-center text-sm text-ink-muted">
              No products yet. Add your first retail item with the form.
            </div>
          ) : (
            <ul className="space-y-3">
              {products.map((product) => (
                <ProductRow key={product.id} product={product} />
              ))}
            </ul>
          )}
        </section>

        <aside className="lg:col-span-1">
          <div className="card p-4 sm:p-5 lg:sticky lg:top-24">
            <h2 className="mb-4 text-sm font-semibold text-ink">New product</h2>
            <ProductForm />
          </div>
        </aside>
      </div>
    </div>
  );
}
