// ============================================================================
// Admin · Packages (clip-cards) — CRUD actions
//
// A "package" is a clip-card: a customer buys N credits (clips) that expire
// after `validity_days`. The credits themselves live in credit_ledger; this
// file just authors the package CATALOG (name, credits, price, validity). The
// actual grant of credits to a customer is handled by grantPackageAction on the
// admin customers page.
//
// Mirrors admin/class-types/actions.ts: zod-validated create/update in the
// useFormState shape, plus a plain toggle-active action (packages are
// referenced by credit_ledger, so we soft-disable instead of delete).
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type PackageActionState = { error?: string; ok?: boolean };

const packageSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  credits: z.coerce
    .number()
    .int("Credits must be a whole number")
    .min(1, "A package must include at least 1 credit")
    .max(1000),
  price_cents: z.coerce
    .number()
    .int("Price must be a whole number of minor units")
    .min(0, "Price cannot be negative")
    .max(100_000_000),
  currency: z.string().trim().min(3).max(3).toUpperCase(),
  validity_days: z.coerce
    .number()
    .int("Validity must be a whole number of days")
    .min(1, "Validity must be at least 1 day")
    .max(3650),
  pool: z.enum(["regular", "private"], {
    errorMap: () => ({ message: "Choose regular or private credits." }),
  }),
});

function parseForm(formData: FormData) {
  return packageSchema.safeParse({
    id: (formData.get("id") as string) || undefined,
    name: formData.get("name"),
    description: formData.get("description"),
    credits: formData.get("credits"),
    price_cents: formData.get("price_cents"),
    currency: formData.get("currency"),
    validity_days: formData.get("validity_days"),
    pool: formData.get("pool"),
  });
}

export async function createPackageAction(
  _prev: PackageActionState,
  formData: FormData,
): Promise<PackageActionState> {
  await requireRole("admin", "/admin/packages");

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { id: _ignore, description, ...fields } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("packages").insert({
    ...fields,
    description: description || null,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "A package with that name already exists." };
    }
    return { error: error.message };
  }

  revalidatePath("/admin/packages");
  return { ok: true };
}

export async function updatePackageAction(
  _prev: PackageActionState,
  formData: FormData,
): Promise<PackageActionState> {
  await requireRole("admin", "/admin/packages");

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (!parsed.data.id) {
    return { error: "Missing package id" };
  }

  const { id, description, ...fields } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("packages")
    .update({ ...fields, description: description || null })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return { error: "A package with that name already exists." };
    }
    return { error: error.message };
  }

  revalidatePath("/admin/packages");
  return { ok: true };
}

export async function togglePackageActiveAction(formData: FormData) {
  await requireRole("admin", "/admin/packages");

  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const active = String(formData.get("active") ?? "") === "true";

  const supabase = await createClient();
  await supabase.from("packages").update({ active }).eq("id", id);

  revalidatePath("/admin/packages");
}
