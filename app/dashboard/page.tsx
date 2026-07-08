"use client";

import * as React from "react";
import Link from "next/link";
import {
  ClipboardCheck,
  Package,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";

import { KycStatusBanner } from "@/components/dashboard/kyc-status-banner";
import { SupplierDashboard } from "@/components/dashboard/supplier-dashboard";
import { OrderStatusBadge } from "@/components/ui/order-status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { useMode } from "@/contexts/mode-context";
import type { DashboardUserProfile } from "@/types/marketplace";

type ProfilePayload = DashboardUserProfile & {
  email?: string;
  fullName?: string;
  isDualRole?: boolean;
  teamRole?: "OWNER" | "DIRECTOR" | "PHARMACIST" | null;
};

type ProfileForHeader = {
  email: string;
  fullName: string;
};

type ProcurementOrderRow = {
  orderId?: string;
  docstatus?: unknown;
  status?: string | null;
  date?: string | null;
  grandTotal?: unknown;
};

function docstatusNum(raw: unknown): number {
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number.parseInt(raw, 10);
    return Number.isNaN(n) ? -1 : n;
  }
  return -1;
}

function formatGrandTotal(raw: unknown): string {
  if (typeof raw === "number" && !Number.isNaN(raw)) {
    return `ETB ${raw.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw);
    if (!Number.isNaN(n)) {
      return `ETB ${n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
  }
  return "—";
}

function BuyerDashboardPanel({
  profile,
}: {
  profile: ProfilePayload;
}) {
  const [loading, setLoading] = React.useState(true);
  const [cartCount, setCartCount] = React.useState<number | null>(null);
  const [pendingOrders, setPendingOrders] = React.useState<number | null>(
    null
  );
  const [approvedOrders, setApprovedOrders] = React.useState<number | null>(
    null
  );
  const [pendingApprovals, setPendingApprovals] = React.useState<number | null>(
    null
  );
  const [recentOrders, setRecentOrders] = React.useState<ProcurementOrderRow[]>(
    []
  );

  const showApprovalsCard =
    profile.teamRole === "DIRECTOR" || profile.teamRole === "OWNER";

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const cartP = fetch("/api/marketplace/cart", {
          credentials: "include",
        });
        const ordersP = fetch("/api/dashboard/procurement/orders", {
          credentials: "include",
        });
        const approvalsP =
          showApprovalsCard ?
            fetch("/api/team/cart/approvals", { credentials: "include" })
          : Promise.resolve(null);

        const [cartRes, ordersRes, approvalsRes] = await Promise.all([
          cartP,
          ordersP,
          approvalsP,
        ]);

        if (cancelled) return;

        if (cartRes.ok) {
          const rows = (await cartRes.json().catch(() => [])) as unknown;
          setCartCount(Array.isArray(rows) ? rows.length : 0);
        } else {
          setCartCount(null);
        }

        if (ordersRes.ok) {
          const j = (await ordersRes.json().catch(() => ({}))) as {
            orders?: ProcurementOrderRow[];
          };
          const orders = Array.isArray(j.orders) ? j.orders : [];
          setPendingOrders(
            orders.filter((o) => docstatusNum(o.docstatus) === 0).length
          );
          setApprovedOrders(
            orders.filter((o) => docstatusNum(o.docstatus) === 1).length
          );
          setRecentOrders(orders.slice(0, 5));
        } else {
          setPendingOrders(null);
          setApprovedOrders(null);
          setRecentOrders([]);
        }

        if (approvalsRes && approvalsRes.ok) {
          const j = (await approvalsRes.json().catch(() => ({}))) as {
            requests?: unknown[];
          };
          setPendingApprovals(
            Array.isArray(j.requests) ? j.requests.length : 0
          );
        } else if (showApprovalsCard) {
          setPendingApprovals(null);
        } else {
          setPendingApprovals(null);
        }
      } catch {
        if (!cancelled) {
          setCartCount(null);
          setPendingOrders(null);
          setApprovedOrders(null);
          setPendingApprovals(null);
          setRecentOrders([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [showApprovalsCard]);

  const approvalsUrgent =
    pendingApprovals !== null && pendingApprovals > 0;

  const statCards = (
    <>
      {showApprovalsCard ?
        <StatCard
          label="Pending approvals"
          value={pendingApprovals === null ? "—" : pendingApprovals}
          icon={ClipboardCheck}
          loading={loading}
          iconClassName={
            approvalsUrgent ?
              "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground"
          }
          className={
            approvalsUrgent ?
              "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/25"
            : undefined
          }
        />
      : null}
      <StatCard
        label="Pending orders"
        value={pendingOrders === null ? "—" : pendingOrders}
        description="Draft / processing (docstatus 0)"
        icon={Package}
        loading={loading}
      />
      <StatCard
        label="Approved orders"
        value={approvedOrders === null ? "—" : approvedOrders}
        description="Confirmed (docstatus 1)"
        icon={ShoppingBag}
        iconClassName="text-emerald-600 dark:text-emerald-500"
        loading={loading}
      />
      <StatCard
        label="Cart items"
        value={cartCount === null ? "—" : cartCount}
        icon={ShoppingCart}
        loading={loading}
      />
    </>
  );

  return (
    <div className="flex flex-1 flex-col gap-8 p-4 sm:p-5 md:p-6 lg:p-8">
      <div>
        <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-3xl">
          Buyer dashboard
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Procurement overview
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-muted-foreground text-sm font-medium">
          Quick stats
        </h2>
        <div
          className={`grid gap-4 sm:grid-cols-2 ${showApprovalsCard ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}
        >
          {statCards}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-foreground text-base font-semibold">
            Recent procurement orders
          </h2>
          <Link
            href="/dashboard/procurement/orders"
            className="text-primary text-sm font-medium hover:underline"
          >
            View all
          </Link>
        </div>
        <Card className="border-border/80 shadow-sm">
          <CardContent className="p-0">
            {loading ?
              <div className="space-y-3 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            : recentOrders.length === 0 ?
              <p className="text-muted-foreground p-6 text-sm">No orders yet</p>
            : <ul className="divide-border divide-y">
                {recentOrders.map((row, idx) => (
                  <li
                    key={
                      typeof row.orderId === "string" && row.orderId ?
                        row.orderId
                      : `order-${idx}`
                    }
                    className="p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-semibold">
                          {row.orderId ?? "—"}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {row.date != null ?
                            String(row.date).slice(0, 10)
                          : "—"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <OrderStatusBadge
                          status={
                            typeof row.status === "string" && row.status.trim() ?
                              row.status.trim()
                            : "Processing"
                          }
                        />
                        <p className="text-primary font-mono text-sm tabular-nums">
                          {formatGrandTotal(row.grandTotal)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            }
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export default function DashboardOverviewPage() {
  const { mode, setMode, setIsDualRole } = useMode();
  const [isLoading, setIsLoading] = React.useState(true);
  const [profile, setProfile] = React.useState<ProfilePayload | null>(null);
  const [supplierProfile, setSupplierProfile] =
    React.useState<ProfileForHeader | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const profileRes = await fetch("/api/user/profile", {
          credentials: "include",
        });
        if (!profileRes.ok) {
          if (!cancelled) setProfile(null);
          return;
        }

        const p = (await profileRes.json()) as ProfilePayload;
        if (cancelled) return;
        setProfile(p);

        const hasSupplier = p.supplierGroup != null;
        if (hasSupplier) {
          setSupplierProfile({
            email: typeof p.email === "string" ? p.email : "",
            fullName:
              typeof p.fullName === "string" ? p.fullName : "",
          });
        } else {
          setSupplierProfile(null);
        }
      } catch {
        if (!cancelled) setProfile(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!profile) return;

    const hasSupplier = profile.supplierGroup != null;
    const hasCustomer = profile.customerGroup != null;
    const dual = !!(hasSupplier && hasCustomer);
    setIsDualRole(dual);

    if (hasSupplier && !hasCustomer) {
      setMode("selling");
    } else if (hasCustomer && !hasSupplier) {
      setMode("buying");
    } else if (dual) {
      const stored = localStorage.getItem("qevira-mode");
      if (stored !== "buying" && stored !== "selling") {
        setMode("buying");
      }
    }
  }, [profile, setIsDualRole, setMode]);

  const hasSupplier = profile?.supplierGroup != null;
  const hasCustomer = profile?.customerGroup != null;
  const showSelling = mode === "selling" && hasSupplier;
  const showBuying = mode === "buying" && hasCustomer;

  if (!isLoading && !profile) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <KycStatusBanner />
        <p className="text-muted-foreground text-sm">
          Could not load your profile.
        </p>
      </div>
    );
  }

  if (!isLoading && profile && !hasSupplier && !hasCustomer) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <KycStatusBanner />
        <p className="text-muted-foreground text-sm">
          Sign in as a buyer or supplier to see your dashboard.
        </p>
      </div>
    );
  }

  if (!isLoading && showSelling && supplierProfile) {
    return (
      <div className="flex flex-1 flex-col">
        <KycStatusBanner />
        <SupplierDashboard profile={supplierProfile} />
      </div>
    );
  }

  if (!isLoading && showBuying && profile) {
    return (
      <div className="flex flex-1 flex-col">
        <KycStatusBanner />
        <BuyerDashboardPanel profile={profile} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:gap-8 sm:p-5 md:gap-10 md:p-6 lg:gap-12 lg:p-8">
      <KycStatusBanner />
      <section className="space-y-4">
        <Skeleton className="h-9 w-48 rounded-md md:h-10" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </section>
    </div>
  );
}
