// ============================================================================
// Auth server actions — sign in, sign up, and sign out. Each returns a typed
// result the client form can render; success paths redirect by role.
// ============================================================================
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile, homePathForRole } from "@/lib/auth";
import { PREVIEW_MODE, PREVIEW_COOKIE } from "@/lib/preview";

export type AuthState = { error: string | null };

// Only allow relative, same-origin paths as post-login redirect targets so a
// crafted `next` value can't bounce the user to another site.
function safeNext(next: FormDataEntryValue | null): string | null {
  if (typeof next !== "string") return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

const credentials = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const signUpSchema = credentials.extend({
  fullName: z.string().trim().min(1, "Enter your name."),
});

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: "Email or password is incorrect." };
  }

  const next = safeNext(formData.get("next"));
  const profile = await getProfile();
  revalidatePath("/", "layout");
  redirect(next ?? (profile ? homePathForRole(profile.role) : "/dashboard"));
}

export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details." };
  }

  const supabase = await createClient();
  // New public sign-ups are always customers; the `handle_new_user` trigger
  // reads this metadata to stamp the profile role.
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName, role: "customer" },
    },
  });
  if (error) {
    return { error: error.message };
  }

  // If email confirmation is on, there's no session yet — tell the user.
  if (!data.session) {
    return {
      error:
        "Check your inbox to confirm your email, then log in to start booking.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/book");
}

export async function signOutAction(): Promise<void> {
  // Preview mode: clearing the role cookie is the whole "sign out". Without this
  // the middleware would keep treating the user as authed and loop them back
  // out of /login into /dashboard.
  if (PREVIEW_MODE) {
    const cookieStore = await cookies();
    cookieStore.delete(PREVIEW_COOKIE);
    revalidatePath("/", "layout");
    redirect("/login");
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
