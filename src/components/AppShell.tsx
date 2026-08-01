// ============================================================================
// AppShell — the common chrome for every signed-in section: a slim top bar with
// the brand, role-scoped nav links, the current user, and a sign-out control.
// ============================================================================
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { NavLink } from "@/components/NavLink";
import { LanguageToggle } from "@/components/LanguageToggle";
import type { Locale } from "@/lib/i18n";

export type NavItem = { href: string; label: string };

export function AppShell({
  navItems,
  user,
  roleLabel,
  locale,
  children,
}: {
  navItems: NavItem[];
  user: string;
  roleLabel: string;
  locale?: Locale;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/" className="text-base font-semibold tracking-tight text-ink">
            Studio<span className="text-brand-600">Flow</span>
          </Link>

          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {navItems.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {locale && <LanguageToggle locale={locale} />}
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight text-ink">{user}</p>
              <p className="text-xs leading-tight text-ink-soft">{roleLabel}</p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </div>
  );
}
