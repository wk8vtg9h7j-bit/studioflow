// ============================================================================
// Instructor portal layout. Mirrors the admin layout: re-check the instructor
// role (RLS is the real guard; this is defence in depth + a clean redirect for
// the wrong role) and wrap the section in the shared AppShell with its own nav.
// ============================================================================
import { requireRole } from "@/lib/auth";
import { AppShell, type NavItem } from "@/components/AppShell";

const INSTRUCTOR_NAV: NavItem[] = [
  { href: "/instructor", label: "My classes" },
  { href: "/instructor/salary", label: "Salary" },
];

export default async function InstructorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole("instructor", "/instructor");

  return (
    <AppShell
      navItems={INSTRUCTOR_NAV}
      user={profile.full_name ?? profile.email ?? "Instructor"}
      roleLabel="Instructor"
    >
      {children}
    </AppShell>
  );
}
