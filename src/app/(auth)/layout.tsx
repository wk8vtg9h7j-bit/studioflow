// ============================================================================
// Auth layout — a centered, branded shell shared by the login and signup pages.
// ============================================================================
import Link from "next/link";
import "./auth-design.css";
import { getLocale } from "@/lib/locale-server";
import {
  LanguageProvider,
  LanguageSwitcher,
} from "@/components/LanguageProvider";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();

  return (
    <LanguageProvider locale={locale}>
      <main className="studio-auth-shell grid min-h-screen place-items-center px-6 py-12">
        <div className="studio-auth-container w-full max-w-sm">
          <div className="studio-auth-header flex flex-col">
          <div className="studio-auth-language mb-4 flex justify-end">
            <LanguageSwitcher />
          </div>
          <Link
          href="/"
          className="studio-auth-wordmark mb-8 block text-center text-lg font-semibold tracking-tight text-ink"
        >
          Studio<span className="studio-auth-wordmark-accent text-brand-600">Flow</span>
        </Link>
          </div>
          {children}
        </div>
      </main>
    </LanguageProvider>
  );
}
