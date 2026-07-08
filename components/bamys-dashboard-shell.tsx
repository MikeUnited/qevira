"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ClipboardCheck,
  ClipboardList,
  History,
  LayoutGrid,
  Lock,
  Menu,
  Settings,
  ShoppingBag,
  Warehouse,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserAccountNav } from "@/components/layout/user-account-nav";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { useMode } from "@/contexts/mode-context";
import { cn } from "@/lib/utils";
import type { UserProfileData } from "@/lib/server-user-profile";

const KYC_RESTRICTED_HREFS = new Set([
  "/dashboard/sales/inventory",
  "/dashboard/sales/inventory/new-item",
  "/dashboard/sales/inventory/receive-stock",
  "/dashboard/sales/orders",
  "/dashboard/procurement/orders",
  "/dashboard/procurement/approvals",
  "/dashboard/inventory",
]);

type NavMode = "buying" | "selling";

function getNavVisibility(
  profile: UserProfileData,
  teamRole: string | undefined,
  mode: NavMode,
  isDualRole: boolean
): {
  showCatalog: boolean;
  showProcurement: boolean;
  showDivider: boolean;
} {
  /** Dual-role (buyer + supplier) must follow header mode; team-role shortcuts would ignore the toggle. */
  if (isDualRole) {
    return {
      showCatalog: mode === "selling",
      showProcurement: mode === "buying",
      showDivider: false,
    };
  }

  if (
    teamRole === "PHARMACIST" ||
    teamRole === "DIRECTOR" ||
    teamRole === "OWNER"
  ) {
    return {
      showCatalog: false,
      showProcurement: true,
      showDivider: false,
    };
  }

  if (profile.supplierGroup && !profile.customerGroup) {
    return {
      showCatalog: true,
      showProcurement: false,
      showDivider: false,
    };
  }

  if (profile.customerGroup && !profile.supplierGroup) {
    return {
      showCatalog: false,
      showProcurement: true,
      showDivider: false,
    };
  }

  return {
    showCatalog: false,
    showProcurement: true,
    showDivider: false,
  };
}

function isNavActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/marketplace") {
    return pathname === "/marketplace" || pathname.startsWith("/marketplace/");
  }
  if (href === "/dashboard/procurement/approvals") {
    return pathname === "/dashboard/procurement/approvals";
  }
  if (href === "/dashboard") {
    return false;
  }
  return pathname.startsWith(`${href}/`) || pathname === href;
}

type NavLinkItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  indent?: boolean;
  badge?: number;
};

const OVERVIEW_NAV_ITEM: NavLinkItem = {
  href: "/dashboard",
  label: "Overview",
  icon: LayoutGrid,
};

const SETTINGS_NAV_ITEM: NavLinkItem = {
  href: "/dashboard/settings",
  label: "Settings",
  icon: Settings,
};

const CATALOG_NAV_ITEMS: NavLinkItem[] = [
  {
    href: "/dashboard/sales/inventory",
    label: "Inventory",
    icon: Warehouse,
  },
  {
    href: "/dashboard/sales/orders",
    label: "Orders",
    icon: ClipboardList,
  },
];

function buildProcurementNavItems(
  teamRole: string | undefined,
  pendingApprovalsCount: number,
  options?: { includeApprovals?: boolean }
): NavLinkItem[] {
  const links: NavLinkItem[] = [
    {
      href: "/marketplace",
      label: "Marketplace",
      icon: ShoppingBag,
    },
    {
      href: "/dashboard/procurement/orders",
      label: "Order History",
      icon: History,
    },
    {
      href: "/dashboard/inventory",
      label: "My Inventory",
      icon: Warehouse,
    },
  ];
  if (
    options?.includeApprovals ||
    teamRole === "DIRECTOR" ||
    teamRole === "OWNER"
  ) {
    links.push({
      href: "/dashboard/procurement/approvals",
      label: "Approvals",
      icon: ClipboardCheck,
      badge: pendingApprovalsCount,
    });
  }
  return links;
}

function buildDashboardNavTitleEntries(): Array<{ href: string; label: string }> {
  return [
    OVERVIEW_NAV_ITEM,
    ...buildProcurementNavItems(undefined, 0, { includeApprovals: true }),
    ...CATALOG_NAV_ITEMS,
    SETTINGS_NAV_ITEM,
  ].map(({ href, label }) => ({ href, label }));
}

