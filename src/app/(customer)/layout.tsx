// ============================================================================
// Customer route group layout — wraps every customer-facing page in the shared
// AppShell with a customer nav. Guards the whole group: anyone who isn't a
// customer is redirected to their own home by requireRole. The customer home is
// /book, so that's the base path we send unauthorized users back through.
// ============================================================================
import { requireRole } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { LanguageProvider } from "@/components/LanguageProvider";
import { AppShell, type NavItem } from "@/components/AppShell";
import type { NavMenuItem } from "@/components/NavMenu";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [profile, locale] = await Promise.all([
    requireRole("customer", "/book"),
    getLocale(),
  ]);
  const vi = locale === "vi";

  const navItems: NavItem[] = [
    { href: "/book", label: vi ? "Đặt lớp" : "Book classes" },
  ];
  const navMenu: { label: string; items: NavMenuItem[] } = {
    label: vi ? "Tài khoản" : "My account",
    items: [
      { href: "/my-bookings", label: vi ? "Lịch đã đặt" : "My bookings" },
      { href: "/my-packages", label: vi ? "Gói tập" : "Packages" },
    ],
  };

  return (
    <LanguageProvider locale={locale}>
      <AppShell
        navItems={navItems}
        navMenu={navMenu}
        user={profile.full_name ?? profile.email ?? (vi ? "Thành viên" : "Member")}
        roleLabel={vi ? "Thành viên" : "Member"}
        locale={locale}
      >
        {children}
      </AppShell>
    </LanguageProvider>
  );
}
