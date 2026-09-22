// ============================================================================
// Admin layout — guards the whole /admin section to the `admin` role and wraps
// it in the shared AppShell with admin-scoped navigation.
// ============================================================================
import { cookies } from "next/headers";
import { requireRole } from "@/lib/auth";
import {
  NOTIF_SEEN_COOKIE,
  countNotificationsSince,
} from "./notifications/data";
import { AppShell, type NavItem } from "@/components/AppShell";

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/notifications", label: "Notifications" },
  { href: "/admin/sessions", label: "Sessions" },
  { href: "/admin/studios", label: "Studios" },
  { href: "/admin/class-types", label: "Class types" },
  { href: "/admin/instructors", label: "Instructors" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/packages", label: "Packages" },
  { href: "/admin/products", label: "Products" },
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

  const cookieStore = await cookies();
  const seenISO = cookieStore.get(NOTIF_SEEN_COOKIE)?.value ?? null;
  const newCount = await countNotificationsSince(seenISO);

  return (
    <AppShell
      navItems={ADMIN_NAV}
      user={profile.full_name ?? profile.email ?? "Admin"}
      roleLabel="Administrator"
      notifications={{ count: newCount, href: "/admin/notifications" }}
    >
      {children}
    </AppShell>
  );
}
