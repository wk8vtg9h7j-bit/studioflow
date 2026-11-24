// ============================================================================
// Auth layout — a centered, branded shell shared by the login and signup pages.
// ============================================================================
import Link from "next/link";
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
      <main className="grid min-h-screen place-items-center px-6 py-12 [&:has(.studio-login)]:bg-[#f6f3ed] [&:has(.studio-login)]:px-4 [&:has(.studio-login)]:py-6 sm:[&:has(.studio-login)]:px-8 lg:[&:has(.studio-login)]:py-10">
        <div className="group w-full max-w-sm [&:has(.studio-login)]:max-w-6xl">
          <div className="flex flex-col group-has-[.studio-login]:mb-6 group-has-[.studio-login]:flex-row-reverse group-has-[.studio-login]:items-center group-has-[.studio-login]:justify-between lg:group-has-[.studio-login]:mb-8">
          <div className="mb-4 flex justify-end group-has-[.studio-login]:mb-0">
            <LanguageSwitcher />
          </div>
          <Link
          href="/"
          className="mb-8 block text-center text-lg font-semibold tracking-tight text-ink group-has-[.studio-login]:mb-0 group-has-[.studio-login]:text-left group-has-[.studio-login]:text-xl group-has-[.studio-login]:text-[#263222]"
        >
          Studio<span className="text-brand-600 group-has-[.studio-login]:text-[#536349]">Flow</span>
        </Link>
          </div>
          {children}
        </div>
      </main>
    </LanguageProvider>
  );
}
