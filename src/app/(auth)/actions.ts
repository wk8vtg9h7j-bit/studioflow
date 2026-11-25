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
import { getLocale } from "@/lib/locale-server";

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
  studio: z.enum(["downtown-pilates","hideaway-pilates","an-thuong-pilates"]),
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
  const vi = (await getLocale()) === "vi";
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
    return { error: vi ? "Email hoặc mật khẩu không đúng." : "Email or password is incorrect." };
  }

  const next = safeNext(formData.get("next"));
  const profile = await getProfile();
  revalidatePath("/", "layout");
  redirect(next ?? (profile ? homePathForRole(profile.role) : "/dashboard"));
}

// ---------------------------------------------------------------------------
// Google sign-in. Supabase mints the provider URL; we hand the browser to it,
// and Google returns the user to /auth/callback, which exchanges the code for a
// session — the same route password-recovery links already use.
//
// For a first-time Google user the account is created by Supabase itself, so
// signUpAction below never runs. See the note on it.
// ---------------------------------------------------------------------------
export async function signInWithGoogleAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const vi = (await getLocale()) === "vi";

  // The button is hidden unless this is set, but the action is reachable on its
  // own, so refuse here too rather than trusting the UI.
  if (process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN !== "1") {
    return {
      error: vi
        ? "Đăng nhập Google chưa khả dụng."
        : "Google sign-in is not available yet.",
    };
  }

  // Preview mode stubs the auth endpoints, so there is nothing to sign in to.
  if (PREVIEW_MODE) {
    return {
      error: vi
        ? "Đăng nhập Google không khả dụng ở chế độ xem trước."
        : "Google sign-in is unavailable in preview mode.",
    };
  }

  const next = safeNext(formData.get("next"));
  const callback = new URL("/auth/callback", siteOrigin());
  if (next) callback.searchParams.set("next", next);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback.toString() },
  });

  if (error || !data?.url) {
    return {
      error: vi
        ? "Không thể bắt đầu đăng nhập Google. Vui lòng thử lại."
        : "Could not start Google sign-in. Please try again.",
    };
  }

  redirect(data.url);
}

// ---------------------------------------------------------------------------
// IMPORTANT — this is not the only way an account can be created.
//
// A third-party sign-in (Google) creates the Supabase auth user itself, so none
// of the validation below runs for those members: no phone check, no studio
// choice, no "account already exists" message. The only thing behind an OAuth
// signup is the handle_new_user() trigger
// (supabase/migrations/20261125120000_oauth_identity_guards.sql), which defaults
// the role to 'customer', creates the CRM row and grants the starter credit.
//
// So: any rule added here that must hold for EVERY member has to be mirrored in
// that trigger, or it will silently not apply to Google users.
// ---------------------------------------------------------------------------
export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const vi = (await getLocale()) === "vi";
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
    studio: formData.get("studio"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details." };
  }

  // Create confirmed customers on the server so signup never depends on mail
  // delivery. Keep the role fixed here before the profile/customer trigger runs.
  const service = createServiceClient();
  const { error } = await service.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.fullName,
      phone: parsed.data.phone,
      role: "customer",
      preferred_studio_slug: parsed.data.studio,
    },
  });
  if (error) {
    if (error.code === "email_exists" || error.code === "user_already_exists") {
      return {
        error: vi
          ? "Email này đã có tài khoản. Vui lòng đăng nhập hoặc chọn Quên mật khẩu."
          : "An account already exists for this email. Log in or choose Forgot password.",
      };
    }
    return { error: error.message };
  }

  const supabase = await createClient();
  const { data, error: signInError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (signInError || !data.session) {
    return {
      error: vi
        ? "Tài khoản đã được tạo. Vui lòng đăng nhập bằng email và mật khẩu bạn vừa chọn."
        : "Your account is ready. Please log in with the email and password you just chose.",
    };
  }

  revalidatePath("/", "layout");
  redirect(parsed.data.studio === "an-thuong-pilates" ? "/coaching" : "/book");
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
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteOrigin()}/auth/callback?next=/reset-password`,
  });

  if (error) {
    // Give actionable feedback for delivery/rate-limit failures rather than
    // incorrectly claiming an email is on its way. Keep unknown-user
    // responses indistinguishable to avoid account enumeration.
    if (error.status === 429) {
      return { error: "Too many reset attempts. Please wait before requesting another email." };
    }
    if (/user not found|email not confirmed|invalid login credentials/i.test(error.message)) {
      return { ok: true };
    }
    console.error("Password reset request failed", {
      status: error.status,
      code: error.code,
    });
    return { error: "We couldn't send a reset email right now. Please try again later or contact the studio." };
  }

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
