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
  phone: z
    .string()
    .trim()
    .min(7, "Enter your phone number.")
    .max(30, "Phone number is too long.")
    .refine(
      (value) => value.replace(/\D/g, "").length >= 7,
      "Enter a valid phone number.",
    ),
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
    phone: formData.get("phone"),
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
      data: {
        full_name: parsed.data.fullName,
        phone: parsed.data.phone,
        role: "customer",
      },
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

// ---------------------------------------------------------------------------
// Password reset. Two halves: request a link by email, then set the new
// password once the recovery link has established a session via /auth/callback.
// ---------------------------------------------------------------------------

export type ResetState = { ok?: boolean; error?: string };

const emailOnly = z.object({
  email: z.string().email("Enter a valid email address."),
});

const passwordOnly = z.object({
  password: z.string().min(8, "Password must be at least 8 characters."),
});

// Where Supabase should send people back to. Set NEXT_PUBLIC_APP_URL in the
// deployed environment; the fallback only ever applies in local dev.
function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function requestPasswordResetAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = emailOnly.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid email." };
  }

  const supabase = await createClient();
  // Delivered by Supabase's own mailer. Errors here are almost always "unknown
  // address" or rate limiting; we swallow them and report success either way so
  // the form never reveals whether an email is registered.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteOrigin()}/auth/callback?next=/reset-password`,
  });

  return { ok: true };
}

export async function updatePasswordAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = passwordOnly.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return { error: error.message };
  }

  const profile = await getProfile();
  revalidatePath("/", "layout");
  redirect(profile ? homePathForRole(profile.role) : "/dashboard");
}
