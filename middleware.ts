import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { decrypt } from "@/lib/session";

/** Require a valid session (e.g. /dashboard, /complete-kyc). */
const protectedRoutes = ["/dashboard", "/complete-kyc"];

/**
 * Public routes (no session required to enter). Used for documentation; middleware
 * applies special cases (e.g. `/marketplace/cart` and `/marketplace/checkout` require auth).
 */
export const publicRoutes = [
  "/login",
  "/register",
  "/marketplace",
  "/invite",
] as const;

/**
 * Logged-in users are redirected from these to `/dashboard` (not from `/marketplace`).
 */
const publicAuthOnlyRoutes = ["/login", "/register"];

function matchesRoute(pathname: string, routes: string[]): boolean {
  return routes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

function isMarketplaceCheckoutPath(pathname: string): boolean {
  return (
    pathname === "/marketplace/checkout" ||
    pathname.startsWith("/marketplace/checkout/")
  );
}

function isMarketplaceCartPath(pathname: string): boolean {
  return (
    pathname === "/marketplace/cart" || pathname.startsWith("/marketplace/cart/")
  );
}

export async function middleware(request: NextRequest) {
  const token = request.cookies.get("bamys_session")?.value ?? null;
  const session = token ? await decrypt(token) : null;

  const { pathname } = request.nextUrl;

  if (
    (isMarketplaceCheckoutPath(pathname) || isMarketplaceCartPath(pathname)) &&
    !session
  ) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (matchesRoute(pathname, protectedRoutes) && !session) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  if (matchesRoute(pathname, publicAuthOnlyRoutes) && session) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    return NextResponse.redirect(dashboardUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap, robots, and common image assets
     */
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
