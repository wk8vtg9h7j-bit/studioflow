// ============================================================================
// Customer route group layout — wraps every customer-facing page in the shared
// AppShell with a customer nav. Guards the whole group: anyone who isn't a
// customer is redirected to their own home by requireRole. The customer home is
// /book, so that's the base path we send unauthorized users back through.
// ============================================================================
import { cookies } from "next/headers";
import { requireRole } from "@/lib/auth";
import { AppShell, type NavItem } from "@/components/AppShell";
import type { NavMenuItem } from "@/components/NavMenu";
import { getDict, localeFromCookieString } from "@/lib/i18n";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole("customer", "/book");

  const cookieStore = await cookies();
  const locale = localeFromCookieString(cookieStore.toString());
  const dict = getDict(locale);

  // Keep booking visible as the primary action. Secondary customer destinations
  // live under one account menu so the header stays usable on narrow screens.
  const navItems: NavItem[] = [{ href: "/book", label: dict.nav_book }];
  const navMenu: { label: string; items: NavMenuItem[] } = {
    label: dict.nav_account,
    items: [
      { href: "/my-bookings", label: dict.nav_bookings },
      { href: "/my-packages", label: dict.nav_packages },
    ],
  };

  return (
    <AppShell
      navItems={navItems}
      navMenu={navMenu}
      user={profile.full_name ?? profile.email ?? dict.role_member}
      roleLabel={dict.role_member}
      locale={locale}
    >
      {children}
    </AppShell>
  );
}
