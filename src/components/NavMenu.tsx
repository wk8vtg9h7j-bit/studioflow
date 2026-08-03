// ============================================================================
// NavMenu — a small dropdown for grouping secondary nav links behind one pill.
// The customer header used to lay every destination out flat, which pushed the
// tabs off the edge of a phone screen. Collapsing the account-related links into
// a single trigger keeps the bar readable at any width.
// ============================================================================
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavMenuItem = { href: string; label: string };

export function NavMenu({
  label,
  items,
}: {
  label: string;
  items: NavMenuItem[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Any click outside the menu, or Escape, closes it.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Close on navigation so the panel never lingers over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const active = items.some(
    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
  );

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={
          active || open
            ? "flex items-center gap-1 rounded-md bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700"
            : "flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-stone-100 hover:text-ink"
        }
      >
        <span className="whitespace-nowrap">{label}</span>
        <span
          aria-hidden
          className={`text-[0.6rem] leading-none transition-transform ${open ? "rotate-180" : ""}`}
        >
          {"\u25BE"}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-30 mt-2 min-w-[11rem] overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-card"
        >
          {items.map((item) => {
            const isCurrent =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                aria-current={isCurrent ? "page" : undefined}
                className={
                  isCurrent
                    ? "block px-4 py-2 text-sm font-medium text-brand-700 bg-brand-50"
                    : "block px-4 py-2 text-sm font-medium text-ink-muted hover:bg-stone-100 hover:text-ink"
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
