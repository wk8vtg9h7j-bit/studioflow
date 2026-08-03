// ============================================================================
// NavLink — a nav item that highlights when its route is active. Used inside the
// AppShell top bar for every signed-in section.
// ============================================================================
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Active when the path is the link itself or a nested route under it, so
  // "/admin/sessions/new" keeps the "Sessions" tab lit.
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-brand-700 bg-brand-50"
          : "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-ink hover:bg-stone-100"
      }
    >
      {children}
    </Link>
  );
}
