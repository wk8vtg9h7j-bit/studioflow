export type Locale = "en" | "vi";

export const LOCALE_COOKIE = "studioflow_locale";

export function normalizeLocale(value: string | null | undefined): Locale {
  return value === "vi" ? "vi" : "en";
}
