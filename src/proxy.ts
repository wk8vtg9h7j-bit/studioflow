import { NextRequest, NextResponse } from "next/server";

const LANDING_BY_HOST: Record<string, string> = {
  "hideawaypilates.com": "/hideaway.html",
  "www.hideawaypilates.com": "/hideaway.html",
  "downtownpilatesdn.com": "/downtown.html",
  "www.downtownpilatesdn.com": "/downtown.html",
};

export function proxy(request: NextRequest) {
  const hostname = request.headers
    .get("host")
    ?.split(":")[0]
    .toLowerCase();

  const pathname = request.nextUrl.pathname;
  const landingPage = hostname ? LANDING_BY_HOST[hostname] : undefined;

  if (landingPage && pathname === "/") {
    return NextResponse.rewrite(new URL(landingPage, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
