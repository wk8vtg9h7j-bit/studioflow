// ============================================================================
// Customer route group layout — wraps every customer-facing page in the shared
// AppShell with a customer nav. Guards the whole group: anyone who isn't a
// customer is redirected to their own home by requireRole. The customer home is
// /book, so that's the base path we send unauthorized users back through.
// ============================================================================
import { requireRole } from "@/lib/auth";
import { AppShell, type NavItem } from "@/components/AppShell";
import type { NavMenuItem } from "@/components/NavMenu";

// Booking is the reason members sign in, so it stays a flat tab. Everything
// account-related collapses into one dropdown to keep the bar phone-friendly.
const CUSTOMER_NAV: NavItem[] = [{ href: "/book", label: "Book classes" }];

const CUSTOMER_MENU: { label: string; items: NavMenuItem[] } = {
  label: "My account",
  items: [
    { href: "/my-bookings", label: "My bookings" },
    { href: "/my-packages", label: "Packages" },
  ],
};

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole("customer", "/book");

  return (
    <AppShell
      navItems={CUSTOMER_NAV}
      navMenu={CUSTOMER_MENU}
      user={profile.full_name ?? profile.email ?? "Member"}
      roleLabel="Member"
    >
      {children}
    </AppShell>
  );
}
