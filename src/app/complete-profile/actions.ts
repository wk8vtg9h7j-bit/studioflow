// ============================================================================
// Finish setting up an account created by a third-party sign-in.
//
// Google gives us a verified email and a name, but never a phone number, and
// never the studio choice that the signup form collects. Reception relies on a
// phone number to reach members about classes, so it is required here before
// the app becomes usable. Studio is optional — it only sets a default and the
// member can change it later on /profile.
// ============================================================================
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const STUDIO_SLUGS = [
  "downtown-pilates",
  "hideaway-pilates",
  "an-thuong-pilates",
];

export async function completeProfileAction(formData: FormData) {
  const profile = await requireRole("customer", "/complete-profile");

  const phone = String(formData.get("phone") ?? "").trim();
  // Same rule as the signup schema: at least 7 actual digits, 30 chars max.
  if (phone.replace(/\D/g, "").length < 7 || phone.length > 30) {
    redirect("/complete-profile?status=invalid");
  }

  // profiles is the identity record the app reads...
  const supabase = await createClient();
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ phone })
    .eq("id", profile.id);
  if (profileError) redirect("/complete-profile?status=error");

  // ...and customers is what reception actually reads in the CRM. The signup
  // trigger writes both; saveCustomerProfile on /profile only writes profiles,
  // so write both here or the number never reaches the people who need it.
  const service = createServiceClient();
  const { error: customerError } = await service
    .from("customers")
    .update({ phone })
    .eq("profile_id", profile.id);
  if (customerError) redirect("/complete-profile?status=error");

  const slug = String(formData.get("studio_slug") ?? "");
  if (STUDIO_SLUGS.includes(slug)) {
    const { data: studio } = await service
      .from("studios")
      .select("id")
      .eq("slug", slug)
      .eq("active", true)
      .maybeSingle();
    if (studio) {
      await service
        .from("customers")
        .update({ preferred_studio_id: (studio as { id: string }).id })
        .eq("profile_id", profile.id);
    }
  }

  revalidatePath("/", "layout");
  redirect(slug === "an-thuong-pilates" ? "/coaching" : "/home");
}
