// ============================================================================
// Server actions for the Studios section. Each one re-checks the admin role
// (defence in depth — RLS also guards the table) and revalidates the list.
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Turn "Sydney CBD" into "sydney-cbd" for a stable, URL-friendly slug.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const StudioSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  timezone: z.string().trim().min(1, "Timezone is required").max(80),
  brand_color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #7c3aed")
    .optional()
    .or(z.literal("")),
});

export type StudioActionState = { error?: string; ok?: boolean };

export async function createStudioAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  await requireRole("admin", "/admin/studios");

  const parsed = StudioSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address"),
    timezone: formData.get("timezone"),
    brand_color: formData.get("brand_color"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("studios").insert({
    name: parsed.data.name,
    slug: slugify(parsed.data.name),
    address: parsed.data.address || null,
    timezone: parsed.data.timezone,
    brand_color: parsed.data.brand_color || "#7c3aed",
    active: true,
  });

  if (error) {
    return {
      error:
        error.code === "23505"
          ? "A studio with that name already exists."
          : error.message,
    };
  }

  revalidatePath("/admin/studios");
  return { ok: true };
}

export async function updateStudioAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  await requireRole("admin", "/admin/studios");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing studio id" };

  const parsed = StudioSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address"),
    timezone: formData.get("timezone"),
    brand_color: formData.get("brand_color"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("studios")
    .update({
      name: parsed.data.name,
      address: parsed.data.address || null,
      timezone: parsed.data.timezone,
      brand_color: parsed.data.brand_color || "#7c3aed",
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/admin/studios");
  return { ok: true };
}

// Soft on/off switch — we never hard-delete a studio because sessions and
// payroll reference it. Toggling `active` hides it from booking flows instead.
export async function toggleStudioActiveAction(formData: FormData) {
  await requireRole("admin", "/admin/studios");

  const id = String(formData.get("id") ?? "");
  const next = String(formData.get("active") ?? "") === "true";
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("studios").update({ active: next }).eq("id", id);
  revalidatePath("/admin/studios");
}

// Disconnect Google Calendar for a studio: clear the stored token + calendar
// metadata and flip the status back to "disconnected". We do NOT revoke the
// token with Google here (the admin can do that from their Google account);
// dropping it locally is enough to stop sync and re-prompt consent next time.
export async function disconnectGoogleAction(formData: FormData) {
  await requireRole("admin", "/admin/studios");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("studios")
    .update({
      google_refresh_token: null,
      google_calendar_id: null,
      google_account_email: null,
      google_token_status: "disconnected",
      google_last_synced_at: null,
    })
    .eq("id", id);
  revalidatePath("/admin/studios");
}
