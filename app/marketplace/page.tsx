"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import { isSupplierOwnListing } from "@/lib/marketplace-own-listing";
import { maskJweLikePublicString } from "@/lib/marketplace-display";
import { slugifyProductName } from "@/lib/marketplace-product-slug";
import { cn } from "@/lib/utils";
import type {
  MarketplaceOffer,
  MarketplaceProduct,
} from "@/types/marketplace";

const PAGE_SIZE = 50;

type CatalogPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

function offerQtyKey(genericName: string, index: number): string {
  return `${genericName}::${index}`;
}

/** Offer row — mobile card stack (<640px); horizontal row from sm; desktop at lg+. */
const OFFER_ROW_CLASS =
  "flex flex-col space-y-2 border-b p-2 transition-colors hover:bg-muted/50 last:border-b-0 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6 sm:gap-y-2 sm:space-y-0 lg:flex-nowrap lg:h-[74px]";

const OFFER_PRICE_STOCK_GROUP =
  "flex w-full items-center justify-between gap-2 sm:contents";

const OFFER_COL_VENDOR_GUEST = "hidden shrink-0 sm:p-2 lg:block lg:w-[90px]";
const OFFER_COL_VENDOR = "shrink-0 sm:p-2 lg:w-[90px]";
const OFFER_COL_PRICE_GUEST =
  "shrink-0 text-left sm:p-2 sm:text-right lg:w-[150px]";
const OFFER_COL_PRICE =
  "shrink-0 text-left sm:p-2 sm:text-right lg:w-[130px]";
const OFFER_COL_STOCK = "shrink-0 text-sm sm:p-2 lg:w-[90px]";
const OFFER_COL_EXPIRY =
  "min-w-0 w-full text-sm whitespace-normal sm:w-auto sm:shrink-0 sm:p-2 sm:min-w-[9rem]";
const OFFER_COL_ACTION =
  "flex w-full flex-col sm:ml-auto sm:w-auto sm:shrink-0 sm:p-2 sm:text-right lg:w-[190px]";

const DEFAULT_MARKETPLACE_FILTERS = {
  itemGroups: [] as string[],
  expiryRange: "" as string,
  priceMin: "" as string,
  priceMax: "" as string,
  vendorAliases: [] as string[],
  inStockOnly: false as boolean,
};

type MarketplaceFiltersState = typeof DEFAULT_MARKETPLACE_FILTERS;

/** Parses a price bound from filter text; NaN means no bound. */
function parsePriceBound(raw: string): number {
  const t = raw.trim();
  if (t === "") return Number.NaN;
  return parseFloat(t);
}

/** Resolves catalog group field (`group` or `itemGroup`). */
function getProductGroup(p: MarketplaceProduct): string {
  const raw = p as MarketplaceProduct & { group?: unknown };
  if (typeof raw.group === "string" && raw.group.trim().length > 0) {
    return raw.group.trim();
  }
  return (raw.itemGroup ?? "").trim();
}

function productMatchesSelectedGroups(
  productGroup: string,
  selected: string[]
): boolean {
  if (selected.length === 0) return true;
  const pg = productGroup.trim().toLowerCase();
  return selected.some((g) => g.trim().toLowerCase() === pg);
}

