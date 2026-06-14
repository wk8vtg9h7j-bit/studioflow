// ============================================================================
// Server actions for the Instructors section. An instructor is a teacher who
// logs in to confirm their classes and salary. Each instructor is backed by an
// auth user + a `profiles` row (role = 'instructor') and an `instructors` row
// that carries the display name and bio shown around the app.
//
// Creating an instructor needs the service-role client: we create the auth user
// (the handle_new_user trigger auto-creates the matching profile), then insert
// the instructors row referencing that profile. Editing and the active on/off
// switch run as the signed-in admin (RLS permits admins to manage the table).
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const InstructorSchema = z.object({
  display_name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Enter a valid email address").max(200),
  bio: z.string().trim().max(500).optional().or(z.literal("")),
});

// Edits don't touch the auth user, so the email field isn't required there.
const InstructorEditSchema = InstructorSchema.omit({ email: true });

export type InstructorActionState = { error?: string; ok?: boolean };

export async function createInstructorAction(
  _prev: InstructorActionState,
  formData: FormData,
): Promise<InstructorActionState> {
  await requireRole("admin", "/admin/instructors");

  const parsed = InstructorSchema.safeParse({
    display_name: formData.get("display_name"),
    email: formData.get("email"),
    bio: formData.get("bio"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { display_name, email, bio } = parsed.data;
  const admin = createServiceClient();

  // 1. Create the auth user. The handle_new_user trigger reads this metadata
  //    and synchronously inserts a profiles row with role = 'instructor'.
  const { data: created, error: authError } =
    await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: display_name, role: "instructor" },
    });

  if (authError || !created.user) {
    const message = authError?.message ?? "Could not create the instructor.";
    const alreadyExists = /already|registered|exists/i.test(message);
    return {
      error: alreadyExists
        ? "An account with that email already exists."
        : message,
    };
  }

  // 2. Insert the instructors row pointing at the freshly created profile.
  const { error: insertError } = await admin.from("instructors").insert({
    profile_id: created.user.id,
    display_name,
    bio: bio || null,
    active: true,
  });

  if (insertError) {
    // Roll back the half-created account so the admin can retry cleanly.
    await admin.auth.admin.deleteUser(created.user.id);
    return {
      error:
        insertError.code === "23505"
          ? "That instructor already exists."
          : insertError.message,
    };
  }

  revalidatePath("/admin/instructors");
  return { ok: true };
}

export async function updateInstructorAction(
  _prev: InstructorActionState,
  formData: FormData,
): Promise<InstructorActionState> {
  await requireRole("admin", "/admin/instructors");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing instructor id" };

  const parsed = InstructorEditSchema.safeParse({
    display_name: formData.get("display_name"),
    bio: formData.get("bio"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("instructors")
    .update({
      display_name: parsed.data.display_name,
      bio: parsed.data.bio || null,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/admin/instructors");
  return { ok: true };
}

// Soft on/off switch — instructors are referenced by sessions and payroll, so
// we toggle `active` rather than deleting. Inactive instructors stay out of the
// "assign an instructor" pickers but keep their history intact.
export async function toggleInstructorActiveAction(formData: FormData) {
  await requireRole("admin", "/admin/instructors");

  const id = String(formData.get("id") ?? "");
  const next = String(formData.get("active") ?? "") === "true";
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("instructors").update({ active: next }).eq("id", id);
  revalidatePath("/admin/instructors");
}
