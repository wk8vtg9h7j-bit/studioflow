// ============================================================================
// AppShell — the common chrome for every signed-in section: a slim top bar with
// the brand, role-scoped nav links, the current user, and a sign-out control.
//
// Sections with more than a couple of destinations can pass `navMenu` to tuck
// their secondary links behind a single dropdown, which keeps the bar legible on
// a phone. Sections that don't (admin) render exactly as before.
// ============================================================================
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { NavLink } from "@/components/NavLink";
import { NavMenu } from "@/components/NavMenu";
import { LanguageToggle } from "@/components/LanguageToggle";
import type { Locale } from "@/lib/i18n";

export type NavItem = { href: string; label: string };

export function AppShell({
  navItems,
  navMenu,
  user,
  roleLabel,
  locale,
  children,
}: {
  navItems: NavItem[];
  navMenu?: { label: string; items: NavItem[] };
  user: string;
  roleLabel: string;
  locale?: Locale;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:gap-6 sm:px-6">
          <Link
            href="/"
            className="shrink-0 text-base font-semibold tracking-tight text-ink"
          >
            Studio<span className="text-brand-600">Flow</span>
          </Link>

          <nav className="order-last flex w-full flex-wrap items-center gap-1 sm:order-none sm:w-auto sm:flex-1">
            {navItems.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
            {navMenu && navMenu.items.length > 0 && (
              <NavMenu label={navMenu.label} items={navMenu.items} />
            )}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0 sm:gap-3">
            {locale && <LanguageToggle locale={locale} />}
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight text-ink">{user}</p>
              <p className="text-xs leading-tight text-ink-soft">{roleLabel}</p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
