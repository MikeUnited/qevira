"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  CheckCircle,
  CreditCard,
  FileText,
  Loader2,
  MapPin,
  Package,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { handleUnauthorized } from "@/lib/handle-unauthorized";
import { cn } from "@/lib/utils";

type PreviewItem = {
  cartItemId: string;
  genericName: string;
  qty: number;
  price: number;
  batchExpiry: string | null;
  stockWarning: boolean;
  isExpired: boolean;
  availableQty?: number;
};

type VendorGroup = {
  supplierName: string;
  items: PreviewItem[];
  /** When present from preview API, shared across checkout; same as SO delivery_date. */
  delivery_date?: string;
};

type PreviewPayload = {
  summary: { totalAmount: number; itemCount: number };
  vendors: VendorGroup[];
};

function formatMoney(n: number) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function parseDay(iso: string): Date | null {
  const s = iso.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatLongDate(iso: string): string {
  const d = parseDay(iso);
  if (!d) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(d);
}

/** e.g. Apr 12, 2026 — for confirmation stats and summary */
function formatMediumDate(iso: string): string {
  const d = parseDay(iso);
  if (!d) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

type ConfirmationSnapshot = {
  summary: { totalAmount: number; itemCount: number };
  groups: { alias: string; items: PreviewItem[] }[];
};

function formatEtbCheckout(n: number): string {
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

function groupItemsByVendorAlias(
  vendors: VendorGroup[],
  cartLineById: Map<string, { vendorAlias: string; uom: string }>
): { alias: string; items: PreviewItem[] }[] {
  const m = new Map<string, PreviewItem[]>();
  for (const v of vendors) {
    for (const item of v.items) {
      const alias =
        cartLineById.get(item.cartItemId)?.vendorAlias ?? v.supplierName;
      const list = m.get(alias) ?? [];
      list.push(item);
      m.set(alias, list);
    }
  }
  return [...m.entries()]
    .sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    )
    .map(([alias, items]) => ({ alias, items }));
}

function estimatedDeliveryIsoFromPreview(
  vendors: VendorGroup[]
): string | null {
  const dd = vendors[0]?.delivery_date?.trim().slice(0, 10);
  if (dd && /^\d{4}-\d{2}-\d{2}$/.test(dd)) return dd;
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function CheckoutSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
        <Skeleton className="h-56 w-full rounded-xl lg:sticky lg:top-24" />
      </div>
    </div>
  );
}

export default function MarketplaceCheckoutPage() {
  const router = useRouter();
  const authFetch = useAuthFetch();
  const authFetchRef = React.useRef(authFetch);
  authFetchRef.current = authFetch;
  const idempotencyKey = React.useMemo(() => crypto.randomUUID(), []);
  const [data, setData] = React.useState<PreviewPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [orderConfirmed, setOrderConfirmed] = React.useState(false);
  const [confirmedOrders, setConfirmedOrders] = React.useState<string[]>([]);
  /** ISO date (YYYY-MM-DD) aligned with order API transaction/delivery_date at placement time. */
  const [confirmedDeliveryDate, setConfirmedDeliveryDate] = React.useState<
    string | null
  >(null);
  const [teamRole, setTeamRole] = React.useState<
    "OWNER" | "DIRECTOR" | "PHARMACIST" | null | undefined
  >(undefined);
  const [approvalRequestSent, setApprovalRequestSent] = React.useState(false);
  const [recipientName, setRecipientName] = React.useState("");
  const [cartLineById, setCartLineById] = React.useState<
    Map<string, { vendorAlias: string; uom: string }>
  >(() => new Map());

  /** Captured on successful order before preview is cleared — for confirmation UI only. */
  const confirmationSnapshotRef = React.useRef<ConfirmationSnapshot | null>(
    null
  );

  const loadPreview = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await authFetchRef.current("/api/marketplace/checkout/preview");
      if (res.status === 401) {
        return;
      }
      const json = (await res.json().catch(() => ({}))) as
        | PreviewPayload
        | { error?: string };

      if (!res.ok) {
        const msg =
          typeof (json as { error?: string }).error === "string"
            ? (json as { error: string }).error
            : "Could not load checkout preview.";
        throw new Error(msg);
      }

      setData(json as PreviewPayload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Preview failed.";
      setLoadError(msg);
      toast.error(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    async function loadMe() {
      try {
        const res = await authFetchRef.current("/api/auth/me");
        if (!res.ok) {
          if (!cancelled) setTeamRole(null);
          return;
        }
        const json = (await res.json().catch(() => ({}))) as {
          authenticated?: boolean;
          teamRole?: string | null;
        };
        if (cancelled) return;
        if (json.authenticated !== true) {
          handleUnauthorized(
            typeof window !== "undefined"
              ? `${window.location.pathname}${window.location.search}`
              : "/marketplace/checkout"
          );
          return;
        }
        const tr = json.teamRole;
        if (tr === "OWNER" || tr === "DIRECTOR" || tr === "PHARMACIST") {
          setTeamRole(tr);
        } else {
          setTeamRole(null);
        }
      } catch {
        if (!cancelled) setTeamRole(null);
      }
    }
    void loadMe();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRequestApproval() {
    setIsSubmitting(true);
    try {
      const res = await authFetchRef.current("/api/team/cart/request-approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.status === 401) {
        return;
      }
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };

      if (res.ok) {
        setApprovalRequestSent(true);
        toast.success(
          typeof json.message === "string" && json.message.trim()
            ? json.message.trim()
            : "Approval request sent to your organization's directors."
        );
        return;
      }

      if (res.status === 409) {
        const msg =
          typeof json.error === "string" && json.error.trim()
            ? json.error.trim()
            : "You already have a pending approval request.";
        toast.info(msg);
        return;
      }

      const msg =
        typeof json.error === "string" && json.error.trim()
          ? json.error.trim()
          : "Request could not be sent.";
      toast.error(msg);
    } catch {
      toast.error("Request could not be sent. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmPurchase() {
    setIsSubmitting(true);
    try {
      const res = await authFetchRef.current("/api/marketplace/checkout/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-idempotency-key": idempotencyKey,
        },
      });
      if (res.status === 401) {
        return;
      }
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        orders?: unknown;
      };

      if (res.ok && json.ok === true) {
        const raw = json.orders;
        const ids = Array.isArray(raw)
          ? raw.filter((x): x is string => typeof x === "string")
          : [];
        if (data) {
          confirmationSnapshotRef.current = {
            summary: data.summary,
            groups: groupItemsByVendorAlias(data.vendors, cartLineById),
          };
        } else {
          confirmationSnapshotRef.current = null;
        }
        const fromPreview = data?.vendors?.[0]?.delivery_date?.trim().slice(0, 10);
        const deliveryIso =
          fromPreview && /^\d{4}-\d{2}-\d{2}$/.test(fromPreview)
            ? fromPreview
            : new Date().toISOString().slice(0, 10);
        setConfirmedOrders(ids);
        setConfirmedDeliveryDate(deliveryIso);
        setOrderConfirmed(true);
        setData({
          summary: { totalAmount: 0, itemCount: 0 },
          vendors: [],
        });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("bamys-cart-updated"));
        }
        toast.success(
          "Order placed successfully. Your orders are pending review."
        );
        return;
      }

      const msg =
        typeof json.error === "string" && json.error.trim()
          ? json.error.trim()
          : "Order could not be placed.";
      toast.error(msg);
    } catch {
      toast.error("Order could not be placed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  React.useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await authFetchRef.current("/api/user/profile");
      if (!res.ok || cancelled) return;
      const j = (await res.json().catch(() => ({}))) as {
        fullName?: string;
      };
      if (
        typeof j.fullName === "string" &&
        j.fullName.trim() &&
        !cancelled
      ) {
        setRecipientName(j.fullName.trim());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!data?.vendors?.length) return;
    let cancelled = false;
    (async () => {
      const res = await authFetchRef.current("/api/marketplace/cart");
      if (!res.ok || cancelled) return;
      const rows = (await res.json().catch(() => [])) as {
        id: string;
        vendorAlias: string;
        uom: string;
      }[];
      if (!Array.isArray(rows) || cancelled) return;
      setCartLineById(
        new Map(
          rows.map((r) => [
            r.id,
            { vendorAlias: r.vendorAlias, uom: r.uom },
          ])
        )
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  const hasBlockingIssue = React.useMemo(() => {
    if (!data?.vendors?.length) return false;
    for (const v of data.vendors) {
      for (const item of v.items) {
        if (item.isExpired || item.stockWarning) return true;
      }
    }
    return false;
  }, [data]);

  const disableReason = React.useMemo(() => {
    if (!data?.vendors?.length) return "";
    const flat = data.vendors.flatMap((v) => v.items);
    const expired = flat.some((i) => i.isExpired);
    const low = flat.some((i) => i.stockWarning);
    const parts: string[] = [];
    if (expired) {
      parts.push(
        "Remove expired items using the control on each line, or re-add them from the marketplace."
      );
    }
    if (low) {
      parts.push(
        "One or more items have insufficient stock in the supplier warehouse."
      );
    }
    return parts.join(" ");
  }, [data]);

  const confirmDisabled = loading || !data || hasBlockingIssue;
  const sessionRolePending = teamRole === undefined;
  const showDirectorApprovalFlow = teamRole === "PHARMACIST";

  return (
    <TooltipProvider delayDuration={200}>
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
        {!orderConfirmed ? (
          <>
            <div className="mb-6">
              <Link
                href="/marketplace/cart"
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm font-medium transition-colors"
              >
                <ArrowLeft className="size-4" aria-hidden />
                Back to Cart
              </Link>
            </div>

            <h1 className="text-foreground mb-8 text-2xl font-semibold tracking-tight">
              Checkout
            </h1>
          </>
        ) : null}

        {orderConfirmed ? (
          <div className="mx-auto w-full max-w-[600px] px-2 py-6 md:px-6 md:py-10">
            {(() => {
              const snap = confirmationSnapshotRef.current;
              const totalItems = snap?.summary.itemCount ?? 0;
              const grandTotal = snap?.summary.totalAmount ?? 0;
              const deliveryLabel =
                confirmedDeliveryDate &&
                parseDay(confirmedDeliveryDate)
                  ? formatMediumDate(confirmedDeliveryDate)
                  : "1-3 business days";

              const orderRows = confirmedOrders.map((orderId, i) => {
                const g = snap?.groups[i];
                const subtotal = g
                  ? g.items.reduce((acc, x) => acc + x.price * x.qty, 0)
                  : 0;
                const lineItems = g?.items.length ?? 0;
                const alias =
                  g?.alias?.trim() && g.alias.trim().length > 0
                    ? g.alias.trim()
                    : null;
                return {
                  orderId,
                  subtotal,
                  lineItems,
                  supplierLine: alias
                    ? `Supplier: ${alias}`
                    : "Supplier: Verified Supplier",
                };
              });

              return (
                <div className="space-y-8">
                  <div className="text-center">
                    <div className="flex justify-center">
                      <div
                        className="flex size-20 shrink-0 items-center justify-center rounded-full bg-primary"
                        aria-hidden
                      >
                        <CheckCircle className="text-primary-foreground size-10" />
                      </div>
                    </div>
                    <h1 className="text-foreground mt-6 text-2xl font-bold tracking-tight md:text-3xl">
                      Order Confirmed!
                    </h1>
                    <p className="text-muted-foreground mx-auto mt-3 max-w-md text-sm leading-relaxed md:text-base">
                      Your order has been successfully placed and is being
                      processed
                    </p>
                  </div>

                  <Card className="border-border overflow-hidden shadow-sm">
                    <CardContent className="p-0">
                      <div className="grid grid-cols-3 divide-x divide-gray-200 border-b border-gray-200">
                        <div className="flex flex-col items-center gap-2 px-3 py-5 text-center sm:px-4">
                          <Package
                            className="size-6 text-primary"
                            aria-hidden
                          />
                          <span className="text-muted-foreground text-xs sm:text-sm">
                            Total Items
                          </span>
                          <span className="text-foreground text-2xl font-bold tabular-nums sm:text-3xl">
                            {totalItems}
                          </span>
                        </div>
                        <div className="flex flex-col items-center gap-2 px-3 py-5 text-center sm:px-4">
                          <FileText
                            className="size-6 text-primary"
                            aria-hidden
                          />
                          <span className="text-muted-foreground text-xs sm:text-sm">
                            Order Count
                          </span>
                          <span className="text-foreground text-2xl font-bold tabular-nums sm:text-3xl">
                            {confirmedOrders.length}
                          </span>
                        </div>
                        <div className="flex flex-col items-center gap-2 px-3 py-5 text-center sm:px-4">
                          <Calendar
                            className="size-6 text-primary"
                            aria-hidden
                          />
                          <span className="text-muted-foreground text-xs sm:text-sm">
                            Expected Delivery
                          </span>
                          <span className="text-foreground text-center text-base font-bold leading-tight sm:text-lg">
                            {deliveryLabel}
                          </span>
                        </div>
                      </div>

                      <div className="p-4 sm:p-5">
                        <h2 className="text-foreground mb-4 text-left text-base font-semibold">
                          Order IDs
                        </h2>
                        <ul className="divide-y divide-gray-100">
                          {orderRows.map((row) => (
                            <li
                              key={row.orderId}
                              className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="min-w-0 text-left">
                                <p className="font-mono text-sm font-semibold text-primary break-all sm:text-base">
                                  {row.orderId}
                                </p>
                                <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
                                  {row.supplierLine}
                                </p>
                              </div>
                              <div className="shrink-0 text-left sm:text-right">
                                <p className="font-mono text-sm font-bold tabular-nums text-[#0a0a0a] dark:text-foreground sm:text-base">
                                  {formatEtbCheckout(row.subtotal)}
                                </p>
                                <p className="text-muted-foreground mt-0.5 text-xs">
                                  {row.lineItems}{" "}
                                  {row.lineItems === 1 ? "item" : "items"}
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>

                        <div className="bg-primary/10 dark:bg-primary/20 mt-4 rounded-lg px-4 py-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="text-foreground font-semibold">
                                Grand Total:
                              </p>
                              <p className="text-muted-foreground mt-1 text-xs leading-snug">
                                Amount excludes tax — invoice will be sent by
                                supplier
                              </p>
                            </div>
                            <p className="font-mono text-xl font-bold tabular-nums text-primary sm:text-2xl">
                              {formatEtbCheckout(grandTotal)}
                            </p>
                          </div>
                        </div>

                        <div className="border-primary/20 bg-primary/5 dark:border-primary/30 dark:bg-primary/10 mt-4 rounded-lg border px-4 py-3">
                          <p className="text-primary text-sm font-semibold dark:text-primary">
                            Expected Delivery: {deliveryLabel}
                          </p>
                          <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                            Your suppliers will fulfill orders independently.
                            Delivery timelines may vary per supplier.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Button
                      type="button"
                      size="lg"
                      className="h-11 w-full"
                      onClick={() =>
                        router.push("/dashboard/procurement/orders")
                      }
                    >
                      View Order History
                    </Button>
                    <Button
                      type="button"
                      size="lg"
                      variant="outline"
                      className="h-11 w-full"
                      onClick={() => router.push("/marketplace")}
                    >
                      Continue Shopping
                    </Button>
                  </div>

                  <div className="text-left">
                    <h2 className="text-foreground text-base font-semibold">
                      What happens next?
                    </h2>
                    <ol className="mt-4 space-y-3 text-sm leading-relaxed">
                      {[
                        "Suppliers will review and confirm your order",
                        "You will receive email updates on order status",
                        "Track delivery status in your order history",
                        "Contact support if an order becomes overdue",
                      ].map((text, idx) => (
                        <li key={idx} className="flex gap-3">
                          <span className="shrink-0 font-semibold text-primary tabular-nums">
                            {idx + 1}.
                          </span>
                          <span className="text-foreground">{text}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : loading ? (
          <CheckoutSkeleton />
        ) : loadError ? (
          <Card className="border-destructive/40">
            <CardContent className="py-8 text-center text-sm">
              <p className="text-destructive mb-4">{loadError}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : !data || data.vendors.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <p className="text-muted-foreground text-sm">
                Your cart is empty.
              </p>
              <Button asChild size="lg" type="button">
                <Link href="/marketplace">Continue Shopping</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,60%)_minmax(280px,35%)] lg:items-start">
            <div className="space-y-6">
              <Card className="border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <MapPin className="size-5 shrink-0 text-primary" />
                    Delivery Address
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-foreground font-medium">
                    {recipientName || "—"}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    Address details will be confirmed with supplier
                  </p>
                </CardContent>
              </Card>

              <Card className="border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <CreditCard className="size-5 shrink-0 text-primary" />
                    Payment Method
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="border-primary bg-primary/10 dark:bg-primary/20 rounded-lg border-2 p-4">
                    <p className="text-foreground font-medium">Bank Transfer</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Pay via bank transfer. Invoice will be sent after order
                      confirmation.
                    </p>
                  </div>
                  <div
                    className="text-muted-foreground pointer-events-none rounded-lg border border-dashed p-3 text-sm opacity-60"
                    aria-disabled
                  >
                    Credit/Debit Card — Coming soon
                  </div>
                  <div
                    className="text-muted-foreground pointer-events-none rounded-lg border border-dashed p-3 text-sm opacity-60"
                    aria-disabled
                  >
                    Credit Terms (Net 30) — Coming soon
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg font-semibold tracking-tight">
                    Order Items
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-8 pt-0">
                  {groupItemsByVendorAlias(data.vendors, cartLineById).map(
                    (group, gi) => (
                      <div key={`${group.alias}-${gi}`}>
                        <div className="flex items-center gap-2.5">
                          <CheckCircle
                            className="size-5 shrink-0 text-green-600"
                            aria-hidden
                          />
                          <span className="text-foreground text-sm font-semibold">
                            Supplier: {group.alias}
                          </span>
                        </div>
                        <div className="mt-3 border-b border-gray-100" />
                        <ul className="mt-5 space-y-3">
                          {group.items.map((item) => (
                            <li
                              key={item.cartItemId}
                              className={cn(
                                "rounded-lg p-4 transition-colors",
                                item.isExpired
                                  ? "bg-amber-50/90 dark:bg-amber-950/25"
                                  : "bg-slate-50 dark:bg-slate-900/40"
                              )}
                            >
                              <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0 flex-1 space-y-1">
                                  <p className="text-[15px] font-bold leading-snug text-[#0a0a0a] dark:text-foreground">
                                    {item.genericName}
                                  </p>
                                  <p className="text-[13px] leading-snug text-[#6b7280]">
                                    {cartLineById.get(item.cartItemId)?.uom ??
                                      "—"}{" "}
                                    × {item.qty}
                                  </p>
                                  {item.batchExpiry && !item.isExpired && (
                                    <p className="text-[12px] tabular-nums text-[#6b7280]">
                                      Earliest batch expiry: {item.batchExpiry}
                                    </p>
                                  )}
                                </div>
                                <p className="shrink-0 text-base font-bold tabular-nums text-[#0a0a0a] dark:text-foreground">
                                  {formatEtbCheckout(item.price * item.qty)}
                                </p>
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                {item.isExpired && (
                                  <span className="rounded-md border border-amber-600/40 bg-amber-100/80 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                                    Price expired
                                  </span>
                                )}
                                {item.stockWarning && (
                                  <Badge
                                    variant="destructive"
                                    className="font-medium"
                                  >
                                    Low stock
                                    {item.availableQty !== undefined ? (
                                      <span className="ml-1 tabular-nums">
                                        ({item.availableQty} available)
                                      </span>
                                    ) : null}
                                  </Badge>
                                )}
                              </div>
                              {item.isExpired && (
                                <p className="text-amber-900 dark:text-amber-100/90 mt-3 text-sm">
                                  ⚠ Price expired. Please re-add this item from
                                  the marketplace.
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  )}
                </CardContent>
              </Card>
            </div>

            <aside className="lg:sticky lg:top-24">
              <Card className="border-border shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">Order Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-mono tabular-nums">
                      {formatEtbCheckout(data.summary.totalAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">Tax:</span>
                    <span className="text-muted-foreground max-w-[12rem] text-right text-xs">
                      Calculated at invoice
                    </span>
                  </div>
                  {/* TODO: Implement tax calculation based on Ethiopian VAT rules before beta launch */}
                  <div className="border-border flex justify-between gap-4 border-t pt-4">
                    <span className="font-medium">Total</span>
                    <span className="text-primary font-mono text-xl font-semibold tabular-nums">
                      {formatEtbCheckout(data.summary.totalAmount)}
                    </span>
                  </div>

                  <div className="border-primary/20 bg-primary/5 dark:border-primary/30 dark:bg-primary/10 rounded-lg border px-3 py-2.5 text-sm">
                    <p className="text-foreground font-medium">
                      Expected Delivery:{" "}
                      {formatLongDate(
                        estimatedDeliveryIsoFromPreview(data.vendors) ??
                          new Date().toISOString().slice(0, 10)
                      )}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Orders are typically fulfilled within 1–3 business days
                    </p>
                  </div>

                  <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-xs text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                    ⚠ Please review all items carefully. You may request
                    cancellation if an order becomes overdue.
                  </div>

                  {showDirectorApprovalFlow ? (
                    <div className="space-y-3">
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        As a Pharmacist, you cannot place orders directly.
                        Submit this cart for Director approval.
                      </p>
                      {confirmDisabled && !loading && data ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex w-full">
                              <Button
                                className="h-11 w-full"
                                size="lg"
                                disabled
                                type="button"
                              >
                                Request Director Approval
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            className="max-w-xs text-balance"
                          >
                            {disableReason ||
                              "Complete checkout requirements to continue."}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <Button
                          className="h-11 w-full"
                          size="lg"
                          type="button"
                          disabled={
                            loading ||
                            sessionRolePending ||
                            isSubmitting ||
                            approvalRequestSent
                          }
                          onClick={() => void handleRequestApproval()}
                        >
                          {isSubmitting ? (
                            <>
                              <Loader2
                                className="mr-2 size-4 animate-spin"
                                aria-hidden
                              />
                              Sending…
                            </>
                          ) : approvalRequestSent ? (
                            "Awaiting director approval…"
                          ) : (
                            "Request Director Approval"
                          )}
                        </Button>
                      )}
                    </div>
                  ) : confirmDisabled && !loading && data ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex w-full">
                          <Button
                            className="h-11 w-full"
                            size="lg"
                            disabled
                            type="button"
                          >
                            Place Order
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="max-w-xs text-balance"
                      >
                        {disableReason ||
                          "Complete checkout requirements to continue."}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button
                      className="h-11 w-full"
                      size="lg"
                      type="button"
                      disabled={
                        loading || sessionRolePending || isSubmitting
                      }
                      onClick={() => void handleConfirmPurchase()}
                    >
                      {sessionRolePending ? (
                        <>
                          <Loader2
                            className="mr-2 size-4 animate-spin"
                            aria-hidden
                          />
                          Checking account…
                        </>
                      ) : isSubmitting ? (
                        <>
                          <Loader2
                            className="mr-2 size-4 animate-spin"
                            aria-hidden
                          />
                          Placing order…
                        </>
                      ) : (
                        "Place Order"
                      )}
                    </Button>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="h-11 w-full"
                    onClick={() => router.push("/marketplace/cart")}
                  >
                    Back to Cart
                  </Button>
                </CardContent>
              </Card>
            </aside>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
