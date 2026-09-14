// ============================================================================
// Admin layout — guards the whole /admin section to the `admin` role and wraps
// it in the shared AppShell with admin-scoped navigation.
// ============================================================================
import { requireRole } from "@/lib/auth";
import { AppShell, type NavItem } from "@/components/AppShell";

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/sessions", label: "Sessions" },
  { href: "/admin/studios", label: "Studios" },
  { href: "/admin/class-types", label: "Class types" },
  { href: "/admin/instructors", label: "Instructors" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/packages", label: "Packages" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/payroll", label: "Payroll" },
  { href: "/admin/pay-rules", label: "Pay rules" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole("admin", "/admin");

  return (
    <AppShell
      navItems={ADMIN_NAV}
      user={profile.full_name ?? profile.email ?? "Admin"}
      roleLabel="Administrator"
    >
      {children}
    </AppShell>
  );
}