function resolveDashboardPageTitle(pathname: string): string | null {
  const entries = buildDashboardNavTitleEntries();
  if (pathname === "/dashboard") {
    return OVERVIEW_NAV_ITEM.label;
  }
  const sorted = [...entries]
    .filter((e) => e.href !== "/dashboard")
    .sort((a, b) => b.href.length - a.href.length);
  for (const entry of sorted) {
    if (pathname === entry.href || pathname.startsWith(`${entry.href}/`)) {
      return entry.label;
    }
  }
  return null;
}

function NavLinkRow({
  item,
  pathname,
  kycComplete,
  onNavigate,
}: {
  item: NavLinkItem;
  pathname: string;
  kycComplete: boolean;
  onNavigate?: () => void;
}) {
  const { href, label, icon: Icon, badge, indent } = item;
  const active = isNavActive(pathname, href);
  const locked = !kycComplete && KYC_RESTRICTED_HREFS.has(href);

  const linkBody = (
    <>
      <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
      <span className="min-w-0 flex-1">{label}</span>
      {badge !== undefined && badge > 0 ? (
        <Badge
          variant="secondary"
          className="ml-auto shrink-0 px-1.5 py-0 text-[10px] font-semibold tabular-nums"
        >
          {badge}
        </Badge>
      ) : null}
      {locked ? (
        <Lock
          className="text-sidebar-foreground/50 size-3.5 shrink-0"
          aria-hidden
        />
      ) : null}
    </>
  );

  if (locked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
              indent && "pl-7",
              "text-sidebar-foreground/45"
            )}
            tabIndex={0}
            aria-disabled
          >
            {linkBody}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={6}>
          Complete your KYC setup to access this feature
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        indent && "pl-7",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      )}
    >
      <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
      <span className="min-w-0 flex-1">{label}</span>
      {badge !== undefined && badge > 0 ? (
        <Badge
          variant="secondary"
          className="ml-auto shrink-0 px-1.5 py-0 text-[10px] font-semibold tabular-nums"
        >
          {badge}
        </Badge>
      ) : null}
    </Link>
  );
}

