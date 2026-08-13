// ============================================================================
// Auth layout — a centered, branded shell shared by the login and signup pages.
//
// The auth pages are client components, so they can't read the locale cookie
// themselves. This server layout reads it once and publishes it through
// LocaleProvider; each page calls useLocale() + getDict() to translate itself.
// ============================================================================
import Link from "next/link";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n";
import { LocaleProvider } from "@/components/LocaleProvider";
import { LanguageToggle } from "@/components/LanguageToggle";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-between">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight text-ink"
          >
            Studio<span className="text-brand-600">Flow</span>
          </Link>
          <LanguageToggle locale={locale} />
        </div>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </div>
    </main>
  );
}
