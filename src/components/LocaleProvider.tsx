// ============================================================================
// LocaleProvider — carries the active locale from a server layout down into the
// client components underneath it.
//
// Client components can't read the locale cookie themselves: Next.js renders
// their first pass on the server, where `document` doesn't exist. Layouts also
// can't hand props to `{children}`. So the server layout reads the cookie and
// publishes it here, and client pages call `useLocale()`.
//
// Only the locale string crosses the boundary — a `Dict` holds functions (e.g.
// `seats_left(n)`), which aren't serializable. Consumers call `getDict(locale)`.
// ============================================================================
"use client";

import { createContext, useContext } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}