function SidebarNav({
  profile,
  kycComplete,
  pendingApprovalsCount,
  onNavigate,
}: {
  profile: UserProfileData;
  kycComplete: boolean;
  pendingApprovalsCount: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { mode, setMode, isDualRole: contextIsDualRole } = useMode();
  const isDualRole = profile.isDualRole || contextIsDualRole;
  const { showProcurement, showCatalog } = getNavVisibility(
    profile,
    profile.teamRole,
    mode,
    isDualRole
  );

  const procurementLinks = React.useMemo(
    () => buildProcurementNavItems(profile.teamRole, pendingApprovalsCount),
    [profile.teamRole, pendingApprovalsCount]
  );

  const catalogLinks = CATALOG_NAV_ITEMS;

  return (
    <TooltipProvider delayDuration={200}>
      <nav className="flex flex-col gap-1">
        {isDualRole ?
          <div className="text-sidebar-foreground mb-3 flex items-center gap-2 px-3">
            <span
              className={cn(
                "text-sm font-medium",
                mode === "buying" ? "font-semibold" : "text-sidebar-foreground/50"
              )}
            >
              Buying
            </span>
            <Switch
              id="bamys-mode"
              checked={mode === "selling"}
              onCheckedChange={(checked) =>
                setMode(checked ? "selling" : "buying")
              }
              aria-label="Toggle between Selling and Buying mode"
            />
            <span
              className={cn(
                "text-sm font-medium",
                mode === "selling" ? "font-semibold" : "text-sidebar-foreground/50"
              )}
            >
              Selling
            </span>
          </div>
        : null}
        <NavLinkRow
          item={OVERVIEW_NAV_ITEM}
          pathname={pathname}
          kycComplete={kycComplete}
          onNavigate={onNavigate}
        />

        <div
          className={cn(
            "transition-all duration-200",
            showProcurement ? "opacity-100" : "opacity-0 hidden"
          )}
          aria-hidden={!showProcurement}
        >
          <div className="text-sidebar-foreground/60 mt-3 px-3 text-xs font-semibold uppercase tracking-wider first:mt-0">
            Procurement
          </div>
          {procurementLinks.map((item) => (
            <NavLinkRow
              key={`${item.href}-${item.label}`}
              item={item}
              pathname={pathname}
              kycComplete={kycComplete}
              onNavigate={onNavigate}
            />
          ))}
        </div>

        <div
          className={cn(
            "transition-all duration-200",
            showCatalog ? "opacity-100" : "opacity-0 hidden"
          )}
          aria-hidden={!showCatalog}
        >
          <div className="text-sidebar-foreground/60 mt-3 px-3 text-xs font-semibold uppercase tracking-wider first:mt-0">
            Catalog
          </div>
          {catalogLinks.map((item) => (
            <NavLinkRow
              key={`${item.href}-${item.label}`}
              item={item}
              pathname={pathname}
              kycComplete={kycComplete}
              onNavigate={onNavigate}
            />
          ))}
        </div>

        <div className="mt-3">
          <NavLinkRow
            item={SETTINGS_NAV_ITEM}
            pathname={pathname}
            kycComplete={kycComplete}
            onNavigate={onNavigate}
          />
        </div>
      </nav>
    </TooltipProvider>
  );
}

export function BamysDashboardShell({
  profile,
  children,
  kycComplete = true,
}: {
  profile: UserProfileData;
  children: React.ReactNode;
  /** When false, KYC-gated nav entries stay visible but disabled. */
  kycComplete?: boolean;
  /** Passed from layout for future use; nav uses `kycComplete` only. */
  kycStep?: number;
}) {
  const pathname = usePathname();
  const pageTitle = React.useMemo(
    () => resolveDashboardPageTitle(pathname),
    [pathname]
  );
  const { setIsDualRole, setMode } = useMode();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [pendingApprovalsCount, setPendingApprovalsCount] = React.useState(0);

  React.useEffect(() => {
    const dual = !!(profile.supplierGroup && profile.customerGroup);
    setIsDualRole(dual);

    const stored = localStorage.getItem("qevira-mode");
    if (!stored) {
      if (profile.supplierGroup && !profile.customerGroup) {
        setMode("selling");
      } else {
        setMode("buying");
      }
    }
  }, [profile.supplierGroup, profile.customerGroup, setIsDualRole, setMode]);

  React.useEffect(() => {
    if (profile.teamRole !== "DIRECTOR" && profile.teamRole !== "OWNER") {
      setPendingApprovalsCount(0);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/team/cart/approvals", {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const j = (await res.json().catch(() => ({}))) as {
          requests?: unknown;
        };
        const list = Array.isArray(j.requests) ? j.requests : [];
        if (!cancelled) setPendingApprovalsCount(list.length);
      } catch {
        if (!cancelled) setPendingApprovalsCount(0);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [profile.teamRole]);

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Link
        href="/dashboard"
        className="flex shrink-0 items-center px-2 no-underline"
      >
        <img
          src="/logo-full.svg"
          alt="Qevira"
          className="h-7 w-auto"
          height={28}
        />
      </Link>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNav
          profile={profile}
          kycComplete={kycComplete}
          pendingApprovalsCount={pendingApprovalsCount}
          onNavigate={() => setMobileOpen(false)}
        />
      </div>
    </div>
  );

  return (
    <div className="bg-background flex min-h-svh w-full">
      {/* Desktop sidebar */}
      <aside className="border-sidebar-border bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r p-4 md:flex">
        {sidebar}
      </aside>

      <div className="flex min-h-svh w-full flex-1 flex-col md:pl-64">
        <header
          className={cn(
            "sticky top-0 z-40 flex h-16 items-center justify-between gap-3 border-b px-4 backdrop-blur md:px-[72px]",
            "border-border bg-background/95 supports-[backdrop-filter]:bg-background/60"
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 md:hidden"
                  aria-label="Open menu"
                >
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="bg-sidebar w-72 p-4 text-sidebar-foreground">
                <SheetHeader className="sr-only">
                  <SheetTitle>Navigation</SheetTitle>
                </SheetHeader>
                <div className="flex h-full flex-col">{sidebar}</div>
              </SheetContent>
            </Sheet>
            {pageTitle ?
              <h1 className="text-foreground min-w-0 truncate text-lg font-semibold tracking-tight">
                {pageTitle}
              </h1>
            : null}
          </div>

          <div className="flex min-h-14 min-w-0 shrink-0 items-center gap-5">
            <NotificationBell />
            <UserAccountNav
              email={profile.email}
              name={
                profile.fullName.trim() ||
                profile.email
              }
              role={
                profile.teamRole ??
                (profile.supplierGroup ? "Supplier" : "Buyer")
              }
            />
          </div>
        </header>

        <main className="flex-1 p-4 md:px-[72px] md:py-6">{children}</main>
      </div>
    </div>
  );
}
