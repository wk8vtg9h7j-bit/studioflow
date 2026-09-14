// ============================================================================
// Auth layout — a centered, branded shell shared by the login and signup pages.
// ============================================================================
import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 block text-center text-lg font-semibold tracking-tight text-ink"
        >
          Studio<span className="text-brand-600">Flow</span>
        </Link>
        {children}
      </div>
    </main>
  );
}
