// ============================================================================
// Customer route group layout — wraps every customer-facing page in the shared
// AppShell with a customer nav. Guards the whole group: anyone who isn't a
// customer is redirected to their own home by requireRole. The customer home is
// /book, so that's the base path we send unauthorized users back through.
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

  // Nav labels come from the dictionary so the whole customer shell follows the
  // language toggle. The locale itself is passed down for the toggle's state.
  const cookieStore = await cookies();
  const locale = localeFromCookieString(cookieStore.toString());
  const dict = getDict(locale);

  const navItems: NavItem[] = [
    { href: "/book", label: dict.nav_book },
    { href: "/my-bookings", label: dict.nav_bookings },
    { href: "/my-packages", label: dict.nav_packages },
  ];

  return (
    <AppShell
      navItems={navItems}
      user={profile.full_name ?? profile.email ?? dict.role_member}
      roleLabel={dict.role_member}
      locale={locale}
    >
      {children}
    </AppShell>
  );
}
