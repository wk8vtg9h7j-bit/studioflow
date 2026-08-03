// ============================================================================
// Customer route group layout — wraps every customer-facing page in the shared
// AppShell with a customer nav. Guards the whole group: anyone who isn't a
// customer is redirected to their own home by requireRole. The customer home is
// /book, so that's the base path we send unauthorized users back through.
//
// Booking is the one thing members do every visit, so it stays a visible tab.
// Everything about their own account sits behind a dropdown, which keeps the
// header from overflowing on a phone.
// ============================================================================
import { cookies } from "next/headers";
import { requireRole } from "@/lib/auth";
import { AppShell, type NavItem } from "@/components/AppShell";
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

  const navItems: NavItem[] = [{ href: "/book", label: dict.nav_book }];

  const navMenu = {
    label: dict.nav_account,
    items: [
      { href: "/my-bookings", label: dict.nav_bookings },
      { href: "/my-packages", label: dict.nav_packages },
    ] as NavItem[],
  };

  return (
    <AppShell
      navItems={navItems}
      navMenu={navMenu}
      user={profile.full_name ?? profile.email ?? "Member"}
      roleLabel={dict.role_member}
      locale={locale}
    >
      {children}
    </AppShell>
  );
}
