// ============================================================================
// Dashboard role-router — the middleware sends every signed-in user here after
// login; this page forwards them to the correct section for their role.
// ============================================================================
import { requireProfile, homePathForRole } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const profile = await requireProfile("/dashboard");
  redirect(homePathForRole(profile.role));
}
