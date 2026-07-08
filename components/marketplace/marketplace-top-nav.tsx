"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import * as React from "react";

import { UserAccountNav } from "@/components/layout/user-account-nav";
import {
  HeaderIconAnchor,
  HeaderIconBadge,
  formatHeaderBadgeCount,
} from "@/components/layout/header-icon-badge";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import { useMode } from "@/contexts/mode-context";
import { cn } from "@/lib/utils";

type AuthMePayload = {
  authenticated?: boolean;
  email?: string;
  teamRole?: string | null;
  organizationId?: string | null;
  supplierGroup?: string | null;
  supplierDocName?: string | null;
};

type MeForNav = {
  email: string;
  teamRole: string | null;
  organizationId: string | null;
  supplierGroup: string | null;
  supplierDocName: string | null;
};

const linkClass = (active: boolean) =>
  cn(
    "text-[14px] font-medium tracking-[-0.15px] transition-colors",
    active
      ? "text-primary"
      : "text-[#364153] hover:text-[#0a0a0a]"
  );

export function MarketplaceTopNav() {
  const { mode } = useMode();
  const pathname = usePathname();
  const ordersActive =
    pathname === "/dashboard/procurement/orders" || pathname === "/orders";
  const cartActive =
    pathname.startsWith("/marketplace/cart") ||
    pathname.startsWith("/marketplace/checkout");
  const [cartCount, setCartCount] = React.useState(0);
  /** Cart GET returned 403 (session exists but no buyer / cart access) — stop calling cart until logout or re-login. */
  const cartAccessDeniedRef = React.useRef(false);
  const prevAuthOkRef = React.useRef<boolean | null>(null);
  const loadCartCountRef = React.useRef<(() => Promise<void>) | null>(null);
  const [authState, setAuthState] = React.useState<
    "loading" | "in" | "out"
  >("loading");
  const [me, setMe] = React.useState<MeForNav | null>(null);

  // Include pathname so the dependency array length stays stable in dev (Fast Refresh
  // errors if the same hook flips between [] and [pathname] across hot updates).
  React.useEffect(() => {
    let cancelled = false;

    async function loadCartCount() {
      try {
        const authRes = await fetch("/api/auth/me", {
          credentials: "include",
        });
        const authJson = (await authRes.json().catch(() => ({}))) as AuthMePayload;
        const authOk = authJson.authenticated === true;

        if (!authOk) {
          cartAccessDeniedRef.current = false;
          prevAuthOkRef.current = false;
          if (!cancelled) {
            setAuthState("out");
            setMe(null);
            setCartCount(0);
          }
          return;
        }

        if (!cancelled) {
          setAuthState("in");
          setMe({
            email:
              typeof authJson.email === "string" && authJson.email.trim()
                ? authJson.email.trim()
                : "",
            teamRole: authJson.teamRole ?? null,
            organizationId:
              typeof authJson.organizationId === "string"
                ? authJson.organizationId
                : null,
            supplierGroup: authJson.supplierGroup ?? null,
            supplierDocName:
              typeof authJson.supplierDocName === "string"
                ? authJson.supplierDocName
                : null,
          });
        }

        // Fresh login after being logged out — allow cart to be fetched again
        if (prevAuthOkRef.current === false) {
          cartAccessDeniedRef.current = false;
        }
        prevAuthOkRef.current = true;

        if (mode === "selling") {
          if (!cancelled) setCartCount(0);
          return;
        }

        if (cartAccessDeniedRef.current) {
          if (!cancelled) setCartCount(0);
          return;
        }

        const res = await fetch("/api/marketplace/cart", {
          credentials: "include",
        });
        if (res.status === 403) {
          cartAccessDeniedRef.current = true;
          if (!cancelled) setCartCount(0);
          return;
        }
        if (!res.ok) {
          if (!cancelled) setCartCount(0);
          return;
        }
        const payload: unknown = await res.json().catch(() => []);
        const rows = Array.isArray(payload) ? payload : [];
        /** Badge = number of distinct cart line items, not sum of quantities. */
        const nextCount = rows.length;
        if (!cancelled) setCartCount(nextCount);
      } catch {
        if (!cancelled) {
          setCartCount(0);
          setAuthState("out");
          setMe(null);
        }
      }
    }

    loadCartCountRef.current = loadCartCount;
    void loadCartCount();
    const intervalId = window.setInterval(() => {
      void loadCartCount();
    }, 15000);

    return () => {
      cancelled = true;
      loadCartCountRef.current = null;
      window.clearInterval(intervalId);
    };
  }, [pathname, mode]);

  React.useEffect(() => {
    function onCartUpdated() {
      void loadCartCountRef.current?.();
    }
    window.addEventListener("bamys-cart-updated", onCartUpdated);
    return () => window.removeEventListener("bamys-cart-updated", onCartUpdated);
  }, []);

  const loginHref = `/login?callbackUrl=${encodeURIComponent(pathname || "/marketplace")}`;
  const registerHref = `/register`;

  const showCart =
    authState === "in" && mode === "buying";

  const cartBadgeLabel = formatHeaderBadgeCount(cartCount);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex h-16 items-center justify-between border-b px-4 backdrop-blur md:px-[72px]",
        "border-border bg-background/95 supports-[backdrop-filter]:bg-background/60"
      )}
    >
      <Link
        href="/marketplace"
        className="text-foreground flex items-center no-underline"
      >
        <img
          src="/logo-full.svg"
          alt="Qevira"
          className="h-8 w-auto"
          height={32}
        />
      </Link>
      <div className="flex items-center gap-6">
        <Link href="/dashboard/procurement/orders" className={linkClass(ordersActive)}>
          Orders
        </Link>
        <div className="flex items-center gap-5">
          {authState === "in" ?
            <NotificationBell />
          : null}
          {showCart ?
            <Link
              href="/marketplace/cart"
              className={cn(
                "text-[#364153] hover:text-[#0a0a0a]",
                cartActive && "text-primary"
              )}
            >
              <HeaderIconAnchor>
                <ShoppingCart className="size-[18px]" aria-hidden />
                {cartBadgeLabel ?
                  <HeaderIconBadge>{cartBadgeLabel}</HeaderIconBadge>
                : null}
              </HeaderIconAnchor>
            </Link>
          : null}
          {authState === "in" && me?.email ?
            <UserAccountNav
              email={me.email}
              name={
                me.supplierDocName ||
                me.organizationId ||
                me.email
              }
              role={
                me.teamRole ||
                (me.supplierGroup ? "Supplier" : "Buyer")
              }
              marketplaceMode={mode}
            />
          : null}
          {authState === "loading" ?
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled
                className="min-w-[5rem]"
              >
                …
              </Button>
              <Button type="button" size="sm" disabled className="min-w-[5rem]">
                …
              </Button>
            </div>
          : null}
          {authState === "out" ?
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" asChild>
                <Link href={loginHref}>Sign In</Link>
              </Button>
              <Button type="button" size="sm" asChild>
                <Link href={registerHref}>Register</Link>
              </Button>
            </div>
          : null}
        </div>
      </div>
    </header>
  );
}
