// ============================================================================
// Auth server actions — sign in, sign up, and sign out. Each returns a typed
// result the client form can render; success paths redirect by role.
// ============================================================================
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getProfile, homePathForRole } from "@/lib/auth";
import { PREVIEW_MODE, PREVIEW_COOKIE } from "@/lib/preview";
import { siteOrigin } from "@/lib/site";
import { notifyPasswordReset } from "@/lib/notify";

export type AuthState = { error: string | null };

// Result shape shared by the forgot-password and reset-password forms.
export type ResetState = { ok?: boolean; error?: string };

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

  // Create the account already-confirmed via the service role so customers can
  // start booking immediately. The studio's Supabase project has no custom SMTP
  // configured, so confirmation emails don't reliably deliver — auto-confirming
  // removes that dependency for new sign-ups. The `handle_new_user` trigger
  // reads user_metadata to stamp the profile role.
  const admin = createServiceClient();
  const { error: createError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.fullName, role: "customer" },
  });
  if (createError) {
    const msg = /already|registered|exists/i.test(createError.message)
      ? "That email is already registered. Try logging in instead."
      : createError.message;
    return { error: msg };
  }

  // Establish the session cookie by signing in with the just-set password.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (signInError) {
    return { error: "Account created. Please log in to start booking." };
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

const emailOnly = z.object({
  email: z.string().email("Enter a valid email address."),
});

const passwordOnly = z.object({
  password: z.string().min(8, "Password must be at least 8 characters."),
});

// Send a password-reset email. We always report success so the form never
// reveals whether an address is registered. The recovery link points at
// /auth/callback, which exchanges the code for a session and forwards the user
// to the reset-password page.
export async function requestPasswordResetAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = emailOnly.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid email." };
  }

  // The project has no custom SMTP, so Supabase's own resetPasswordForEmail
  // never delivers. Mint the recovery link with the service role and send it
  // through Resend (same channel as the booking notifications).
  const admin = createServiceClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: parsed.data.email,
    options: {
      redirectTo: `${siteOrigin()}/auth/callback?next=/reset-password`,
    },
  });

  // Unknown address: report success anyway so the form never reveals whether
  // an email is registered.
  if (error || !data?.properties?.action_link) {
    return { ok: true };
  }

  const sent = await notifyPasswordReset(
    parsed.data.email,
    data.properties.action_link,
  );
  if (!sent) {
    return {
      error:
        "We couldn't send the reset email right now. Please contact the studio.",
    };
  }

  return { ok: true };
}

// Set a new password for the currently-authenticated recovery session, then
// send the user to their role home.
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
