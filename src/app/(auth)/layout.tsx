// ============================================================================
// Auth layout — a centered, branded shell shared by the login and signup pages.
// A language toggle sits top-right so members can switch EN/VI before signing in.
// ============================================================================
import Link from "next/link";
import { cookies } from "next/headers";
import { LanguageToggle } from "@/components/LanguageToggle";
import { LocaleProvider } from "@/components/LocaleProvider";
import { localeFromCookieString } from "@/lib/i18n";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const locale = localeFromCookieString(cookieStore.toString());

  return (
    <main className="relative grid min-h-screen place-items-center px-6 py-12">
      <div className="absolute right-6 top-6">
        <LanguageToggle locale={locale} />
      </div>
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 block text-center text-lg font-semibold tracking-tight text-ink"
        >
          Studio<span className="text-brand-600">Flow</span>
        </Link>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </div>
    </main>
  );
}
