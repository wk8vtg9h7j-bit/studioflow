"use client";

import { createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/locale";
import { LOCALE_COOKIE } from "@/lib/locale";

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();

  function setLocale(next: Locale) {
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  }

  return (
    <LanguageContext.Provider value={{ locale, setLocale }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) {
    throw new Error("useLanguage must be used inside LanguageProvider");
  }
  return value;
}

export function LanguageSwitcher() {
  const { locale, setLocale } = useLanguage();

  return (
    <div
      className="flex shrink-0 items-center rounded-lg border border-stone-200 bg-white p-0.5 text-xs font-medium"
      aria-label={locale === "vi" ? "Chọn ngôn ngữ" : "Choose language"}
    >
      <button
        type="button"
        onClick={() => setLocale("en")}
        className={
          locale === "en"
            ? "rounded-md bg-stone-100 px-2 py-1 text-ink"
            : "rounded-md px-2 py-1 text-ink-soft hover:text-ink"
        }
        aria-pressed={locale === "en"}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLocale("vi")}
        className={
          locale === "vi"
            ? "rounded-md bg-stone-100 px-2 py-1 text-ink"
            : "rounded-md px-2 py-1 text-ink-soft hover:text-ink"
        }
        aria-pressed={locale === "vi"}
      >
        VI
      </button>
    </div>
  );
}