function startOfToday(): Date {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

function passesExpiryRangeFilter(
  earliestExpiry: string | null,
  expiryRange: string
): boolean {
  if (!expiryRange) return true;
  if (!earliestExpiry) return false;
  const s = earliestExpiry.trim().slice(0, 10);
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

/** Recompute summary fields from the remaining offers after filtering. */
function withFilteredOffers(
  product: MarketplaceProduct,
  offers: MarketplaceOffer[]
): MarketplaceProduct {
  const lowestPrice =
    offers.length > 0 ? Math.min(...offers.map((o) => o.price)) : 0;
  const totalStock = offers.reduce((acc, o) => acc + o.stock, 0);
  const supplierCount = new Set(offers.map((o) => o.vendorAlias)).size;
  return {
    ...product,
    offers,
    lowestPrice,
    totalStock,
    supplierCount,
  };
}

/** Returns the product with offers filtered, or null if the product should be hidden. */
function filterProduct(
  product: MarketplaceProduct,
  filters: MarketplaceFiltersState
): MarketplaceProduct | null {
  if (filters.itemGroups.length > 0) {
    const g = getProductGroup(product);
    if (!productMatchesSelectedGroups(g, filters.itemGroups)) {
      return null;
    }
  }

  const minPrice = parsePriceBound(filters.priceMin);
  const maxPrice = parsePriceBound(filters.priceMax);

  const offers = product.offers.filter((offer) => {
    if (!Number.isNaN(minPrice) && offer.price < minPrice) return false;
    if (!Number.isNaN(maxPrice) && offer.price > maxPrice) return false;

    if (filters.expiryRange) {
      if (!passesExpiryRangeFilter(offer.batchExpiry, filters.expiryRange)) {
        return false;
      }
    }

    if (filters.vendorAliases.length > 0) {
      if (!filters.vendorAliases.includes(offer.vendorAlias)) return false;
    }

    if (filters.inStockOnly && offer.stock <= 0) return false;

    return true;
  });

  if (offers.length === 0) return null;

  return withFilteredOffers(product, offers);
}

function applyFilters(
  productList: MarketplaceProduct[],
  filters: MarketplaceFiltersState
): MarketplaceProduct[] {
  const out: MarketplaceProduct[] = [];
  for (const product of productList) {
    const fp = filterProduct(product, filters);
    if (fp) out.push(fp);
  }
  return out;
}

function countActiveFilters(f: MarketplaceFiltersState): number {
  let n = f.itemGroups.length + f.vendorAliases.length;
  if (f.expiryRange) n += 1;
  if (f.priceMin.trim() !== "" || f.priceMax.trim() !== "") n += 1;
  if (f.inStockOnly) n += 1;
  return n;
}

function expiryRangeLabel(range: string): string {
  if (range === "3months") return "Expiring within 3 months";
  if (range === "6months") return "Expiring within 6 months";
  if (range === "after6months") return "Expiring after 6 months";
  return range;
}

function parseExpiryDate(iso: string): Date | null {
  const s = iso.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Days from start of today to expiry (negative = past). */
function daysFromTodayToExpiry(iso: string): number {
  const exp = parseExpiryDate(iso);
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

function formatExpiryLong(iso: string): string {
  const d = parseExpiryDate(iso);
  if (!d) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(d);
}

type ExpiryVisual = "normal" | "amber" | "red";

function marketplaceExpiryVisual(
  batchExpiry: string | null | undefined
): ExpiryVisual {
  if (batchExpiry == null || batchExpiry === "") return "normal";
  const days = daysFromTodayToExpiry(batchExpiry);
  if (days < 0 || days <= 90) return "red";
  if (days <= 180) return "amber";
  return "normal";
}

function showAddToCartExpiryNote(
  batchExpiry: string | null | undefined
): boolean {
  if (batchExpiry == null || batchExpiry === "") return false;
  const days = daysFromTodayToExpiry(batchExpiry);
  return days >= 0 && days <= 180;
}

function parseCatalogPayload(json: unknown): {
  products: MarketplaceProduct[];
  pagination: CatalogPagination | null;
} {
  if (Array.isArray(json)) {
    return { products: json as MarketplaceProduct[], pagination: null };
  }
  if (
    json &&
    typeof json === "object" &&
    "products" in json &&
    Array.isArray((json as { products: unknown }).products)
  ) {
    const o = json as {
      products: MarketplaceProduct[];
      pagination?: CatalogPagination;
    };
    return {
      products: o.products,
      pagination: o.pagination ?? null,
    };
  }
  return { products: [], pagination: null };
}

const GUEST_MARKETPLACE_LOGIN_HREF = `/login?callbackUrl=${encodeURIComponent(
  "/marketplace"
)}`;

/** Earliest batch expiry among offers (YYYY-MM-DD sort). */
function earliestOfferExpiry(
  offers: MarketplaceProduct["offers"]
): string | null {
  const dates = offers
    .map((o) => o.batchExpiry)
    .filter((d): d is string => typeof d === "string" && d.trim().length > 0);
  if (dates.length === 0) return null;
  return [...dates].sort()[0] ?? null;
}

function buildPaginationItems(
  current: number,
  totalPages: number
): (number | "ellipsis")[] {
  if (totalPages <= 1) return [1];
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const set = new Set<number>();
  set.add(1);
  set.add(totalPages);
  for (let d = -2; d <= 2; d++) {
    const p = current + d;
    if (p >= 1 && p <= totalPages) set.add(p);
  }
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | "ellipsis")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push("ellipsis");
    out.push(p);
    prev = p;
  }
  return out;
}

function MarketplacePageContent() {
  const router = useRouter();
  const authFetch = useAuthFetch();
  const authFetchRef = React.useRef(authFetch);
  authFetchRef.current = authFetch;
  const searchParams = useSearchParams();
  const currentPage = Math.max(
    1,
    parseInt(searchParams.get("page") ?? "1", 10) || 1
  );

  const [products, setProducts] = React.useState<MarketplaceProduct[]>([]);
  const [pagination, setPagination] = React.useState<CatalogPagination | null>(
    null
  );
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [filters, setFilters] = React.useState<MarketplaceFiltersState>(() => ({
    ...DEFAULT_MARKETPLACE_FILTERS,
  }));
  const [priceDraft, setPriceDraft] = React.useState({ min: "", max: "" });
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [supplierDocName, setSupplierDocName] = React.useState<string | null>(
    null
  );
  const [supplierGroup, setSupplierGroup] = React.useState<string | null>(
    null
  );
  const [offerQtys, setOfferQtys] = React.useState<Record<string, string>>({});
  const [cartPending, setCartPending] = React.useState<string | null>(null);
  const tableRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json().catch(() => ({})))
      .then(
        (json: {
          authenticated?: boolean;
          supplierDocName?: string | null;
          supplierGroup?: string | null;
        }) => {
          if (!cancelled) {
            setIsAuthenticated(json.authenticated === true);
            setSupplierDocName(
              typeof json.supplierDocName === "string"
                ? json.supplierDocName
                : null
            );
            setSupplierGroup(
              typeof json.supplierGroup === "string"
                ? json.supplierGroup
                : null
            );
          }
        }
      )
      .catch(() => {
        if (!cancelled) {
          setIsAuthenticated(false);
          setSupplierDocName(null);
          setSupplierGroup(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const catalogRes = await authFetchRef.current(
          `/api/marketplace/catalog?page=${currentPage}&pageSize=${PAGE_SIZE}`
        );

        if (catalogRes.status === 401) {
          return;
        }

        if (!catalogRes.ok) {
          const err = await catalogRes.json().catch(() => ({}));
          throw new Error(
            typeof err.error === "string" ? err.error : "Failed to load catalog"
          );
        }

        const raw: unknown = await catalogRes.json();
        const { products: rows, pagination: pag } = parseCatalogPayload(raw);
        if (!cancelled) {
          setProducts(rows);
          setPagination(pag);
        }
      } catch (e) {
        if (!cancelled) {
          toast.error(
            e instanceof Error ? e.message : "Failed to load marketplace"
          );
          setProducts([]);
          setPagination(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [currentPage]);

  React.useEffect(() => {
    tableRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentPage]);

  const availableGroups = React.useMemo(() => {
    const s = new Set<string>();
    for (const p of products) {
      const g = getProductGroup(p);
      if (g) s.add(g);
    }
    return [...s].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [products]);

  React.useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.log(
      "Product groups:",
      products.map((p) => getProductGroup(p))
    );
    console.log("Selected groups:", filters.itemGroups);
  }, [products, filters.itemGroups]);

  React.useEffect(() => {
    if (!filterOpen) return;
    const id = window.setTimeout(() => {
      setFilters((f) => ({
        ...f,
        priceMin: priceDraft.min,
        priceMax: priceDraft.max,
      }));
    }, 500);
    return () => window.clearTimeout(id);
  }, [priceDraft.min, priceDraft.max, filterOpen]);

  /** While the filter panel is open, price bounds live in `priceDraft` until debounce syncs to `filters`; merge so listing is not stale. */
  const displayFilters = React.useMemo((): MarketplaceFiltersState => {
    if (!filterOpen) return filters;
    return {
      ...filters,
      priceMin: priceDraft.min,
      priceMax: priceDraft.max,
    };
  }, [filters, filterOpen, priceDraft.min, priceDraft.max]);

  const searchedProducts = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      p.genericName.toLowerCase().includes(q)
    );
  }, [products, searchQuery]);

  /** Same as current filters but without vendor selection — drives supplier checklist from offers that pass other filters. */
  const filtersSansVendor = React.useMemo(
    (): MarketplaceFiltersState => ({
      ...displayFilters,
      vendorAliases: [],
    }),
    [displayFilters]
  );

  const vendorAliasOptions = React.useMemo(() => {
    const s = new Set<string>();
    for (const p of searchedProducts) {
      const fp = filterProduct(p, filtersSansVendor);
      if (!fp) continue;
      for (const o of fp.offers) {
        if (o.vendorAlias?.trim()) s.add(o.vendorAlias.trim());
      }
    }
    return [...s].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [searchedProducts, filtersSansVendor]);

  const filtered = React.useMemo(
    () => applyFilters(searchedProducts, displayFilters),
    [searchedProducts, displayFilters]
  );

  const activeFilterCount = countActiveFilters(displayFilters);

  function closeFilterPanel() {
    setFilters((f) => ({
      ...f,
      priceMin: priceDraft.min,
      priceMax: priceDraft.max,
    }));
    setFilterOpen(false);
  }

  function clearAllFilters() {
    setFilters({ ...DEFAULT_MARKETPLACE_FILTERS });
    setPriceDraft({ min: "", max: "" });
  }

  React.useEffect(() => {
    if (!filterOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFilters((f) => ({
          ...f,
          priceMin: priceDraft.min,
          priceMax: priceDraft.max,
        }));
        setFilterOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filterOpen, priceDraft.min, priceDraft.max]);

  function goToPage(pageNum: number) {
    router.push(`/marketplace?page=${pageNum}`);
  }

  function setQty(key: string, value: string) {
    setOfferQtys((prev) => ({ ...prev, [key]: value }));
  }

  function getQty(key: string, maxStock: number): number {
    const raw = offerQtys[key];
    const n = raw === undefined ? 1 : Number.parseInt(String(raw), 10);
    if (Number.isNaN(n) || n < 1) return 1;
    const cap = Math.floor(maxStock);
    if (cap < 1) return 1;
    return Math.min(n, cap);
  }

  async function handleAddToCart(
    genericName: string,
    offerIndex: number,
    offer: MarketplaceOffer
  ) {
    const key = offerQtyKey(genericName, offerIndex);
    const qty = getQty(key, offer.stock);

    if (!isAuthenticated) {
      const path =
        typeof window !== "undefined"
          ? window.location.pathname
          : "/marketplace";
      const loginUrl = `/login?callbackUrl=${encodeURIComponent(path)}`;
      toast.info("Sign in to add items to your cart.");
      router.push(loginUrl);
      return;
    }

    setCartPending(key);
    try {
      const res = await authFetchRef.current("/api/marketplace/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerToken: offer.offerToken,
          qty,
          genericName,
          uom: offer.uom,
        }),
      });

      if (res.status === 401) {
        return;
      }

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };

      if (res.status === 400) {
        const msg =
          typeof data.error === "string" ? data.error.toLowerCase() : "";
        if (
          msg.includes("expired") ||
          msg.includes("offer has expired") ||
          msg.includes("refresh the catalog")
        ) {
          toast.error("Price has updated. Please refresh the page.");
        } else {
          toast.error(
            typeof data.error === "string"
              ? data.error
              : "Could not add to cart"
          );
        }
        return;
      }

      if (!res.ok) {
        toast.error(
          typeof data.error === "string" ? data.error : "Could not add to cart"
        );
        return;
      }

      toast.success(
        typeof data.message === "string" ? data.message : "Item added to cart"
      );
      window.dispatchEvent(new Event("bamys-cart-updated"));
    } catch {
      toast.error("Could not add to cart");
    } finally {
      setCartPending(null);
    }
  }

  const total = pagination?.total ?? 0;
  const pageSize = pagination?.pageSize ?? PAGE_SIZE;
  const page = pagination?.page ?? currentPage;
  const totalPages = pagination?.totalPages ?? 1;
  const hasPrev = pagination?.hasPrevPage ?? page > 1;
  const hasNext = pagination?.hasNextPage ?? false;
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const pageItems = buildPaginationItems(page, totalPages);

  return (
    <TooltipProvider delayDuration={200}>
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
      {!isAuthenticated && !isLoading ? (
        <p
          className="border-border bg-muted/50 text-muted-foreground mb-4 rounded-lg border px-4 py-3 text-sm leading-relaxed"
          role="note"
        >
          Sign in to view final tax-inclusive pricing and complete your
          purchase.
        </p>
      ) : null}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Input
            type="search"
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-[46px] min-w-0 flex-1"
            aria-label="Search medications"
          />
          <Button
            type="button"
            variant="outline"
            className="border-[#d1d5dc] bg-white relative h-[46px] shrink-0 gap-2 px-4"
            onClick={() => {
              setPriceDraft({ min: filters.priceMin, max: filters.priceMax });
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
        {!isLoading && products.length > 0 ? (
          <p className="text-muted-foreground shrink-0 text-sm sm:ml-auto">
            Showing {filtered.length} of {products.length} medications
          </p>
        ) : null}
      </div>
      {activeFilterCount > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
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
          {filters.expiryRange ? (
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...f, expiryRange: "" }))}
              className="border-border bg-muted/50 text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
            >
              Expiry: {expiryRangeLabel(filters.expiryRange)}
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
          {displayFilters.priceMin.trim() !== "" ||
          displayFilters.priceMax.trim() !== "" ? (
            <button
              type="button"
              onClick={() => {
                setFilters((f) => ({
                  ...f,
                  priceMin: "",
                  priceMax: "",
                }));
                setPriceDraft({ min: "", max: "" });
              }}
              className="border-border bg-muted/50 text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
            >
              {displayFilters.priceMin.trim() !== "" &&
              displayFilters.priceMax.trim() !== ""
                ? `ETB ${displayFilters.priceMin.trim()}–${displayFilters.priceMax.trim()}`
                : displayFilters.priceMin.trim() !== ""
                  ? `Price from ETB ${displayFilters.priceMin.trim()}`
                  : `Price up to ETB ${displayFilters.priceMax.trim()}`}
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
          {filters.vendorAliases.map((v) => (
            <button
              key={`va-${v}`}
              type="button"
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  vendorAliases: f.vendorAliases.filter((x) => x !== v),
                }))
              }
              className="border-border bg-muted/50 text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
            >
              {v}
              <X className="size-3.5" aria-hidden />
            </button>
          ))}
          {filters.inStockOnly ? (
            <button
              type="button"
              onClick={() =>
                setFilters((f) => ({ ...f, inStockOnly: false }))
              }
              className="border-border bg-muted/50 text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
            >
              In stock only
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}

      {filterOpen ? (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby="filter-panel-title"
          className="border-border fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-background shadow-lg"
        >
          <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-4">
            <h2 id="filter-panel-title" className="text-base font-medium">
              Filters
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={closeFilterPanel}
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
                    No categories on this page.
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
                  <RadioGroupItem value="all" id="exp-all" />
                  All dates
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="3months" id="exp-3" />
                  Expiring within 3 months
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="6months" id="exp-6" />
                  Expiring within 6 months
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="after6months" id="exp-after" />
                  Expiring after 6 months
                </label>
              </RadioGroup>
            </div>
            <div className="space-y-3">
              <Label className="text-base font-medium">Unit Price (ETB)</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="price-min" className="text-muted-foreground text-xs">
                    Min price
                  </Label>
                  <Input
                    id="price-min"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    placeholder="0"
                    value={priceDraft.min}
                    onChange={(e) =>
                      setPriceDraft((d) => ({ ...d, min: e.target.value }))
                    }
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="price-max" className="text-muted-foreground text-xs">
                    Max price
                  </Label>
                  <Input
                    id="price-max"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    placeholder="Any"
                    value={priceDraft.max}
                    onChange={(e) =>
                      setPriceDraft((d) => ({ ...d, max: e.target.value }))
                    }
                    className="h-10"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-base font-medium">Supplier</Label>
              <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                {vendorAliasOptions.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    No suppliers on this page.
                  </p>
                ) : (
                  vendorAliasOptions.map((alias) => (
                    <label
                      key={alias}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={filters.vendorAliases.includes(alias)}
                        onCheckedChange={(checked) => {
                          setFilters((d) => ({
                            ...d,
                            vendorAliases:
                              checked === true
                                ? d.vendorAliases.includes(alias)
                                  ? d.vendorAliases
                                  : [...d.vendorAliases, alias]
                                : d.vendorAliases.filter((x) => x !== alias),
                          }));
                        }}
                      />
                      <span>{alias}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-3">
              <Label className="text-base font-medium">Availability</Label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={filters.inStockOnly}
                  onCheckedChange={(checked) =>
                    setFilters((d) => ({
                      ...d,
                      inStockOnly: checked === true,
                    }))
                  }
                />
                In stock only
              </label>
            </div>
          </div>
          <div className="border-border flex shrink-0 flex-col gap-2 border-t p-4 pt-4">
            <Button
              type="button"
              className="h-11 w-full bg-indigo-600 text-white hover:bg-indigo-700"
              onClick={closeFilterPanel}
            >
              Done ({countActiveFilters(filters)} active)
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              onClick={clearAllFilters}
            >
              Clear All Filters
            </Button>
          </div>
        </div>
      ) : null}

      <div ref={tableRef} className="space-y-4">
        {!isLoading && total > 0 ? (
          <p className="text-muted-foreground text-sm">
            Showing {rangeStart}–{rangeEnd} of {total} medications
          </p>
        ) : null}

        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-[10px]" />
          ))
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground rounded-[10px] border border-[#e5e7eb] bg-white py-12 text-center">
            {products.length === 0
              ? "No products available right now."
              : "No medications match your search."}
          </div>
        ) : (
          filtered.map((p) => {
            const guestExpiry = earliestOfferExpiry(p.offers);
            const guestExpiryVis = marketplaceExpiryVisual(guestExpiry);
            const guestAnyInStock = p.offers.some((o) => o.stock > 0);
            return (
              <div
                key={p.genericName}
                className="rounded-[10px] border border-[#e5e7eb] bg-white p-3 md:p-4"
              >
                <div className="mb-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-xl font-semibold text-[#0a0a0a]">
                      {p.genericName}
                    </h3>
                    <Badge
                      variant="secondary"
                      className="rounded-md border-0 bg-[#f3f4f6] text-[#4a5565]"
                    >
                      {p.itemGroup || "—"}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="rounded-md border-0 bg-emerald-50 text-emerald-700"
                    >
                      ✓ Verified
                    </Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-[#d1d5dc] bg-white text-[#364153]"
                      onClick={() =>
                        router.push(
                          `/marketplace/product/${slugifyProductName(p.genericName)}`
                        )
                      }
                    >
                      View Details
                    </Button>
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">
                    <span className="font-mono tabular-nums">
                      {p.supplierCount}
                    </span>{" "}
                    {p.supplierCount !== 1 ? "suppliers" : "supplier"} available
                  </p>
                </div>
                <div className="overflow-x-auto rounded-[10px] border border-[#e5e7eb]">
                  <div className="w-full min-w-0">
                      {!isAuthenticated ? (
                        <div className={OFFER_ROW_CLASS}>
                          <div className={OFFER_COL_VENDOR_GUEST} aria-hidden />
                          <div className={OFFER_PRICE_STOCK_GROUP}>
                            <div className={OFFER_COL_PRICE_GUEST}>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="border-[#d1d5dc] bg-white text-[#364153]"
                                onClick={() =>
                                  router.push(GUEST_MARKETPLACE_LOGIN_HREF)
                                }
                              >
                                Sign in to view pricing
                              </Button>
                            </div>
                            <div className={OFFER_COL_STOCK}>
                              {guestAnyInStock ? (
                                <Badge className="border-0 bg-emerald-100 text-emerald-900 hover:bg-emerald-100">
                                  In Stock
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="border-0">
                                  Out of Stock
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className={OFFER_COL_EXPIRY}>
                            {guestExpiry ? (
                              <div
                                className={cn(
                                  "font-mono tabular-nums",
                                  guestExpiryVis === "red"
                                    ? "text-destructive font-semibold"
                                    : guestExpiryVis === "amber"
                                      ? "text-[#e17100] font-medium"
                                      : "text-[#4a5565]"
                                )}
                              >
                                <span className="text-xs uppercase tracking-wide text-muted-foreground">Exp: </span>
                                {formatExpiryLong(guestExpiry)}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">
                                No batch on record
                              </span>
                            )}
                          </div>
                          <div className={OFFER_COL_ACTION}>
                            <Button
                              asChild
                              type="button"
                              size="sm"
                              className="w-full sm:w-auto"
                            >
                              <Link href={GUEST_MARKETPLACE_LOGIN_HREF}>
                                Sign in to purchase
                              </Link>
                            </Button>
                          </div>
                        </div>
                      ) : (
                        p.offers.map((offer, idx) => {
                          const qk = offerQtyKey(p.genericName, idx);
                          const pending = cartPending === qk;
                          const maxQ = Math.floor(offer.stock);
                          const batchExpiry = offer.batchExpiry ?? null;
                          const batchLabel = offer.batchLabel ?? null;
                          const showBatchLabel =
                            batchLabel !== null &&
                            batchLabel.toLowerCase() !== "standard";
                          const ev = marketplaceExpiryVisual(batchExpiry);
                          const expiryNote = showAddToCartExpiryNote(batchExpiry);
                          const ownListing = isSupplierOwnListing(
                            offer,
                            supplierDocName,
                            supplierGroup
                          );
                          const row = (
                            <div
                              className={cn(
                                OFFER_ROW_CLASS,
                                ownListing && "bg-muted/40"
                              )}
                            >
                              <div className={OFFER_COL_VENDOR}>
                                <div
                                  className="text-sm font-medium text-[#0a0a0a]"
                                  data-supplier-id={maskJweLikePublicString(
                                    offer.vendorAlias
                                  )}
                                >
                                  {offer.vendorAlias}
                                </div>
                              </div>
                              <div className={OFFER_PRICE_STOCK_GROUP}>
                                <div className={OFFER_COL_PRICE}>
                                  <div className="text-sm font-medium text-[#0F172A]">ETB</div>
                                  <div className="font-mono text-2xl font-bold tabular-nums text-[#0F172A]">
                                    {offer.price.toLocaleString(undefined, {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                                  </div>
                                  <div className="text-muted-foreground text-[12px] font-normal">
                                    {offer.uom}
                                  </div>
                                </div>
                                <div className={OFFER_COL_STOCK}>
                                  <div
                                    className="flex items-center gap-1.5 text-sm"
                                    title={`Stock: ${offer.stock}`}
                                  >
                                    <span
                                      className={cn(
                                        "size-2 rounded-full",
                                        offer.stock > 500
                                          ? "bg-emerald-500"
                                          : offer.stock >= 50
                                            ? "bg-amber-500"
                                            : "bg-red-500"
                                      )}
                                    />
                                    {offer.stock > 500
                                      ? "In Stock"
                                      : offer.stock >= 50
                                        ? "Limited"
                                        : "Low Stock"}
                                  </div>
                                </div>
                              </div>
                              <div className={OFFER_COL_EXPIRY}>
                                {batchExpiry ? (
                                  <div className="space-y-0.5">
                                    <div
                                      className={cn(
                                        "font-mono tabular-nums",
                                        ev === "red"
                                          ? "text-destructive font-semibold"
                                          : ev === "amber"
                                            ? "text-[#e17100] font-medium"
                                            : "text-[#4a5565]"
                                      )}
                                    >
                                      <span className="text-xs uppercase tracking-wide text-muted-foreground">Exp: </span>
                                      {formatExpiryLong(batchExpiry)}
                                    </div>
                                    <div className="text-muted-foreground text-[12px]">
                                      {showBatchLabel ? (
                                        <>
                                          <span className="text-xs uppercase tracking-wide text-muted-foreground">Batch: </span>
                                          {batchLabel}
                                        </>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">
                                    No batch on record
                                  </span>
                                )}
                              </div>
                              <div className={OFFER_COL_ACTION}>
                                {ownListing ? (
                                  <Badge
                                    variant="secondary"
                                    className="w-full justify-center border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 sm:w-auto"
                                  >
                                    Your Listing
                                  </Badge>
                                ) : (
                                  <>
                                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                                      <Input
                                        type="number"
                                        min={1}
                                        max={maxQ > 0 ? maxQ : 1}
                                        step={1}
                                        className="h-9 w-full shrink-0 font-mono tabular-nums sm:w-20"
                                        value={offerQtys[qk] ?? "1"}
                                        onChange={(e) =>
                                          setQty(qk, e.target.value)
                                        }
                                        disabled={maxQ <= 0}
                                        aria-label={`Quantity for ${offer.vendorAlias}`}
                                      />
                                      <Button
                                        type="button"
                                        size="sm"
                                        disabled={offer.stock <= 0 || pending}
                                        onClick={() =>
                                          void handleAddToCart(
                                            p.genericName,
                                            idx,
                                            offer
                                          )
                                        }
                                        className="w-full shrink-0 sm:w-auto"
                                      >
                                        {pending ? (
                                          <Loader2 className="size-4 animate-spin" />
                                        ) : (
                                          "Add to Cart"
                                        )}
                                      </Button>
                                    </div>
                                    {expiryNote && batchExpiry != null ? (
                                      <p className="text-muted-foreground mt-2 max-w-none text-xs leading-snug sm:mt-1 sm:max-w-[16rem]">
                                        Note: This batch expires{" "}
                                        {formatExpiryLong(batchExpiry)}.
                                      </p>
                                    ) : null}
                                  </>
                                )}
                              </div>
                            </div>
                          );
                          return ownListing ? (
                            <Tooltip key={qk}>
                              <TooltipTrigger asChild>{row}</TooltipTrigger>
                              <TooltipContent side="top">
                                You cannot purchase your own listings
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <React.Fragment key={qk}>{row}</React.Fragment>
                          );
                        })
                      )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {!isLoading && totalPages > 1 ? (
          <div className="space-y-3 pt-2">
            <p className="text-muted-foreground text-center text-sm">
              Page {page} of {totalPages}
            </p>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    disabled={!hasPrev}
                    onClick={() => hasPrev && goToPage(page - 1)}
                  >
                    <ChevronLeft className="size-4" />
                    Previous
                  </PaginationPrevious>
                </PaginationItem>
                {pageItems.map((item, i) =>
                  item === "ellipsis" ? (
                    <PaginationItem key={`e-${i}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={item}>
                      <PaginationLink
                        isActive={item === page}
                        onClick={() => goToPage(item)}
                      >
                        {item}
                      </PaginationLink>
                    </PaginationItem>
                  )
                )}
                <PaginationItem>
                  <PaginationNext
                    disabled={!hasNext}
                    onClick={() => hasNext && goToPage(page + 1)}
                  >
                    Next
                    <ChevronRight className="size-4" />
                  </PaginationNext>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        ) : null}
      </div>

      <p className="text-muted-foreground mt-6 text-center text-xs">
        Prices and stock are indicative.{" "}
        <Link
          href="/login"
          className="text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>{" "}
        to purchase.
      </p>
    </div>
    </TooltipProvider>
  );
}

export default function MarketplacePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 py-8">
          <Skeleton className="h-10 w-48" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-[10px]" />
            ))}
          </div>
        </div>
      }
    >
      <MarketplacePageContent />
    </Suspense>
  );
}
