// ============================================================================
// Auth helpers — resolve the current user + profile (with role) on the server,
// and small guards used by role-protected layouts to enforce access.
// ============================================================================
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/lib/types";
import {
  PREVIEW_MODE,
  PREVIEW_COOKIE,
  isPreviewRole,
  syntheticProfile,
} from "@/lib/preview";

// Returns the signed-in user's profile, or null when logged out.
export async function getProfile(): Promise<Profile | null> {
  // Preview mode: derive a synthetic profile from the role cookie, no network.
  if (PREVIEW_MODE) {
    const cookieStore = await cookies();
    const role = cookieStore.get(PREVIEW_COOKIE)?.value;
    return isPreviewRole(role) ? syntheticProfile(role) : null;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (profile as Profile | null) ?? null;
}

// Require a signed-in user. Redirects to login (preserving the target path).
export async function requireProfile(nextPath?: string): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) {
    const params = nextPath
      ? `?next=${encodeURIComponent(nextPath)}`
      : "";
    redirect(`/login${params}`);
  }
  return profile;
}

// Require a specific role (or one of several). Redirects unauthorized users to
// their own home so they never see another role's section.
export async function requireRole(
  roles: UserRole | UserRole[],
  nextPath?: string,
): Promise<Profile> {
  const profile = await requireProfile(nextPath);
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(profile.role)) {
    redirect(homePathForRole(profile.role));
  }
  return profile;
}

// The landing route for each role after login.
export function homePathForRole(role: UserRole): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "instructor":
      return "/instructor";
    case "customer":
    default:
      return "/book";
  }
}
