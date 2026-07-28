"use client";

// Small pill toggle that flips the `locale` cookie between EN and VI, then
// refreshes the route so server components re-render in the chosen language.
// Scoped to customer + auth surfaces (see i18n.ts).

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  LOCALE_COOKIE,
  localeFromCookieString,
  type Locale,
} from "@/lib/i18n";

const ONE_YEAR = 60 * 60 * 24 * 365;

export function LanguageToggle({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setLocale(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <div
      className="inline-flex items-center rounded-full border border-neutral-200 bg-white p-0.5 text-xs font-medium"
      role="group"
      aria-label="Language"
    >
      {(["vi", "en"] as const).map((code) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            disabled={pending}
            aria-pressed={active}
            className={
              active
                ? "rounded-full bg-brand-600 px-2.5 py-1 text-white"
                : "rounded-full px-2.5 py-1 text-neutral-500 hover:text-neutral-800"
            }
          >
            {code === "vi" ? "VI" : "EN"}
          </button>
        );
      })}
    </div>
  );
}
