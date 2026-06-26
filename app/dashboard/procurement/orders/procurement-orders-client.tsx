"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OrderStatusBadge } from "@/components/ui/order-status-badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatOverdueText, isOrderOverdue } from "@/lib/order-overdue";
import { cn } from "@/lib/utils";

type OrderItem = {
  genericName: string;
  vendorAlias: string;
  quantity: number;
  price: number;
  uom: string;
};

type ProcurementOrder = {
  orderId: string;
  date: unknown;
  /** Preferred when API returns it; falls back to `date` for display. */
  delivery_date?: unknown;
  status: string;
  docstatus: unknown;
  grandTotal: unknown;
  items: OrderItem[];
};

function parseMoney(raw: unknown): number | null {
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function formatEtb(n: number): string {
  try {
    return new Intl.NumberFormat("en-ET", {
      style: "currency",
      currency: "ETB",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ETB`;
  }
}

function formatDate(raw: unknown): string {
  if (raw == null) return "—";
  const s = typeof raw === "string" ? raw.trim() : String(raw);
  if (!s) return "—";
  const d = new Date(s.includes("T") ? s : `${s.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseCalendarDay(raw: unknown): Date | null {
  if (raw == null) return null;
  const s = typeof raw === "string" ? raw.trim() : String(raw);
  if (!s) return null;
  const d = new Date(s.includes("T") ? s : `${s.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return startOfDay(d);
}

type DeliveryUrgency =
  | { kind: "today" }
  | { kind: "past"; formatted: string }
  | { kind: "future"; formatted: string };

function orderDueIso(order: ProcurementOrder): string | null {
  const raw = order.delivery_date ?? order.date;
  if (raw == null) return null;
  const s = typeof raw === "string" ? raw.trim() : String(raw);
  if (!s) return null;
  return s.length >= 10 ? s.slice(0, 10) : null;
}

function canRequestCancellation(status: string): boolean {
  const s = status.trim().toLowerCase();
  if (s === "cancelled") return false;
  if (s.includes("cancellation requested")) return false;
  return true;
}

const DEFAULT_PROCUREMENT_FILTERS = {
  orderStatus: [] as string[],
  dateFrom: "" as string,
  dateTo: "" as string,
  isOverdue: false as boolean,
  amountMin: "" as string,
  amountMax: "" as string,
};

type ProcurementFiltersState = typeof DEFAULT_PROCUREMENT_FILTERS;

const PROC_ORDER_STATUS_OPTIONS = ["New", "Processing", "Cancelled"] as const;

function procurementDocstatus(order: ProcurementOrder): number {
  const d = order.docstatus;
  if (typeof d === "number" && Number.isFinite(d)) return d;
  if (typeof d === "string") {
    const n = Number.parseInt(d, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function procurementStatusLabel(order: ProcurementOrder): string {
  const ds = procurementDocstatus(order);
  if (ds === 0) return "New";
  if (ds === 1) return "Processing";
  return "Cancelled";
}

function procurementDeliveryKey(order: ProcurementOrder): string | null {
  const raw = order.delivery_date ?? order.date;
  if (raw == null) return null;
  const s = typeof raw === "string" ? raw.trim() : String(raw);
  if (!s) return null;
  return s.length >= 10 ? s.slice(0, 10) : null;
}

function applyProcurementOrderFilters(
  orderList: ProcurementOrder[],
  filters: ProcurementFiltersState
): ProcurementOrder[] {
  return orderList.filter((order) => {
    if (filters.orderStatus.length > 0) {
      const status = procurementStatusLabel(order);
      if (!filters.orderStatus.includes(status)) return false;
    }

    const deliveryStr = procurementDeliveryKey(order);

    if (filters.dateFrom) {
      const from = new Date(`${filters.dateFrom}T00:00:00`);
      if (!deliveryStr) return false;
      const delivery = new Date(
        deliveryStr.includes("T")
          ? deliveryStr
          : `${deliveryStr}T12:00:00`
      );
      if (Number.isNaN(delivery.getTime()) || delivery < from) return false;
    }
    if (filters.dateTo) {
      const to = new Date(`${filters.dateTo}T00:00:00`);
      to.setHours(23, 59, 59, 999);
      if (!deliveryStr) return false;
      const delivery = new Date(
        deliveryStr.includes("T")
          ? deliveryStr
          : `${deliveryStr}T12:00:00`
      );
      if (Number.isNaN(delivery.getTime()) || delivery > to) return false;
    }

    if (filters.isOverdue) {
      const dueIso = orderDueIso(order);
      if (!isOrderOverdue(dueIso)) return false;
    }

    const total = parseMoney(order.grandTotal);
    const min = parseFloat(filters.amountMin);
    if (filters.amountMin.trim() !== "" && !Number.isNaN(min)) {
      if (total == null || total < min) return false;
    }
    const max = parseFloat(filters.amountMax);
    if (filters.amountMax.trim() !== "" && !Number.isNaN(max)) {
      if (total == null || total > max) return false;
    }

    return true;
  });
}

function countActiveProcurementFilters(f: ProcurementFiltersState): number {
  let n = f.orderStatus.length;
  if (f.dateFrom !== "" || f.dateTo !== "") n += 1;
  if (f.isOverdue) n += 1;
  if (f.amountMin.trim() !== "" || f.amountMax.trim() !== "") n += 1;
  return n;
}

function getDeliveryUrgency(
  deliveryRaw: unknown,
  fallbackDate: unknown
): DeliveryUrgency | null {
  const day = parseCalendarDay(deliveryRaw ?? fallbackDate);
  if (!day) return null;
  const today = startOfDay(new Date());
  const t = today.getTime();
  const d0 = day.getTime();
  const formatted = formatDate(day);
  if (d0 === t) return { kind: "today" };
  if (d0 < t) return { kind: "past", formatted };
  return { kind: "future", formatted };
}

export function ProcurementOrdersClient() {
  const [orders, setOrders] = React.useState<ProcurementOrder[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedOrder, setExpandedOrder] = React.useState<string | null>(null);
  const [cancelDialogOrderId, setCancelDialogOrderId] = React.useState<
    string | null
  >(null);
  const [cancelSubmitting, setCancelSubmitting] = React.useState(false);

  const [filters, setFilters] = React.useState<ProcurementFiltersState>(() => ({
    ...DEFAULT_PROCUREMENT_FILTERS,
  }));
  const [dateDraft, setDateDraft] = React.useState({ from: "", to: "" });
  const [amountDraft, setAmountDraft] = React.useState({
    min: "",
    max: "",
  });
  const [filterOpen, setFilterOpen] = React.useState(false);

  React.useEffect(() => {
    const id = window.setTimeout(() => {
      setFilters((f) => ({
        ...f,
        dateFrom: dateDraft.from,
        dateTo: dateDraft.to,
      }));
    }, 300);
    return () => window.clearTimeout(id);
  }, [dateDraft.from, dateDraft.to]);

  React.useEffect(() => {
    const id = window.setTimeout(() => {
      setFilters((f) => ({
        ...f,
        amountMin: amountDraft.min,
        amountMax: amountDraft.max,
      }));
    }, 500);
    return () => window.clearTimeout(id);
  }, [amountDraft.min, amountDraft.max]);

  React.useEffect(() => {
    if (!filterOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFilterOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filterOpen]);

  const displayedOrders = React.useMemo(
    () => applyProcurementOrderFilters(orders, filters),
    [orders, filters]
  );

  const activeFilterCount = countActiveProcurementFilters(filters);

  const fetchOrders = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/procurement/orders", {
        credentials: "include",
      });
      const json = (await res.json().catch(() => null)) as
        | ProcurementOrder[]
        | { customerId?: string; orders?: ProcurementOrder[]; error?: string }
        | null;

      if (!res.ok) {
        const msg =
          json &&
          typeof json === "object" &&
          !Array.isArray(json) &&
          typeof json.error === "string"
            ? json.error
            : `Request failed (${res.status})`;
        throw new Error(msg);
      }

      if (Array.isArray(json)) {
        setOrders(json);
        return;
      }

      if (
        json &&
        typeof json === "object" &&
        Array.isArray(json.orders)
      ) {
        setOrders(json.orders);
        return;
      }

      setOrders([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders.");
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  function toggleOrder(orderId: string) {
    setExpandedOrder((prev) => (prev === orderId ? null : orderId));
  }

  function clearProcurementFilters() {
    setFilters({ ...DEFAULT_PROCUREMENT_FILTERS });
    setDateDraft({ from: "", to: "" });
    setAmountDraft({ min: "", max: "" });
  }

  async function submitCancellationRequest() {
    if (!cancelDialogOrderId) return;
    setCancelSubmitting(true);
    try {
      const res = await fetch(
        "/api/dashboard/procurement/orders/cancel-request",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: cancelDialogOrderId }),
        }
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
      if (!res.ok) {
        const msg =
          typeof json.error === "string" && json.error.trim()
            ? json.error.trim()
            : "Request failed.";
        toast.error(msg);
        return;
      }
      toast.success("Cancellation request sent to supplier.");
      setCancelDialogOrderId(null);
    } catch {
      toast.error("Request failed.");
    } finally {
      setCancelSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">
            Procurement History
          </h1>
          <p className="text-muted-foreground text-sm">
            Your pharmaceutical order history
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="border-border bg-background relative h-9 shrink-0 gap-2 px-3"
          onClick={() => {
            setDateDraft({
              from: filters.dateFrom,
              to: filters.dateTo,
            });
            setAmountDraft({
              min: filters.amountMin,
              max: filters.amountMax,
            });
            setFilterOpen(true);
          }}
        >
          <SlidersHorizontal className="size-4 shrink-0" aria-hidden />
          Filters
          {activeFilterCount > 0 ? (
            <span className="bg-primary text-primary-foreground absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full text-[11px] font-semibold">
              {activeFilterCount}
            </span>
          ) : null}
        </Button>
      </header>

      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">
          {!isLoading && orders.length > 0
            ? `Showing ${displayedOrders.length} of ${orders.length} orders`
            : null}
        </p>
        {activeFilterCount > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {filters.orderStatus.map((s) => (
              <button
                key={`st-${s}`}
                type="button"
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    orderStatus: f.orderStatus.filter((x) => x !== s),
                  }))
                }
                className="border-border bg-muted/50 text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
              >
                {s}
                <X className="size-3.5" aria-hidden />
              </button>
            ))}
            {filters.dateFrom !== "" || filters.dateTo !== "" ? (
              <button
                type="button"
                onClick={() => {
                  setFilters((f) => ({
                    ...f,
                    dateFrom: "",
                    dateTo: "",
                  }));
                  setDateDraft({ from: "", to: "" });
                }}
                className="border-border bg-muted/50 text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
              >
                Delivery: {filters.dateFrom || "…"} to {filters.dateTo || "…"}
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
            {filters.isOverdue ? (
              <button
                type="button"
                onClick={() =>
                  setFilters((f) => ({ ...f, isOverdue: false }))
                }
                className="border-border bg-muted/50 text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
              >
                Overdue only
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
            {filters.amountMin.trim() !== "" ||
            filters.amountMax.trim() !== "" ? (
              <button
                type="button"
                onClick={() => {
                  setFilters((f) => ({
                    ...f,
                    amountMin: "",
                    amountMax: "",
                  }));
                  setAmountDraft({ min: "", max: "" });
                }}
                className="border-border bg-muted/50 text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
              >
                {filters.amountMin.trim() !== "" &&
                filters.amountMax.trim() !== ""
                  ? `ETB ${filters.amountMin.trim()}–${filters.amountMax.trim()}`
                  : filters.amountMin.trim() !== ""
                    ? `ETB min ${filters.amountMin.trim()}`
                    : `ETB max ${filters.amountMax.trim()}`}
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <Dialog
        open={cancelDialogOrderId !== null}
        onOpenChange={(open) => {
          if (!open) setCancelDialogOrderId(null);
        }}
      >
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>Request cancellation</DialogTitle>
            <DialogDescription>
              Are you sure you want to request cancellation? The supplier will
              be notified.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-t-0 bg-transparent p-0 pt-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelDialogOrderId(null)}
              disabled={cancelSubmitting}
            >
              Back
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void submitCancellationRequest()}
              disabled={cancelSubmitting}
            >
              {cancelSubmitting ? "Sending…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="flex flex-col gap-4">
          {[1, 2, 3].map((k) => (
            <Card key={k} className="gap-4 py-4">
              <CardHeader className="flex flex-row items-center justify-between gap-4 px-6 pb-0">
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-8 w-24 shrink-0" />
              </CardHeader>
              <CardContent className="px-6 pb-0">
                <Skeleton className="h-5 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <div className="border-border bg-card rounded-xl border p-6 shadow-sm">
          <p className="text-destructive mb-4 text-sm">{error}</p>
          <Button type="button" variant="outline" onClick={() => void fetchOrders()}>
            Retry
          </Button>
        </div>
      ) : orders.length === 0 ? (
        <div className="border-border bg-card text-muted-foreground rounded-xl border px-6 py-12 text-center text-sm shadow-sm">
          <p className="mb-4">
            No orders found. Browse the marketplace to place your first order.
          </p>
          <Link
            href="/marketplace"
            className="text-primary font-medium hover:underline"
          >
            Go to marketplace
          </Link>
        </div>
      ) : displayedOrders.length === 0 ? (
        <div className="border-border bg-card text-muted-foreground rounded-xl border px-6 py-12 text-center text-sm shadow-sm">
          No orders match your filters.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {displayedOrders.map((order) => {
            const total = parseMoney(order.grandTotal);
            const expanded = expandedOrder === order.orderId;
            const deliveryUrgency = getDeliveryUrgency(
              order.delivery_date,
              order.date
            );
            const dueIso = orderDueIso(order);
            const isCancelled =
              order.status.trim().toLowerCase() === "cancelled";
            const overdueDisplay =
              dueIso != null && isOrderOverdue(dueIso) && !isCancelled;
            const showCancelRequest =
              overdueDisplay && canRequestCancellation(order.status);
            return (
              <Card
                key={order.orderId}
                className={cn(
                  "gap-0 py-0 transition-colors",
                  expanded && "ring-ring/20 ring-2"
                )}
              >
                <button
                  type="button"
                  className="hover:bg-muted/40 flex w-full flex-col gap-3 rounded-xl px-6 py-5 text-left transition-colors"
                  onClick={() => toggleOrder(order.orderId)}
                  aria-expanded={expanded}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      {expanded ? (
                        <ChevronDown
                          className="text-muted-foreground mt-0.5 size-4 shrink-0"
                          aria-hidden
                        />
                      ) : (
                        <ChevronRight
                          className="text-muted-foreground mt-0.5 size-4 shrink-0"
                          aria-hidden
                        />
                      )}
                      <div className="min-w-0">
                        <CardTitle className="font-mono text-base">
                          {order.orderId || "—"}
                        </CardTitle>
                        <p className="text-muted-foreground mt-1 text-sm">
                          {formatDate(order.date)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-start justify-end gap-3">
                      <span className="text-foreground font-mono text-sm font-medium tabular-nums">
                        {total != null ? formatEtb(total) : "—"}
                      </span>
                      <div className="flex flex-col items-end gap-1">
                        {overdueDisplay && dueIso ? (
                          <>
                            <Badge variant="destructive">Overdue</Badge>
                            <span className="text-muted-foreground max-w-[14rem] text-right text-xs leading-snug">
                              {formatOverdueText(dueIso)}
                            </span>
                          </>
                        ) : null}
                        <OrderStatusBadge status={order.status} />
                      </div>
                    </div>
                  </div>
                </button>

                {expanded ? (
                  <CardContent
                    className="border-border border-t pb-5 pt-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {overdueDisplay ? (
                      <div className="border-destructive/40 bg-destructive/10 text-destructive mb-4 rounded-lg border px-3 py-2 text-sm">
                        This order is overdue.
                      </div>
                    ) : null}
                    {showCancelRequest ? (
                      <div className="mb-4 flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          className="border-destructive/50 text-destructive hover:bg-destructive/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCancelDialogOrderId(order.orderId);
                          }}
                        >
                          Request Cancellation
                        </Button>
                      </div>
                    ) : null}
                    {deliveryUrgency ? (
                      <div className="mb-4 space-y-1">
                        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                          Expected Delivery
                        </p>
                        {deliveryUrgency.kind === "today" ? (
                          <p className="text-amber-700 dark:text-amber-300 flex flex-wrap items-center gap-2 text-sm font-semibold">
                            <Clock className="size-4 shrink-0" aria-hidden />
                            <span>Due Today</span>
                          </p>
                        ) : deliveryUrgency.kind === "past" ? (
                          <p className="text-destructive flex flex-wrap items-center gap-2 text-sm font-semibold">
                            <AlertTriangle
                              className="size-4 shrink-0"
                              aria-hidden
                            />
                            <span>Overdue — {deliveryUrgency.formatted}</span>
                          </p>
                        ) : (
                          <p className="text-foreground text-sm font-medium">
                            {deliveryUrgency.formatted}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-muted-foreground mb-4 text-sm">
                        Expected Delivery:{" "}
                        {formatDate(order.delivery_date ?? order.date)}
                      </p>
                    )}
                    {order.items.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        No line items stored for this order.
                      </p>
                    ) : (
                      <div className="overflow-x-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Medication</TableHead>
                              <TableHead>Vendor</TableHead>
                              <TableHead className="text-right">Qty</TableHead>
                              <TableHead className="text-right">
                                Unit Price
                              </TableHead>
                              <TableHead className="text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {order.items.map((item, idx) => {
                              const lineTotal = item.quantity * item.price;
                              return (
                                <TableRow key={`${item.genericName}-${item.vendorAlias}-${idx}`}>
                                  <TableCell className="font-medium">
                                    {item.genericName}
                                  </TableCell>
                                  <TableCell>
                                    <span
                                      className="text-[14px] font-medium text-[#0a0a0a]"
                                      data-supplier-id={item.vendorAlias}
                                    >
                                      Verified Supplier
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-right font-mono tabular-nums">
                                    {item.quantity}
                                    {item.uom ? (
                                      <span className="text-muted-foreground ml-1 text-xs">
                                        {item.uom}
                                      </span>
                                    ) : null}
                                  </TableCell>
                                  <TableCell className="text-right font-mono tabular-nums">
                                    {formatEtb(item.price)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono font-medium tabular-nums">
                                    {formatEtb(lineTotal)}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {filterOpen ? (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby="procurement-orders-filter-title"
          className="border-border fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-background shadow-lg"
        >
          <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-4">
            <h2
              id="procurement-orders-filter-title"
              className="text-base font-medium"
            >
              Filters
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={() => setFilterOpen(false)}
              aria-label="Close filters"
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-4">
            <div className="space-y-3">
              <Label className="text-base font-medium">Order Status</Label>
              <div className="space-y-2">
                {PROC_ORDER_STATUS_OPTIONS.map((opt) => (
                  <label
                    key={opt}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={filters.orderStatus.includes(opt)}
                      onCheckedChange={(checked) => {
                        setFilters((d) => ({
                          ...d,
                          orderStatus:
                            checked === true
                              ? d.orderStatus.includes(opt)
                                ? d.orderStatus
                                : [...d.orderStatus, opt]
                              : d.orderStatus.filter((x) => x !== opt),
                        }));
                      }}
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-base font-medium">Delivery Date</Label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="proc-date-from"
                    className="text-muted-foreground text-xs"
                  >
                    From
                  </Label>
                  <Input
                    id="proc-date-from"
                    type="date"
                    value={dateDraft.from}
                    onChange={(e) =>
                      setDateDraft((d) => ({ ...d, from: e.target.value }))
                    }
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="proc-date-to"
                    className="text-muted-foreground text-xs"
                  >
                    To
                  </Label>
                  <Input
                    id="proc-date-to"
                    type="date"
                    value={dateDraft.to}
                    onChange={(e) =>
                      setDateDraft((d) => ({ ...d, to: e.target.value }))
                    }
                    className="h-10"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-base font-medium">Overdue</Label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={filters.isOverdue}
                  onCheckedChange={(checked) =>
                    setFilters((d) => ({
                      ...d,
                      isOverdue: checked === true,
                    }))
                  }
                />
                Show overdue orders only
              </label>
            </div>
            <div className="space-y-3">
              <Label className="text-base font-medium">
                Order Amount (ETB)
              </Label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="proc-amt-min"
                    className="text-muted-foreground text-xs"
                  >
                    Min
                  </Label>
                  <Input
                    id="proc-amt-min"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    placeholder="0"
                    value={amountDraft.min}
                    onChange={(e) =>
                      setAmountDraft((d) => ({ ...d, min: e.target.value }))
                    }
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="proc-amt-max"
                    className="text-muted-foreground text-xs"
                  >
                    Max
                  </Label>
                  <Input
                    id="proc-amt-max"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    placeholder="Any"
                    value={amountDraft.max}
                    onChange={(e) =>
                      setAmountDraft((d) => ({ ...d, max: e.target.value }))
                    }
                    className="h-10"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="border-border flex shrink-0 flex-col gap-2 border-t p-4 pt-4">
            <Button
              type="button"
              className="h-11 w-full bg-indigo-600 text-white hover:bg-indigo-700"
              onClick={() => setFilterOpen(false)}
            >
              Done ({activeFilterCount} active)
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              onClick={() => {
                clearProcurementFilters();
              }}
            >
              Clear All Filters
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
