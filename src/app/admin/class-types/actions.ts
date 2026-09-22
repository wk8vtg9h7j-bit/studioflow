// ============================================================================
// Server actions for the Class types section. Class types are the templates a
// session is built from — they carry the default length, capacity, credit cost
// and a colour used to tint the schedule. Each action re-checks the admin role
// (RLS guards the table too) and revalidates the list.
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const ClassTypeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  default_duration_min: z.coerce
    .number()
    .int("Duration must be a whole number of minutes")
    .min(5, "Duration must be at least 5 minutes")
    .max(480, "Duration looks too long"),
  default_capacity: z.coerce
    .number()
    .int("Capacity must be a whole number")
    .min(1, "Capacity must be at least 1")
    .max(200, "Capacity looks too high"),
  credits_cost: z.coerce
    .number()
    .int("Credit cost must be a whole number")
    .min(0, "Credit cost can't be negative")
    .max(100, "Credit cost looks too high"),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #0ea5e9")
    .optional()
    .or(z.literal("")),
  pool: z.enum(["regular", "private"], {
    errorMap: () => ({ message: "Choose regular or private credits." }),
  }),
});

export type ClassTypeActionState = { error?: string; ok?: boolean };

function parseForm(formData: FormData) {
  return ClassTypeSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    default_duration_min: formData.get("default_duration_min"),
    default_capacity: formData.get("default_capacity"),
    credits_cost: formData.get("credits_cost"),
    color: formData.get("color"),
    pool: formData.get("pool"),
  });
}

export async function createClassTypeAction(
  _prev: ClassTypeActionState,
  formData: FormData,
): Promise<ClassTypeActionState> {
  await requireRole("admin", "/admin/class-types");

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("class_types").insert({
    name: parsed.data.name,
    description: parsed.data.description || null,
    default_duration_min: parsed.data.default_duration_min,
    default_capacity: parsed.data.default_capacity,
    credits_cost: parsed.data.credits_cost,
    color: parsed.data.color || "#0ea5e9",
    pool: parsed.data.pool,
    active: true,
  });

  if (error) {
    return {
      error:
        error.code === "23505"
          ? "A class type with that name already exists."
          : error.message,
    };
  }

  revalidatePath("/admin/class-types");
  return { ok: true };
}

export async function updateClassTypeAction(
  _prev: ClassTypeActionState,
  formData: FormData,
): Promise<ClassTypeActionState> {
  await requireRole("admin", "/admin/class-types");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing class type id" };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("class_types")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
      default_duration_min: parsed.data.default_duration_min,
      default_capacity: parsed.data.default_capacity,
      credits_cost: parsed.data.credits_cost,
      color: parsed.data.color || "#0ea5e9",
      pool: parsed.data.pool,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/admin/class-types");
  return { ok: true };
}

// Soft on/off switch — class types are referenced by sessions and pay rules, so
// we toggle `active` rather than deleting. Inactive types stay out of the
// "schedule a class" picker but keep their history intact.
export async function toggleClassTypeActiveAction(formData: FormData) {
  await requireRole("admin", "/admin/class-types");

  const id = String(formData.get("id") ?? "");
  const next = String(formData.get("active") ?? "") === "true";
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("class_types").update({ active: next }).eq("id", id);
  revalidatePath("/admin/class-types");
}
