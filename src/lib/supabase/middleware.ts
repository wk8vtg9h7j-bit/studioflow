// ============================================================================
// Session-refresh helper used by the root middleware.
// Refreshes the Supabase auth cookie on every request so Server Components
// always see a valid session, and gates the role-protected route prefixes.
// ============================================================================
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };
import { PREVIEW_MODE, PREVIEW_COOKIE } from "@/lib/preview";

// Route prefixes that require a signed-in user. Role-level checks happen in
// each section's layout; this only enforces "must be logged in".
const PROTECTED_PREFIXES = ["/admin", "/instructor", "/account", "/book"];
const AUTH_PAGES = ["/login", "/signup"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Preview mode: skip the network call to getUser(). Treat the presence of the
  // role cookie as "signed in" so the same gating logic below still applies.
  let user: unknown = null;
  if (PREVIEW_MODE) {
    user = request.cookies.get(PREVIEW_COOKIE) ? {} : null;
  } else {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: CookieToSet[]) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            );
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    // IMPORTANT: getUser() refreshes the token and must run before any redirect.
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    user = authUser;
  }

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p));

  // Not signed in and visiting a protected page -> bounce to login.
  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Signed in and visiting login/signup -> send to the post-login router.
  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
