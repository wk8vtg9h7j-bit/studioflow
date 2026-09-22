// ============================================================================
// AppShell — the common chrome for every signed-in section: a slim top bar with
// the brand, role-scoped nav links, the current user, and a sign-out control.
// ============================================================================
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { NavLink } from "@/components/NavLink";
import { NavMenu, type NavMenuItem } from "@/components/NavMenu";

export type NavItem = { href: string; label: string };

export function AppShell({
  navItems,
  navMenu,
  user,
  roleLabel,
  notifications,
  children,
}: {
  navItems: NavItem[];
  navMenu?: { label: string; items: NavMenuItem[] };
  user: string;
  roleLabel: string;
  notifications?: { count: number; href: string };
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/" className="text-base font-semibold tracking-tight text-ink">
            Studio<span className="text-brand-600">Flow</span>
          </Link>

          <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {navItems.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
            {navMenu ? (
              <NavMenu label={navMenu.label} items={navMenu.items} />
            ) : null}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight text-ink">{user}</p>
              <p className="text-xs leading-tight text-ink-soft">{roleLabel}</p>
            </div>
            {notifications ? (
              <Link
                href={notifications.href}
                aria-label={
                  notifications.count > 0
                    ? `${notifications.count} new notifications`
                    : "Notifications"
                }
                className="relative grid h-9 w-9 place-items-center rounded-full text-ink-soft transition hover:bg-stone-100 hover:text-ink"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                </svg>
                {notifications.count > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 grid min-w-[1.15rem] place-items-center rounded-full bg-brand-600 px-1 text-[0.65rem] font-semibold leading-[1.15rem] text-white">
                    {notifications.count > 99 ? "99+" : notifications.count}
                  </span>
                ) : null}
              </Link>
            ) : null}
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </div>
  );
}
