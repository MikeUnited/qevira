"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BarChart2,
  CheckCircle,
  LayoutList,
  Package,
  Pencil,
  PlusSquare,
  SlidersHorizontal,
  TrendingDown,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Card,
  CardContent,
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
import { fetchAllVendorCatalogItems } from "@/lib/fetch-all-catalog";
import { cn } from "@/lib/utils";

type InventoryRow = {
  itemCode: string;
  itemName: string;
  group: string;
  efda: string;
  price: number;
  stock: number;
  /** Present when API includes batch expiry (optional today). */
  batchExpiry?: string;
};

const DEFAULT_INVENTORY_FILTERS = {
  itemGroups: [] as string[],
  stockStatus: [] as string[],
  expiryRange: "" as string,
};

type InventoryFiltersState = typeof DEFAULT_INVENTORY_FILTERS;

const STOCK_STATUS_OPTIONS = [
  "In Stock",
  "Low Stock",
  "Out of Stock",
] as const;

function startOfToday(): Date {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

function passesExpiryRangeFilter(
  batchExpiry: string | null | undefined,
  expiryRange: string
): boolean {
  if (!expiryRange) return true;
  if (!batchExpiry) return false;
  const s = batchExpiry.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const expiryDate = new Date(`${s}T12:00:00`);
  if (Number.isNaN(expiryDate.getTime())) return false;
  const startToday = startOfToday();
  const threeMonths = new Date(
    startToday.getTime() + 90 * 24 * 60 * 60 * 1000
  );
  const sixMonths = new Date(
    startToday.getTime() + 180 * 24 * 60 * 60 * 1000
  );

  if (expiryRange === "3months") {
    return expiryDate >= startToday && expiryDate <= threeMonths;
  }
  if (expiryRange === "6months") {
    return expiryDate >= startToday && expiryDate <= sixMonths;
  }
  if (expiryRange === "after6months") {
    return expiryDate > sixMonths;
  }
  return true;
}

function stockStatusLabel(stock: number): string {
  if (stock === 0) return "Out of Stock";
  if (stock < 50) return "Low Stock";
  return "In Stock";
}

function applyInventoryFilters(
  items: InventoryRow[],
  filters: InventoryFiltersState
): InventoryRow[] {
  return items.filter((item) => {
    if (filters.itemGroups.length > 0) {
      const g = (item.group || "").trim();
      if (
        !filters.itemGroups.some(
          (x) => x.trim().toLowerCase() === g.toLowerCase()
        )
      ) {
        return false;
      }
    }

    if (filters.stockStatus.length > 0) {
      const status = stockStatusLabel(item.stock);
      if (!filters.stockStatus.includes(status)) return false;
    }

    if (filters.expiryRange && item.batchExpiry) {
      if (!passesExpiryRangeFilter(item.batchExpiry, filters.expiryRange)) {
        return false;
      }
    }

    return true;
  });
}

function countActiveInventoryFilters(f: InventoryFiltersState): number {
  let n = f.itemGroups.length + f.stockStatus.length;
  if (f.expiryRange) n += 1;
  return n;
}

function expiryRangeLabel(range: string): string {
  if (range === "3months") return "Expiring within 3 months";
  if (range === "6months") return "Expiring within 6 months";
  if (range === "after6months") return "Expiring after 6 months";
  return range;
}

/** Matches `stockStatusLabel` / filters: below this is "Low Stock". */
const INVENTORY_MIN_STOCK = 50;

function formatExpiryUs(
  raw: string | null | undefined
): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function inventoryStatusPresentation(stock: number): {
  label: string;
  badgeClass: string;
} {
  if (stock === 0) {
    return {
      label: "Out of stock",
      badgeClass:
        "border-0 bg-red-100 font-medium text-red-800 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-100",
    };
  }
  if (stock < INVENTORY_MIN_STOCK) {
    return {
      label: "Low Stock",
      badgeClass:
        "border-0 bg-amber-100 font-medium text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-100",
    };
  }
  return {
    label: "Active",
    badgeClass:
      "border-0 bg-emerald-100 font-medium text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-100",
  };
}

const INVENTORY_VIEW_KEY = "inventory-view";

type StockStatus = "critical" | "low" | "reorder" | "good";

function stockLevelStatus(stock: number): StockStatus {
  if (stock === 0) return "critical";
  if (stock < 10) return "low";
  if (stock < 50) return "reorder";
  return "good";
}

function stockStatusBadge(stock: number): { label: string; className: string } {
  const s = stockLevelStatus(stock);
  if (s === "critical") {
    return {
      label: "Critical",
      className:
        "border-0 bg-red-600 text-white shadow-sm hover:bg-red-600 dark:bg-red-600",
    };
  }
  if (s === "low") {
    return {
      label: "Low",
      className:
        "border-0 bg-red-600 text-white shadow-sm hover:bg-red-600 dark:bg-red-600",
    };
  }
  if (s === "reorder") {
    return {
      label: "Reorder",
      className:
        "border-0 bg-amber-500 text-white shadow-sm hover:bg-amber-500 dark:bg-amber-500",
    };
  }
  return {
    label: "Good",
    className:
      "border-0 bg-emerald-600 text-white shadow-sm hover:bg-emerald-600 dark:bg-emerald-600",
  };
}

// TODO: Replace proxy max (200) with actual reorder_qty from ERPNext once Min/Max fields are configured per item
function stockBarPercent(stock: number): number {
  return Math.min(stock / 200, 1) * 100;
}

function barColorClass(stock: number): string {
  const s = stockLevelStatus(stock);
  if (s === "good") return "bg-emerald-500";
  if (s === "reorder") return "bg-amber-500";
  return "bg-red-500";
}

function ViewModeToggle({
  view,
  onChange,
}: {
  view: "table" | "stock";
  onChange: (next: "table" | "stock") => void;
}) {
  return (
    <div
      className="border-border bg-muted/40 inline-flex rounded-lg border p-0.5"
      role="group"
      aria-label="View mode"
    >
      <button
        type="button"
        onClick={() => onChange("table")}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
          view === "table"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <LayoutList className="size-4 shrink-0" aria-hidden />
        Table
      </button>
      <button
        type="button"
        onClick={() => onChange("stock")}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
          view === "stock"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <BarChart2 className="size-4 shrink-0" aria-hidden />
        Stock Levels
      </button>
    </div>
  );
}

export function SalesInventoryClient() {
  const router = useRouter();
  const [data, setData] = useState<InventoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<InventoryFiltersState>(() => ({
    ...DEFAULT_INVENTORY_FILTERS,
  }));
  const [filterOpen, setFilterOpen] = useState(false);
  const [view, setView] = useState<"table" | "stock">("table");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(INVENTORY_VIEW_KEY);
    if (saved === "table" || saved === "stock") {
      setView(saved);
    }
  }, []);

  const setViewAndPersist = useCallback((next: "table" | "stock") => {
    setView(next);
    if (typeof window !== "undefined") {
      localStorage.setItem(INVENTORY_VIEW_KEY, next);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const rows = await fetchAllVendorCatalogItems({
          credentials: "include",
        });
        if (!cancelled) {
          setData(
            rows.filter(
              (r): r is InventoryRow =>
                r !== null &&
                typeof r === "object" &&
                "itemCode" in r &&
                "itemName" in r
            ) as InventoryRow[]
          );
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Something went wrong.");
          setData([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const availableGroups = useMemo(() => {
    const s = new Set<string>();
    for (const row of data) {
      const g = (row.group || "").trim();
      if (g) s.add(g);
    }
    return [...s].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [data]);

  const searchedItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q.length) return data;
    return data.filter(
      (row) =>
        row.itemName.toLowerCase().includes(q) ||
        row.itemCode.toLowerCase().includes(q)
    );
  }, [data, search]);

  const displayedItems = useMemo(
    () => applyInventoryFilters(searchedItems, filters),
    [searchedItems, filters]
  );

  const activeFilterCount = countActiveInventoryFilters(filters);

  const criticalCount = displayedItems.filter((r) => r.stock === 0).length;
  const reorderAlertCount = displayedItems.filter(
    (r) => r.stock > 0 && r.stock < 10
  ).length;
  const goodStockCount = displayedItems.filter((r) => r.stock >= 50).length;
  const needReorderCount = displayedItems.filter(
    (r) => r.stock > 0 && r.stock < 50
  ).length;
  const lowStockCount = displayedItems.filter((r) => r.stock === 0).length;

  function clearAllFilters() {
    setFilters({ ...DEFAULT_INVENTORY_FILTERS });
  }

  useEffect(() => {
    if (!filterOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFilterOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filterOpen]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-3xl">
            Inventory
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage your live stock and batch details
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <Button
            type="button"
            size="lg"
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary h-11 gap-2 rounded-[10px] px-4"
            onClick={() => router.push("/dashboard/sales/stock")}
          >
            <PlusSquare className="size-4 shrink-0" aria-hidden />
            Add Stock
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 gap-2 rounded-[10px] px-4"
            onClick={() => router.push("/dashboard/sales")}
          >
            <Package className="size-4 shrink-0" aria-hidden />
            Manage Catalog
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="h-[46px] min-w-0 flex-1 rounded-[10px] border border-[#d1d5dc] bg-white px-3 text-sm outline-none"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search products"
          />
          <Button
            type="button"
            variant="outline"
            className="border-[#d1d5dc] bg-white relative h-[46px] shrink-0 gap-2 px-4"
            onClick={() => setFilterOpen(true)}
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
            {filters.itemGroups.map((g) => (
              <button
                key={`ig-${g}`}
                type="button"
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    itemGroups: f.itemGroups.filter((x) => x !== g),
                  }))
                }
                className="border-border bg-muted/50 text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
              >
                {g}
                <X className="size-3.5" aria-hidden />
              </button>
            ))}
            {filters.stockStatus.map((s) => (
              <button
                key={`ss-${s}`}
                type="button"
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    stockStatus: f.stockStatus.filter((x) => x !== s),
                  }))
                }
                className="border-border bg-muted/50 text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
              >
                {s}
                <X className="size-3.5" aria-hidden />
              </button>
            ))}
            {filters.expiryRange ? (
              <button
                type="button"
                onClick={() =>
                  setFilters((f) => ({ ...f, expiryRange: "" }))
                }
                className="border-border bg-muted/50 text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
              >
                Expiry: {expiryRangeLabel(filters.expiryRange)}
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <Card className="border-border/80 gap-0 overflow-hidden py-0 shadow-sm">
        <CardContent className="p-0">
          <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
            <span className="text-sm font-medium text-foreground">
              Products
            </span>
            <ViewModeToggle view={view} onChange={setViewAndPersist} />
          </div>

          {!error ? (
            <div className="border-border flex flex-col gap-6 border-b px-6 py-6">
              {criticalCount > 0 ? (
                <div
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
                  role="alert"
                >
                  Critical Stock Alert — {criticalCount} product(s) below
                  minimum stock level
                </div>
              ) : null}
              {reorderAlertCount > 0 ? (
                <div
                  className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
                  role="status"
                >
                  Reorder Required — {reorderAlertCount} product(s) reached
                  reorder point
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-3">
                <Card className="border-border/80 shadow-sm">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-muted-foreground text-xs font-medium">
                          Good Stock
                        </p>
                        {isLoading ? (
                          <Skeleton className="mt-2 h-8 w-16" />
                        ) : (
                          <p className="text-foreground mt-1 text-2xl font-semibold tabular-nums">
                            {goodStockCount}
                          </p>
                        )}
                      </div>
                      <CheckCircle
                        className="size-5 shrink-0 text-emerald-600"
                        aria-hidden
                      />
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-border/80 shadow-sm">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-muted-foreground text-xs font-medium">
                          Need Reorder
                        </p>
                        {isLoading ? (
                          <Skeleton className="mt-2 h-8 w-16" />
                        ) : (
                          <p className="text-foreground mt-1 text-2xl font-semibold tabular-nums">
                            {needReorderCount}
                          </p>
                        )}
                      </div>
                      <TrendingDown
                        className="size-5 shrink-0 text-amber-500"
                        aria-hidden
                      />
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-border/80 shadow-sm">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-muted-foreground text-xs font-medium">
                          Low Stock
                        </p>
                        {isLoading ? (
                          <Skeleton className="mt-2 h-8 w-16" />
                        ) : (
                          <p className="text-foreground mt-1 text-2xl font-semibold tabular-nums">
                            {lowStockCount}
                          </p>
                        )}
                      </div>
                      <AlertTriangle
                        className="size-5 shrink-0 text-red-500"
                        aria-hidden
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : null}

          {view === "table" ? (
            <>
              {!isLoading && data.length > 0 ? (
                <div className="text-muted-foreground border-border border-b px-4 py-2.5 text-xs leading-none">
                  Showing {displayedItems.length} of {data.length} products
                </div>
              ) : null}
              {isLoading ? (
                <div className="space-y-3 px-6 py-6">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-md" />
                  ))}
                </div>
              ) : error ? null : (
                <Table className="border-separate border-spacing-x-3 border-spacing-y-0">
                <TableHeader>
                  <TableRow className="border-0 bg-muted/25 hover:bg-muted/25">
                    <TableHead className="text-muted-foreground h-10 min-w-[140px] px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide first:pl-4">
                      Product
                    </TableHead>
                    <TableHead className="text-muted-foreground min-w-0 px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Category
                    </TableHead>
                    <TableHead className="text-muted-foreground w-[11%] min-w-[6.5rem] px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Price
                    </TableHead>
                    <TableHead className="text-muted-foreground w-[11%] px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Stock
                    </TableHead>
                    <TableHead className="text-muted-foreground min-w-[7rem] px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Batch
                    </TableHead>
                    <TableHead className="text-muted-foreground min-w-[6.5rem] px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Expiry
                    </TableHead>
                    <TableHead className="text-muted-foreground min-w-[6.5rem] px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide">
                      Status
                    </TableHead>
                    <TableHead className="text-muted-foreground w-[4.5rem] px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide last:pr-4">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-muted-foreground px-6 py-12 text-center text-sm"
                      >
                        No inventory found. Upload an item and declare stock to
                        see it here.
                      </TableCell>
                    </TableRow>
                  ) : displayedItems.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-muted-foreground px-6 py-12 text-center text-sm"
                      >
                        No products match your search or filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    displayedItems.map((row) => {
                      const status = inventoryStatusPresentation(row.stock);
                      const expiryIso = row.batchExpiry?.trim();
                      const expiryFormatted = expiryIso
                        ? formatExpiryUs(expiryIso)
                        : null;
                      /** Only real batch/line expiry dates belong here — never EFDA reg. #s. */
                      const expiryDisplay = expiryFormatted ?? "—";
                      const showBelowMin =
                        row.stock > 0 && row.stock < INVENTORY_MIN_STOCK;

                      return (
                        <TableRow
                          key={row.itemCode}
                          className="border-border/50 hover:bg-muted/20 border-b last:border-b-0"
                        >
                          <TableCell className="text-foreground px-3 py-4 text-left align-top first:pl-4">
                            <div className="font-semibold leading-snug text-[#111827] dark:text-foreground">
                              {row.itemName}
                            </div>
                            <div className="text-muted-foreground mt-1 text-xs">
                              Unit item
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground px-3 py-4 text-left align-top text-sm">
                            {row.group?.trim() ? row.group : "—"}
                          </TableCell>
                          <TableCell className="px-3 py-4 text-left align-top">
                            <span className="font-semibold tabular-nums text-[#4F46E5]">
                              ETB{" "}
                              {row.price.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          </TableCell>
                          <TableCell className="px-3 py-4 text-left align-top">
                            <div className="flex flex-col gap-1">
                              <span className="font-semibold tabular-nums text-[#111827] text-sm dark:text-foreground">
                                {row.stock.toLocaleString(undefined, {
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                              {showBelowMin ? (
                                <span className="text-xs font-medium text-amber-600 dark:text-amber-500">
                                  Below min: {INVENTORY_MIN_STOCK}
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground px-3 py-4 text-left align-top">
                            <div className="font-mono text-xs tabular-nums">
                              {row.itemCode}
                            </div>
                            {row.efda?.trim() ? (
                              <div className="text-muted-foreground mt-1 text-xs">
                                EFDA: {row.efda}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-muted-foreground px-3 py-4 text-left align-top text-sm">
                            {expiryDisplay}
                          </TableCell>
                          <TableCell className="px-3 py-4 text-left align-top">
                            <Badge
                              className={cn(
                                "rounded-full px-2.5 py-0.5 text-xs",
                                status.badgeClass
                              )}
                            >
                              {status.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-3 py-4 text-left align-top last:pr-4">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={`Edit ${row.itemName}`}
                              onClick={() =>
                                router.push("/dashboard/sales/stock")
                              }
                            >
                              <Pencil className="size-4" aria-hidden />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            )}
            </>
          ) : (
            <div className="flex flex-col gap-6 p-6 pt-6">
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-48 w-full rounded-xl" />
              ))}
            </div>
          ) : data.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No inventory found. Upload an item and declare stock to see it
              here.
            </p>
          ) : displayedItems.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No products match your search or filters.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {displayedItems.map((row) => {
                const badge = stockStatusBadge(row.stock);
                const pct = stockBarPercent(row.stock);
                const showAddStock = row.stock < 50;
                return (
                  <Card
                    key={row.itemCode}
                    className="border-border/80 overflow-hidden shadow-sm"
                  >
                    <CardContent className="p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-foreground font-semibold">
                            {row.itemName}
                          </p>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {row.group || "—"}
                          </p>
                        </div>
                        <Badge
                          className={cn(
                            "shrink-0 px-2.5 py-0.5 text-xs font-semibold",
                            badge.className
                          )}
                        >
                          {badge.label}
                        </Badge>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                        <div>
                          <p className="text-muted-foreground text-xs">
                            Current Stock
                          </p>
                          <p className="text-foreground text-lg font-bold tabular-nums">
                            {row.stock.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs">
                            Min / Max
                          </p>
                          {/* TODO: Fetch reorder_level and reorder_qty from ERPNext Item DocType before beta */}
                          <p className="text-foreground font-medium tabular-nums">
                            — / —
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs">
                            Reorder Point
                          </p>
                          {/* TODO: Fetch reorder_level and reorder_qty from ERPNext Item DocType before beta */}
                          <p className="text-foreground font-medium tabular-nums">
                            —
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs">
                            Days Remaining
                          </p>
                          {/* TODO: Calculate from sales velocity once order analytics are built */}
                          <p className="text-foreground font-medium tabular-nums">
                            —
                          </p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-muted-foreground">
                            Stock level
                          </span>
                          <span className="text-foreground font-mono font-medium tabular-nums">
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                        <div className="bg-muted mt-1.5 h-2 w-full overflow-hidden rounded-full">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              barColorClass(row.stock)
                            )}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      </div>

                      {showAddStock ? (
                        <Button
                          type="button"
                          className="mt-4 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                          onClick={() =>
                            router.push("/dashboard/sales/stock")
                          }
                        >
                          Add Stock
                        </Button>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
            </div>
          )}
        </CardContent>
      </Card>

      {filterOpen ? (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby="inventory-filter-panel-title"
          className="border-border fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-background shadow-lg"
        >
          <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-4">
            <h2
              id="inventory-filter-panel-title"
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
              <Label className="text-base font-medium">Category</Label>
              <div className="space-y-2">
                {availableGroups.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    No categories in your catalog yet.
                  </p>
                ) : (
                  availableGroups.map((opt) => (
                    <label
                      key={opt}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={filters.itemGroups.includes(opt)}
                        onCheckedChange={(checked) => {
                          setFilters((d) => ({
                            ...d,
                            itemGroups:
                              checked === true
                                ? d.itemGroups.includes(opt)
                                  ? d.itemGroups
                                  : [...d.itemGroups, opt]
                                : d.itemGroups.filter((x) => x !== opt),
                          }));
                        }}
                      />
                      <span>{opt}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-base font-medium">Stock Status</Label>
              <div className="space-y-2">
                {STOCK_STATUS_OPTIONS.map((opt) => (
                  <label
                    key={opt}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={filters.stockStatus.includes(opt)}
                      onCheckedChange={(checked) => {
                        setFilters((d) => ({
                          ...d,
                          stockStatus:
                            checked === true
                              ? d.stockStatus.includes(opt)
                                ? d.stockStatus
                                : [...d.stockStatus, opt]
                              : d.stockStatus.filter((x) => x !== opt),
                        }));
                      }}
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-base font-medium">Batch Expiry</Label>
              <RadioGroup
                value={filters.expiryRange || "all"}
                onValueChange={(v) =>
                  setFilters((d) => ({
                    ...d,
                    expiryRange: v === "all" ? "" : v,
                  }))
                }
                className="gap-3"
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="all" id="inv-exp-all" />
                  All dates
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="3months" id="inv-exp-3" />
                  Expiring within 3 months
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="6months" id="inv-exp-6" />
                  Expiring within 6 months
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="after6months" id="inv-exp-after" />
                  Expiring after 6 months
                </label>
              </RadioGroup>
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
                clearAllFilters();
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
