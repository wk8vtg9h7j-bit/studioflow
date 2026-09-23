"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NavMenuItem } from "@/components/NavMenu";

type MobileNavItem = { href: string; label: string };

export function MobileNavMenu({
  navItems,
  navMenu,
}: {
  navItems: MobileNavItem[];
  navMenu?: { label: string; items: NavMenuItem[] };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const itemClass = (href: string) =>
    isActive(href)
      ? "block rounded-lg bg-brand-50 px-3 py-2.5 text-sm font-medium text-brand-700"
      : "block rounded-lg px-3 py-2.5 text-sm font-medium text-ink-muted hover:bg-stone-100 hover:text-ink";

  return (
    <div className="relative sm:hidden" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open navigation menu"
        className={
          open
            ? "grid h-9 w-9 place-items-center rounded-md bg-brand-50 text-brand-700"
            : "grid h-9 w-9 place-items-center rounded-md text-ink-muted hover:bg-stone-100 hover:text-ink"
        }
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-stone-200 bg-white p-2 shadow-card"
        >
          <nav className="flex flex-col gap-0.5" aria-label="Mobile navigation">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                aria-current={isActive(item.href) ? "page" : undefined}
                className={itemClass(item.href)}
              >
                {item.label}
              </Link>
            ))}

            {navMenu ? (
              <>
                <div className="my-1 border-t border-stone-100" />
                <p className="px-3 pb-1 pt-2 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
                  {navMenu.label}
                </p>
                {navMenu.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    aria-current={isActive(item.href) ? "page" : undefined}
                    className={itemClass(item.href)}
                  >
                    {item.label}
                  </Link>
                ))}
              </>
            ) : null}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
