// ============================================================================
// Admin · Payments — record a retail sale
//
// Rings up products at the counter. A sale never touches credit_ledger: retail
// goods grant no credits, so they live in sales/sale_items (0008) instead.
//
// Prices are re-read from the products table server-side rather than trusted
// from the form, then copied onto each sale_items row. That copy is the whole
// point — re-pricing a product later must not rewrite past takings.
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Product } from "@/lib/types";

export type SaleActionState = { error?: string; ok?: boolean };

const saleSchema = z.object({
  customer_id: z.string().uuid().optional().or(z.literal("")),
  studio_id: z.string().uuid().optional().or(z.literal("")),
  payment_method: z.enum(["qr", "card", "cash"]).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

// Lines arrive as parallel repeated fields: product_id[i] pairs with qty[i].
// A qty of 0 means the admin left that product alone, so we drop it.
function parseLines(formData: FormData) {
  const ids = formData.getAll("product_id").map(String);
  const qtys = formData.getAll("qty").map((q) => Number(q));

  return ids
    .map((product_id, i) => ({ product_id, qty: qtys[i] ?? 0 }))
    .filter((line) => line.product_id && Number.isInteger(line.qty) && line.qty > 0);
}

export async function recordSaleAction(
  _prev: SaleActionState,
  formData: FormData,
): Promise<SaleActionState> {
  const profile = await requireRole("admin", "/admin/payments");

  const parsed = saleSchema.safeParse({
    customer_id: formData.get("customer_id"),
    studio_id: formData.get("studio_id"),
    payment_method: formData.get("payment_method"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const lines = parseLines(formData);
  if (lines.length === 0) {
    return { error: "Add at least one item with a quantity." };
  }

  const supabase = await createClient();

  // Snapshot source: the current price list, not whatever the browser sent.
  const { data: productData, error: productError } = await supabase
    .from("products")
    .select("*")
    .in(
      "id",
      lines.map((l) => l.product_id),
    );

  if (productError) return { error: productError.message };

  const products = new Map(
    ((productData ?? []) as Product[]).map((p) => [p.id, p]),
  );
  if (products.size !== lines.length) {
    return { error: "One of those products no longer exists." };
  }

  const items = lines.map((line) => {
    const product = products.get(line.product_id)!;
    return {
      product_id: product.id,
      name: product.name,
      unit_price_cents: product.price_cents,
      qty: line.qty,
      line_total_cents: product.price_cents * line.qty,
    };
  });

  // Totals only mean anything within one currency, and the aside on this page
  // sums a single figure — so refuse a mixed-currency basket rather than
  // silently adding VND to USD.
  const currencies = new Set(items.map((i) => products.get(i.product_id)!.currency));
  if (currencies.size > 1) {
    return { error: "All items in one sale must share a currency." };
  }

  const { customer_id, studio_id, payment_method, notes } = parsed.data;

  const { data: sale, error: saleError } = await supabase
    .from("sales")
    .insert({
      customer_id: customer_id || null,
      studio_id: studio_id || null,
      total_cents: items.reduce((sum, i) => sum + i.line_total_cents, 0),
      currency: [...currencies][0],
      payment_method: payment_method || null,
      notes: notes || null,
      sold_by: profile.id,
    })
    .select("id")
    .single();

  if (saleError) return { error: saleError.message };

  const { error: itemsError } = await supabase
    .from("sale_items")
    .insert(items.map((item) => ({ ...item, sale_id: sale.id })));

  // No transaction across two inserts, so undo the header rather than leave a
  // sale whose total is backed by no lines.
  if (itemsError) {
    await supabase.from("sales").delete().eq("id", sale.id);
    return { error: itemsError.message };
  }

  revalidatePath("/admin/payments");
  return { ok: true };
}
