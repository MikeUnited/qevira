"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Boxes,
  DollarSign,
  Package,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";

type ProfileHeader = {
  email: string;
  fullName: string;
};

type OrderListRow = {
  name?: string;
  customer?: string;
  customer_name?: string;
  transaction_date?: string;
  status?: string;
  docstatus?: number;
  grand_total?: number;
};

type OrderLine = {
  item_code: string;
  item_name: string | null;
  qty: number;
};

type OrderDetailPayload = {
  order?: {
    name?: string;
    customer_name?: string;
    docstatus?: number;
    grand_total?: number;
    status?: string;
  };
  lines?: OrderLine[];
};

function formatEtb(n: number): string {
  try {
    return new Intl.NumberFormat("en-ET", {
      style: "currency",
      currency: "ETB",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `ETB ${n.toFixed(2)}`;
  }
}

function parseNum(raw: unknown): number {
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function compareTxnDate(a: string | undefined, b: string | undefined): number {
  const sa = (a ?? "").trim().slice(0, 10);
  const sb = (b ?? "").trim().slice(0, 10);
  if (sa === sb) return 0;
  if (!sa) return 1;
  if (!sb) return -1;
  return sb.localeCompare(sa);
}

function statusBadge(docstatus: number | undefined, statusRaw: unknown) {
  const status =
    typeof statusRaw === "string" ? statusRaw.toLowerCase() : "";
  if (docstatus === 2) {
    return { label: "Cancelled", className: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200" };
  }
  if (docstatus === 1) {
    return {
      label: "Processing",
      className:
        "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
    };
  }
  if (status.includes("submitted")) {
    return {
      label: "Processing",
      className:
        "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
    };
  }
  return {
    label: "New",
    className:
      "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200",
  };
}

type TopProductRow = {
  rank: number;
  itemName: string;
  stock: number;
  estValue: number;
};

export function SupplierDashboard({ profile }: { profile: ProfileHeader }) {
  const router = useRouter();
  const supplierDisplayName =
    profile.fullName?.trim() || profile.email?.trim() || "there";

  const [statsLoading, setStatsLoading] = React.useState(true);
  const [activeOrdersCount, setActiveOrdersCount] = React.useState<
    number | null
  >(null);
  const [productsListed, setProductsListed] = React.useState<number | null>(
    null
  );

  const [recentLoading, setRecentLoading] = React.useState(true);
  const [recentRows, setRecentRows] = React.useState<
    {
      orderId: string;
      buyerName: string;
      firstItemLabel: string;
      qty: number;
      amount: number;
      docstatus: number | undefined;
      status: string | undefined;
    }[]
  >([]);

  const [topLoading, setTopLoading] = React.useState(true);
  const [topProducts, setTopProducts] = React.useState<TopProductRow[]>([]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      setStatsLoading(true);
      setActiveOrdersCount(null);
      setProductsListed(null);
      try {
        const [ordersRes, catRes] = await Promise.all([
          fetch("/api/dashboard/sales/orders", { credentials: "include" }),
          fetch("/api/vendor/catalog/list?pageSize=100", {
            credentials: "include",
          }),
        ]);

        if (!cancelled && ordersRes.ok) {
          const j = (await ordersRes.json()) as { orders?: OrderListRow[] };
          const orders = Array.isArray(j.orders) ? j.orders : [];
          const n = orders.filter((o) => o.docstatus === 1).length;
          setActiveOrdersCount(n);
        } else if (!cancelled) {
          setActiveOrdersCount(null);
        }

        if (!cancelled && catRes.ok) {
          const j = (await catRes.json()) as {
            pagination?: { total?: number };
          };
          const t = j.pagination?.total;
          setProductsListed(typeof t === "number" ? t : null);
        } else if (!cancelled) {
          setProductsListed(null);
        }
      } catch {
        if (!cancelled) {
          setActiveOrdersCount(null);
          setProductsListed(null);
        }
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    }

    void loadStats();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function loadRecent() {
      setRecentLoading(true);
      setRecentRows([]);
      try {
        const res = await fetch("/api/dashboard/sales/orders", {
          credentials: "include",
        });
        if (!res.ok || cancelled) {
          setRecentRows([]);
          return;
        }
        const j = (await res.json()) as { orders?: OrderListRow[] };
        const orders = Array.isArray(j.orders) ? j.orders : [];
        const sorted = [...orders].sort((a, b) =>
          compareTxnDate(a.transaction_date, b.transaction_date)
        );
        const top5 = sorted.slice(0, 5);
        const names = top5
          .map((o) => (typeof o.name === "string" ? o.name.trim() : ""))
          .filter(Boolean);

        const details = await Promise.all(
          names.map(async (orderName) => {
            const dRes = await fetch(
              `/api/dashboard/sales/orders?orderName=${encodeURIComponent(orderName)}`,
              { credentials: "include" }
            );
            if (!dRes.ok) return null;
            return (await dRes.json()) as OrderDetailPayload;
          })
        );

        if (cancelled) return;

        const rows: typeof recentRows = [];
        for (let i = 0; i < top5.length; i++) {
          const summary = top5[i];
          const detail = details[i];
          const orderId =
            typeof summary.name === "string" ? summary.name : "—";
          const buyerName =
            (typeof summary.customer_name === "string" &&
            summary.customer_name.trim()
              ? summary.customer_name
              : typeof summary.customer === "string"
                ? summary.customer
                : "") || "—";
          const lines = detail?.lines ?? [];
          const first = lines[0];
          const firstItemLabel =
            (first?.item_name && first.item_name.trim()) ||
            first?.item_code ||
            "—";
          const qty = first ? first.qty : 0;
          const gtRaw =
            detail?.order?.grand_total ?? summary.grand_total;
          const amount = parseNum(gtRaw);
          rows.push({
            orderId,
            buyerName,
            firstItemLabel,
            qty,
            amount,
            docstatus: summary.docstatus,
            status:
              typeof summary.status === "string" ? summary.status : undefined,
          });
        }
        setRecentRows(rows);
      } catch {
        if (!cancelled) setRecentRows([]);
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    }

    void loadRecent();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function loadTop() {
      setTopLoading(true);
      setTopProducts([]);
      try {
        const res = await fetch("/api/vendor/catalog/list?pageSize=10", {
          credentials: "include",
        });
        if (!res.ok || cancelled) {
          setTopProducts([]);
          return;
        }
        const j = (await res.json()) as {
          items?: Array<{
            itemName: string;
            stock: number;
            price: number;
          }>;
        };
        const items = Array.isArray(j.items) ? j.items : [];
        const sorted = [...items].sort(
          (a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0)
        );
        const top3 = sorted.slice(0, 3);
        const rows: TopProductRow[] = top3.map((it, idx) => ({
          rank: idx + 1,
          itemName: it.itemName || "—",
          stock: Number(it.stock) || 0,
          estValue: (Number(it.stock) || 0) * (Number(it.price) || 0),
        }));
        if (!cancelled) setTopProducts(rows);
      } catch {
        if (!cancelled) setTopProducts([]);
      } finally {
        if (!cancelled) setTopLoading(false);
      }
    }

    void loadTop();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-1 flex-col gap-8 p-4 sm:p-5 md:p-6 lg:p-8">
      <div>
        <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-3xl">
          Supplier Dashboard
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Welcome back, {supplierDisplayName}
        </p>
      </div>

      <section className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* TODO: Calculate from submitted Sales Orders once analytics are built */}
          <StatCard
            label="Revenue (MTD)"
            value="ETB —"
            icon={DollarSign}
            iconClassName="text-emerald-600"
            loading={statsLoading}
          />
          <StatCard
            label="Active Orders"
            value={activeOrdersCount === null ? "—" : activeOrdersCount}
            description="Submitted sales orders"
            icon={ShoppingBag}
            iconClassName="text-primary"
            loading={statsLoading}
          />
          <StatCard
            label="Products Listed"
            value={productsListed === null ? "—" : productsListed}
            description="Items in your catalog"
            icon={Package}
            iconClassName="text-primary"
            loading={statsLoading}
          />
          {/* TODO: Compare MTD vs previous month once analytics are built */}
          <StatCard
            label="Growth"
            value="—"
            icon={TrendingUp}
            iconClassName="text-violet-600"
            loading={statsLoading}
          />
        </div>
      </section>

      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-medium">
          Quick actions
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => router.push("/dashboard/sales/orders")}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex flex-col items-start gap-3 rounded-xl border border-transparent p-5 text-left shadow-sm transition-colors"
          >
            <ShoppingBag className="size-6 text-white" aria-hidden />
            <div>
              <p className="font-semibold">Manage Sales</p>
              <p className="text-primary-foreground/90 mt-0.5 text-sm">
                View and process orders
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard/sales/inventory")}
            className="border-border bg-card hover:bg-muted/50 flex flex-col items-start gap-3 rounded-xl border p-5 text-left shadow-sm transition-colors"
          >
            <Boxes className="text-muted-foreground size-6" aria-hidden />
            <div>
              <p className="text-foreground font-semibold">Inventory</p>
              <p className="text-muted-foreground mt-0.5 text-sm">
                Manage your products
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard/sales/stock")}
            className="border-border bg-card hover:bg-muted/50 flex flex-col items-start gap-3 rounded-xl border p-5 text-left shadow-sm transition-colors"
          >
            <TrendingUp className="text-muted-foreground size-6" aria-hidden />
            <div>
              <p className="text-foreground font-semibold">Stock Levels</p>
              <p className="text-muted-foreground mt-0.5 text-sm">
                Monitor inventory
              </p>
            </div>
          </button>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-foreground text-base font-semibold">
              Recent Orders
            </h2>
            <Link
              href="/dashboard/sales/orders"
              className="text-primary text-sm font-medium hover:underline"
            >
              View all
            </Link>
          </div>
          <Card className="border-border/80 shadow-sm">
            <CardContent className="p-0">
              {recentLoading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-lg" />
                  ))}
                </div>
              ) : recentRows.length === 0 ? (
                <p className="text-muted-foreground p-6 text-sm">
                  No recent orders
                </p>
              ) : (
                <ul className="divide-border divide-y">
                  {recentRows.map((row) => {
                    const sb = statusBadge(row.docstatus, row.status);
                    return (
                      <li key={row.orderId} className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-mono text-sm font-bold">
                              {row.orderId}
                            </p>
                            <p className="text-muted-foreground mt-1 text-sm">
                              {row.buyerName}
                            </p>
                            <p className="text-foreground mt-2 text-sm">
                              {row.firstItemLabel}
                            </p>
                            <p className="text-muted-foreground mt-0.5 text-xs">
                              Qty: {row.qty}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <Badge
                              className={cn(
                                "border-0 font-medium",
                                sb.className
                              )}
                            >
                              {sb.label}
                            </Badge>
                            <p className="text-primary font-mono text-sm font-semibold tabular-nums">
                              {formatEtb(row.amount)}
                            </p>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-foreground mb-3 text-base font-semibold">
            Top Products (MTD)
          </h2>
          <Card className="border-border/80 shadow-sm">
            <CardContent className="p-0">
              {topLoading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 w-full rounded-lg" />
                  ))}
                </div>
              ) : topProducts.length === 0 ? (
                <div className="p-6 text-sm">
                  <p className="text-muted-foreground">No products listed yet</p>
                  <Link
                    href="/dashboard/sales"
                    className="text-primary mt-2 inline-block font-medium hover:underline"
                  >
                    Go to sales
                  </Link>
                </div>
              ) : (
                <ul className="divide-border divide-y">
                  {topProducts.map((p) => (
                    <li key={p.rank} className="flex gap-3 p-4">
                      <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                        #{p.rank}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground font-medium">
                          {p.itemName}
                        </p>
                        <p className="text-muted-foreground mt-2 text-xs">
                          Units in Stock
                        </p>
                        <p className="text-foreground text-sm font-bold tabular-nums">
                          {p.stock.toLocaleString()}
                        </p>
                        <p className="text-muted-foreground mt-2 text-xs">
                          Est. Value
                        </p>
                        <p className="font-mono text-sm font-semibold tabular-nums text-emerald-600">
                          {formatEtb(p.estValue)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
      {/* TODO: Replace with real MTD sales data once analytics are built */}
    </div>
  );
}
