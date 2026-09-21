// ============================================================================
// Admin · Products (retail goods) — CRUD actions
//
// A "product" is something sold over the counter: socks, grip gloves, water,
// merch. Unlike a package it grants no credits, so it never touches
// credit_ledger — sales are recorded in sales/sale_items (0008).
//
// Mirrors admin/packages/actions.ts: zod-validated create/update in the
// useFormState shape, plus a plain toggle-active action (products are
// referenced by sale_items, so we soft-disable instead of delete).
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ProductActionState = { error?: string; ok?: boolean };

const productSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  sku: z.string().trim().max(60).optional().or(z.literal("")),
  price_cents: z.coerce
    .number()
    .int("Price must be a whole number of minor units")
    .min(0, "Price cannot be negative")
    .max(100_000_000),
  currency: z.string().trim().min(3).max(3).toUpperCase(),
});

function parseForm(formData: FormData) {
  return productSchema.safeParse({
    id: (formData.get("id") as string) || undefined,
    name: formData.get("name"),
    description: formData.get("description"),
    sku: formData.get("sku"),
    price_cents: formData.get("price_cents"),
    currency: formData.get("currency"),
  });
}

export async function createProductAction(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  await requireRole("admin", "/admin/products");

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { id: _ignore, description, sku, ...fields } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("products").insert({
    ...fields,
    description: description || null,
    sku: sku || null,
  });

  if (error) return { error: error.message };

  revalidatePath("/admin/products");
  return { ok: true };
}

export async function updateProductAction(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  await requireRole("admin", "/admin/products");

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (!parsed.data.id) {
    return { error: "Missing product id" };
  }

  const { id, description, sku, ...fields } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({
      ...fields,
      description: description || null,
      sku: sku || null,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/admin/products");
  return { ok: true };
}

export async function toggleProductActiveAction(formData: FormData) {
  await requireRole("admin", "/admin/products");

  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const active = String(formData.get("active") ?? "") === "true";

  const supabase = await createClient();
  await supabase.from("products").update({ active }).eq("id", id);

  revalidatePath("/admin/products");
}
