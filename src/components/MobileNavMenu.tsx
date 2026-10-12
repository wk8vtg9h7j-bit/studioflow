"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NavMenuItem } from "@/components/NavMenu";

type MobileNavItem = { href: string; label: string };

export function MobileNavMenu({
  navItems,
  navMenu,
  signOut,
}: {
  navItems: MobileNavItem[];
  navMenu?: { label: string; items: NavMenuItem[] };
  signOut?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  // The trigger sits near the center of narrow headers. Right-aligning a
  // fixed-width dropdown to it pushes the panel off the left side of phones.
  // Render into the body and clamp it inside the visible viewport instead.
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gutter = 12;
    const width = Math.min(320, Math.max(0, window.innerWidth - gutter * 2));
    const left = Math.max(
      gutter,
      Math.min(rect.right - width, window.innerWidth - gutter - width),
    );
    const top = rect.bottom + 8;
    setPosition({
      top,
      left,
      width,
      maxHeight: Math.max(120, window.innerHeight - top - gutter),
    });
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    updatePosition();
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const itemClass = (href: string) =>
    isActive(href)
      ? "block rounded-lg bg-brand-50 px-3 py-2.5 text-sm font-medium text-brand-700"
      : "block rounded-lg px-3 py-2.5 text-sm font-medium text-ink-muted hover:bg-stone-100 hover:text-ink";

  return (
    <div className="sm:hidden" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!open) updatePosition();
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-controls="mobile-navigation-menu"
        aria-haspopup="menu"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
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

      {open && position
        ? createPortal(
        <div
          ref={menuRef}
          id="mobile-navigation-menu"
          role="menu"
          style={position}
          className="fixed z-[100] overflow-y-auto overscroll-contain rounded-2xl border border-stone-200 bg-white p-2 shadow-xl"
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
          {signOut ? (
            <div className="mt-2 border-t border-stone-100 pt-2 [&_button]:w-full [&_button]:justify-start">
              {signOut}
            </div>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
