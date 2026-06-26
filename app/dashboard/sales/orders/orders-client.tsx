"use client";

import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

type OrderDoc = {
  name?: string;
  customer?: string;
  customer_name?: string;
  transaction_date?: string;
  delivery_date?: string;
  status?: string;
  docstatus?: number;
  grand_total?: number;
  /** Sum of line quantities from ERPNext when present. */
  total_qty?: number;
};

type LineDetail = {
  item_code: string;
  item_name: string | null;
  qty: number;
  rate: number;
  amount: number | null;
  warehouse: string | null;
  uom: string | null;
  actual_qty: number;
  earliest_batch_expiry?: string | null;
};

function formatMoney(n: number) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function parseTotalQty(row: OrderDoc): number | null {
  const t = row.total_qty;
  if (typeof t === "number" && Number.isFinite(t)) return t;
  if (typeof t === "string") {
    const n = Number.parseFloat(t);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function formatDate(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) return raw.trim().slice(0, 10);
  return "—";
}

function parseIsoDay(iso: string): Date | null {
  const s = iso.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysFromTodayToExpiry(iso: string): number {
  const exp = parseIsoDay(iso);
  if (!exp) return Number.POSITIVE_INFINITY;
  const today = new Date();
  const startToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const startExp = new Date(
    exp.getFullYear(),
    exp.getMonth(),
    exp.getDate()
  );
  return (
    (startExp.getTime() - startToday.getTime()) / (1000 * 60 * 60 * 24)
  );
}

function lineBatchExpiryClass(iso: string): string {
  const days = daysFromTodayToExpiry(iso);
  if (days < 0 || days <= 90) {
    return "text-destructive font-medium";
  }
  if (days <= 180) {
    return "text-amber-700 dark:text-amber-400 font-medium";
  }
  return "text-muted-foreground";
}

function formatBatchLineDate(iso: string): string {
  const d = parseIsoDay(iso);
  if (!d) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(d);
}

function formatRequestedDelivery(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "—";
  const d = raw.includes("T")
    ? new Date(raw)
    : new Date(`${raw.trim().slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw.trim().slice(0, 10);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(d);
}

function deliveryIsoFromOrder(row: OrderDoc): string | null {
  const d = row.delivery_date;
  if (typeof d !== "string" || !d.trim()) return null;
  return d.trim().slice(0, 10);
}

function isSupplierOrderCancelled(row: OrderDoc): boolean {
  if ((row.docstatus ?? 0) === 2) return true;
  const s = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  return s === "cancelled";
}

const DEFAULT_SUPPLIER_FILTERS = {
  orderStatus: [] as string[],
  dateFrom: "" as string,
  dateTo: "" as string,
  isOverdue: false as boolean,
};

type SupplierFiltersState = typeof DEFAULT_SUPPLIER_FILTERS;

const ORDER_STATUS_OPTIONS = ["New", "Processing", "Cancelled"] as const;

function docstatusFilterLabel(docstatus: number): string {
  if (docstatus === 0) return "New";
  if (docstatus === 1) return "Processing";
  return "Cancelled";
}

function deliveryDateString(order: OrderDoc): string | null {
  const d = order.delivery_date;
  if (typeof d !== "string" || !d.trim()) return null;
  return d.trim().slice(0, 10);
}

function applySupplierOrderFilters(
  orderList: OrderDoc[],
  filters: SupplierFiltersState
): OrderDoc[] {
  return orderList.filter((order) => {
    if (filters.orderStatus.length > 0) {
      const ds = order.docstatus ?? 0;
      const status = docstatusFilterLabel(ds);
      if (!filters.orderStatus.includes(status)) return false;
    }

    const deliveryStr = deliveryDateString(order);

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
      const raw =
        typeof order.delivery_date === "string" && order.delivery_date.trim()
          ? order.delivery_date.trim()
          : null;
      if (!isOrderOverdue(raw)) return false;
    }

    return true;
  });
}

function countActiveSupplierFilters(f: SupplierFiltersState): number {
  let n = f.orderStatus.length;
  if (f.dateFrom !== "" || f.dateTo !== "") n += 1;
  if (f.isOverdue) n += 1;
  return n;
}

export function SupplierOrdersClient() {
  const [orders, setOrders] = React.useState<OrderDoc[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [selectedName, setSelectedName] = React.useState<string | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailOrder, setDetailOrder] = React.useState<OrderDoc | null>(null);
  const [detailLines, setDetailLines] = React.useState<LineDetail[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  const [filters, setFilters] = React.useState<SupplierFiltersState>(() => ({
    ...DEFAULT_SUPPLIER_FILTERS,
  }));
  const [dateDraft, setDateDraft] = React.useState({ from: "", to: "" });
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");

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
    if (!filterOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFilterOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filterOpen]);

  const searchedOrders = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const id = (typeof o.name === "string" ? o.name : "").toLowerCase();
      const buyer =
        (typeof o.customer_name === "string" && o.customer_name.trim()) ||
        (typeof o.customer === "string" && o.customer.trim()) ||
        "";
      return id.includes(q) || buyer.toLowerCase().includes(q);
    });
  }, [orders, searchQuery]);

  const displayedOrders = React.useMemo(
    () => applySupplierOrderFilters(searchedOrders, filters),
    [searchedOrders, filters]
  );

  const kpi = React.useMemo(() => {
    const list = displayedOrders;
    return {
      total: list.length,
      submitted: list.filter((o) => (o.docstatus ?? 0) === 1).length,
      draft: list.filter((o) => (o.docstatus ?? 0) === 0).length,
      overdue: list.filter((o) => {
        if (isSupplierOrderCancelled(o)) return false;
        const due = deliveryIsoFromOrder(o);
        return Boolean(due && isOrderOverdue(due));
      }).length,
    };
  }, [displayedOrders]);

  const activeFilterCount = countActiveSupplierFilters(filters);

  const loadList = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/sales/orders", {
        credentials: "include",
      });
      const json = (await res.json().catch(() => ({}))) as {
        orders?: OrderDoc[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof json.error === "string" ? json.error : "Failed to load orders."
        );
      }
      setOrders(Array.isArray(json.orders) ? json.orders : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load orders.");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadList();
  }, [loadList]);

  async function openOrder(name: string) {
    setSelectedName(name);
    setSheetOpen(true);
    setDetailLoading(true);
    setDetailOrder(null);
    setDetailLines([]);
    try {
      const res = await fetch(
        `/api/dashboard/sales/orders?orderName=${encodeURIComponent(name)}`,
        { credentials: "include" }
      );
      const json = (await res.json().catch(() => ({}))) as {
        order?: OrderDoc;
        lines?: LineDetail[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof json.error === "string" ? json.error : "Could not load order."
        );
      }
      setDetailOrder(json.order ?? null);
      setDetailLines(Array.isArray(json.lines) ? json.lines : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load order.");
      setSheetOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  const docstatus = detailOrder?.docstatus ?? 0;
  const hasInsufficient =
    detailLines.length > 0 &&
    detailLines.some((l) => l.actual_qty < l.qty);
  const canFulfill =
    detailOrder &&
    docstatus === 0 &&
    detailLines.length > 0 &&
    !hasInsufficient;

  async function confirmFulfill() {
    if (!selectedName) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/dashboard/sales/orders", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderName: selectedName }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
      if (!res.ok) {
        throw new Error(
          typeof json.error === "string"
            ? json.error
            : "Could not submit order."
        );
      }
      toast.success("Order submitted successfully.");
      setSheetOpen(false);
      setSelectedName(null);
      setDetailOrder(null);
      setDetailLines([]);
      void loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit order.");
    } finally {
      setSubmitting(false);
    }
  }

  function clearSupplierFilters() {
    setFilters({ ...DEFAULT_SUPPLIER_FILTERS });
    setDateDraft({ from: "", to: "" });
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-3xl">
          Order Fulfillment
        </h1>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
          Sales orders that include lines shipping from your warehouse. Open a row
          to review stock and submit.
        </p>
      </header>

      {!loading && orders.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-border/80 gap-0 py-0 shadow-sm">
            <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
                  Total Orders
                </p>
                <p className="text-foreground mt-1 text-2xl font-semibold leading-none tabular-nums">
                  {kpi.total}
                </p>
              </div>
              <div
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-950/50"
                aria-hidden
              >
                <Clock className="size-4 text-blue-600 dark:text-blue-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/80 gap-0 py-0 shadow-sm">
            <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
                  Submitted
                </p>
                <p className="mt-1 text-2xl font-semibold leading-none tabular-nums text-emerald-600">
                  {kpi.submitted}
                </p>
              </div>
              <div
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/50"
                aria-hidden
              >
                <CheckCircle className="size-4 text-emerald-600 dark:text-emerald-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/80 gap-0 py-0 shadow-sm">
            <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
                  Draft
                </p>
                <p className="mt-1 text-2xl font-semibold leading-none tabular-nums text-amber-600">
                  {kpi.draft}
                </p>
              </div>
              <div
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-950/40"
                aria-hidden
              >
                <Clock className="size-4 text-amber-600 dark:text-amber-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/80 gap-0 py-0 shadow-sm">
            <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
                  Overdue
                </p>
                <p className="text-destructive mt-1 text-2xl font-semibold leading-none tabular-nums">
                  {kpi.overdue}
                </p>
              </div>
              <div
                className="bg-destructive/10 flex size-9 shrink-0 items-center justify-center rounded-lg dark:bg-red-950/40"
                aria-hidden
              >
                <AlertCircle className="text-destructive size-4" />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
          <div className="relative min-w-0 flex-1">
            <Search
              className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              type="search"
              placeholder="Search by Order ID or Buyer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-11 border-[#e5e7eb] bg-white pl-9 pr-3 shadow-sm"
              aria-label="Search orders"
            />
          </div>
          <Button
              type="button"
              variant="outline"
              className="border-[#d1d5dc] bg-white relative h-11 shrink-0 gap-2 px-4 shadow-sm"
              onClick={() => {
                setDateDraft({
                  from: filters.dateFrom,
                  to: filters.dateTo,
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
        </div>
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
          </div>
        ) : null}
      </div>

      <Card className="border-border/80 flex flex-col gap-0 overflow-hidden py-0 shadow-sm">
        {loading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading orders…
          </div>
        ) : orders.length === 0 ? (
          <p className="text-muted-foreground px-4 py-12 text-center text-sm">
            No sales orders found for your warehouse.
          </p>
        ) : (
          <>
            <div className="text-muted-foreground border-border flex items-center border-b px-4 py-2.5 text-xs leading-none">
              Showing {displayedOrders.length} of {searchedOrders.length}{" "}
              orders
            </div>
            {displayedOrders.length === 0 ? (
              <p className="text-muted-foreground px-4 py-10 text-center text-sm">
                No orders match your search or filters.
              </p>
            ) : (
              <Table className="border-separate border-spacing-x-3 border-spacing-y-0">
                <TableHeader>
                  <TableRow className="border-0 bg-muted/25 hover:bg-muted/25">
                    <TableHead className="text-muted-foreground h-9 w-[14%] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide first:pl-4">
                      Order ID
                    </TableHead>
                    <TableHead className="text-muted-foreground min-w-0 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Buyer
                    </TableHead>
                    <TableHead className="text-muted-foreground w-[12%] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Date
                    </TableHead>
                    <TableHead className="text-muted-foreground w-[13%] min-w-[7.5rem] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Amount
                    </TableHead>
                    <TableHead className="text-muted-foreground min-w-0 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Status
                    </TableHead>
                    <TableHead className="text-muted-foreground w-[11%] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide last:pr-4">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedOrders.map((row) => {
                const id = typeof row.name === "string" ? row.name : "";
                const buyer =
                  (typeof row.customer_name === "string" &&
                    row.customer_name.trim()) ||
                  (typeof row.customer === "string" && row.customer.trim()) ||
                  "—";
                const ds = row.docstatus ?? 0;
                const amount =
                  typeof row.grand_total === "number"
                    ? row.grand_total
                    : typeof row.grand_total === "string"
                      ? Number.parseFloat(row.grand_total)
                      : 0;
                const dueIso = deliveryIsoFromOrder(row);
                const showOverdue =
                  dueIso &&
                  isOrderOverdue(dueIso) &&
                  !isSupplierOrderCancelled(row);
                const qty = parseTotalQty(row);

                return (
                  <TableRow
                    key={id}
                    className="border-border/50 hover:bg-muted/30 border-b last:border-b-0"
                  >
                    <TableCell className="px-3 py-2.5 text-left align-top first:pl-4">
                      <button
                        type="button"
                        className="text-primary font-mono text-sm font-medium hover:underline"
                        onClick={() => id && void openOrder(id)}
                      >
                        {id || "—"}
                      </button>
                    </TableCell>
                    <TableCell className="max-w-[240px] min-w-0 px-3 py-2.5 text-left align-top">
                      <div className="font-semibold text-foreground">{buyer}</div>
                      {qty != null && qty > 0 ? (
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {qty === Math.floor(qty)
                            ? `${Math.floor(qty).toLocaleString()} units`
                            : `${qty.toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                              })} units`}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground px-3 py-2.5 text-left align-top text-sm tabular-nums whitespace-nowrap">
                      {formatDate(row.transaction_date)}
                    </TableCell>
                    <TableCell className="min-w-[7.5rem] px-3 py-2.5 align-top text-left">
                      <span className="text-foreground text-sm font-semibold tabular-nums">
                        ETB {formatMoney(Number.isFinite(amount) ? amount : 0)}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-0 px-3 py-2.5 align-top text-left">
                      <div className="flex flex-col items-start gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {ds === 2 ? (
                            <Badge variant="destructive">Cancelled</Badge>
                          ) : ds === 1 ? (
                            <Badge className="border-0 bg-emerald-100 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-100">
                              Submitted
                            </Badge>
                          ) : (
                            <Badge className="border-0 bg-amber-100 text-amber-950 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-100">
                              Draft
                            </Badge>
                          )}
                        </div>
                        {showOverdue && dueIso ? (
                          <p className="text-destructive flex items-start gap-1.5 text-xs font-medium leading-snug">
                            <AlertCircle
                              className="mt-0.5 size-3.5 shrink-0"
                              aria-hidden
                            />
                            <span>{formatOverdueText(dueIso)}</span>
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-left align-top last:pr-4">
                      <Button
                        type="button"
                        size="sm"
                        className="bg-violet-600 font-medium text-white hover:bg-violet-700"
                        onClick={() => id && void openOrder(id)}
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
            )}
          </>
        )}
      </Card>

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) {
            setSelectedName(null);
            setDetailOrder(null);
            setDetailLines([]);
          }
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
          showCloseButton
        >
          <SheetHeader className="border-border shrink-0 border-b px-4 py-4">
            <SheetTitle className="text-left">
              {selectedName ? (
                <span className="font-mono text-sm">{selectedName}</span>
              ) : (
                "Order"
              )}
            </SheetTitle>
            {detailOrder && (
              <p className="text-muted-foreground text-xs">
                {(typeof detailOrder.customer_name === "string" &&
                  detailOrder.customer_name) ||
                  detailOrder.customer ||
                  "Buyer"}
              </p>
            )}
            {detailOrder &&
            typeof detailOrder.delivery_date === "string" &&
            detailOrder.delivery_date.trim() &&
            !(
              isOrderOverdue(detailOrder.delivery_date.trim().slice(0, 10)) &&
              !isSupplierOrderCancelled(detailOrder)
            ) ? (
              <p className="text-foreground pt-1 text-sm font-medium">
                Requested Delivery:{" "}
                {formatRequestedDelivery(detailOrder.delivery_date)}
              </p>
            ) : null}
          </SheetHeader>

          {detailOrder &&
          typeof detailOrder.delivery_date === "string" &&
          detailOrder.delivery_date.trim() &&
          isOrderOverdue(detailOrder.delivery_date.trim().slice(0, 10)) &&
          !isSupplierOrderCancelled(detailOrder) ? (
            <div className="border-destructive/40 bg-destructive/10 text-destructive shrink-0 border-b px-4 py-3 text-sm leading-relaxed">
              ⚠ This order is overdue. Please update the delivery status or
              contact the buyer immediately.
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {detailLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                Loading lines…
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">Item</TableHead>
                    <TableHead className="w-14 text-left text-xs">Qty</TableHead>
                    <TableHead className="w-20 text-left text-xs">
                      Stock
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailLines.map((line, idx) => {
                    const ok = line.actual_qty >= line.qty;
                    return (
                      <TableRow
                        key={`${line.item_code}-${idx}`}
                        className={
                          ok
                            ? undefined
                            : "bg-destructive/10 border-destructive/30"
                        }
                      >
                        <TableCell className="align-top text-xs">
                          <div className="font-medium">
                            {line.item_name || line.item_code}
                          </div>
                          <div className="text-muted-foreground font-mono">
                            {line.item_code}
                          </div>
                          {line.earliest_batch_expiry ? (
                            <p
                              className={cn(
                                "mt-1 inline-flex flex-wrap items-center gap-1 text-xs",
                                lineBatchExpiryClass(line.earliest_batch_expiry)
                              )}
                            >
                              {daysFromTodayToExpiry(
                                line.earliest_batch_expiry
                              ) <= 180 ? (
                                <AlertTriangle
                                  className="size-3 shrink-0"
                                  aria-hidden
                                />
                              ) : null}
                              <span>
                                Earliest batch:{" "}
                                {formatBatchLineDate(
                                  line.earliest_batch_expiry
                                )}
                              </span>
                            </p>
                          ) : null}
                          {ok ? (
                            <span className="mt-1 inline-block text-xs font-medium text-emerald-700 dark:text-emerald-400">
                              Stock available
                            </span>
                          ) : (
                            <span className="text-destructive mt-1 inline-block text-xs font-medium">
                              Insufficient stock
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-left tabular-nums">
                          {line.qty}
                        </TableCell>
                        <TableCell className="text-left tabular-nums">
                          {line.actual_qty}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          <SheetFooter className="border-border mt-auto shrink-0 border-t px-4 py-4">
            <Button
              className="w-full"
              type="button"
              disabled={
                !canFulfill ||
                submitting ||
                detailLoading ||
                !selectedName
              }
              onClick={() => void confirmFulfill()}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                "Confirm and Fulfill Order"
              )}
            </Button>
            {detailOrder && (detailOrder.docstatus ?? 0) === 1 && (
              <p className="text-muted-foreground text-center text-xs">
                This order is already submitted.
              </p>
            )}
            {detailLines.length > 0 && hasInsufficient && (
              <p className="text-destructive text-center text-xs">
                Resolve insufficient stock before submitting.
              </p>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {filterOpen ? (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby="supplier-orders-filter-title"
          className="border-border fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-background shadow-lg"
        >
          <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-4">
            <h2
              id="supplier-orders-filter-title"
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
                {ORDER_STATUS_OPTIONS.map((opt) => (
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
                    htmlFor="sup-date-from"
                    className="text-muted-foreground text-xs"
                  >
                    From
                  </Label>
                  <Input
                    id="sup-date-from"
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
                    htmlFor="sup-date-to"
                    className="text-muted-foreground text-xs"
                  >
                    To
                  </Label>
                  <Input
                    id="sup-date-to"
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
                clearSupplierFilters();
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
