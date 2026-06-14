// ============================================================================
// Server Supabase client (for Server Components, Route Handlers, Server Actions).
// Reads/writes the auth session via Next.js cookies.
// ============================================================================
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { PREVIEW_MODE, previewFetch } from "@/lib/preview";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Preview mode: route all network calls through a shim that returns
      // benign empty responses, so the dead stub host never throws.
      ...(PREVIEW_MODE ? { global: { fetch: previewFetch } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if middleware refreshes sessions.
          }
        },
      },
    },
  );
}

// Service-role client — bypasses RLS. Server-only. Use sparingly (webhooks,
// cron, Google sync) where the request has no user session but must write data.
export function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      ...(PREVIEW_MODE ? { global: { fetch: previewFetch } } : {}),
      cookies: { getAll() { return []; }, setAll() {} },
    },
  );
}
