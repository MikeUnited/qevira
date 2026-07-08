"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Calendar,
  Loader2,
  Minus,
  Plus,
  Shield,
  ShoppingCart,
  Tag,
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuthFetch } from "@/hooks/use-auth-fetch";
import {
  firstNonOwnOfferIndex,
  isSupplierOwnListing,
} from "@/lib/marketplace-own-listing";
import { slugifyProductName } from "@/lib/marketplace-product-slug";
import { maskJweLikePublicString } from "@/lib/marketplace-display";
import { cn } from "@/lib/utils";
import type { MarketplaceOffer, MarketplaceProduct } from "@/types/marketplace";

const PAGE_SIZE = 100;

type CatalogPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

function parseCatalogPayload(json: unknown): {
  products: MarketplaceProduct[];
  pagination: CatalogPagination | null;
} {
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

function parseExpiryDate(iso: string): Date | null {
  const s = iso.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

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

function formatMoney(n: number) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function earliestOfferExpiry(
  offers: MarketplaceProduct["offers"]
): string | null {
  const dates = offers
    .map((o) => o.batchExpiry)
    .filter((d): d is string => typeof d === "string" && d.trim().length > 0);
  if (dates.length === 0) return null;
  return [...dates].sort()[0] ?? null;
}

export default function MarketplaceProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = typeof params.slug === "string" ? params.slug : "";

  const loginReturnHref = `/login?callbackUrl=${encodeURIComponent(
    `/marketplace/product/${slug}`
  )}`;

  const authFetch = useAuthFetch();
  const authFetchRef = React.useRef(authFetch);
  authFetchRef.current = authFetch;

  const [product, setProduct] = React.useState<MarketplaceProduct | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [supplierDocName, setSupplierDocName] = React.useState<string | null>(
    null
  );
  const [supplierGroup, setSupplierGroup] = React.useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [qty, setQty] = React.useState(1);
  const [cartPending, setCartPending] = React.useState(false);

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
      setLoading(true);
      setError(null);
      try {
        const searchQ = slug.replace(/-/g, " ").trim();
        const q = encodeURIComponent(searchQ);
        const res = await fetch(
          `/api/marketplace/catalog?search=${q}&pageSize=${PAGE_SIZE}&page=1`,
          { credentials: "include" }
        );
        const raw2 = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = raw2 as { error?: string };
          throw new Error(
            typeof err.error === "string" ? err.error : "Failed to load product"
          );
        }
        const { products } = parseCatalogPayload(raw2);
        const match = products.find(
          (p) => slugifyProductName(p.genericName) === slug
        );
        if (!cancelled) {
          if (!match) {
            setProduct(null);
            setError("Product not found.");
          } else {
            setProduct(match);
            setSelectedIdx(0);
            setQty(1);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
          setProduct(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (slug) void load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const selectedOffer = product?.offers[selectedIdx];
  const maxQty = selectedOffer
    ? Math.max(1, Math.floor(selectedOffer.stock))
    : 1;

  React.useEffect(() => {
    setQty((q) => Math.min(Math.max(1, q), maxQty));
  }, [maxQty, selectedIdx]);

  React.useEffect(() => {
    if (!product?.offers.length) return;
    setSelectedIdx(
      firstNonOwnOfferIndex(
        product.offers,
        supplierDocName,
        supplierGroup
      )
    );
  }, [product?.genericName, supplierDocName, supplierGroup]);

  async function handleAddToCart() {
    if (!product || !selectedOffer) return;

    if (
      isSupplierOwnListing(selectedOffer, supplierDocName, supplierGroup)
    ) {
      toast.info("You cannot purchase your own listings.");
      return;
    }

    if (!isAuthenticated) {
      router.push(loginReturnHref);
      toast.info("Sign in to add items to your cart.");
      return;
    }

    setCartPending(true);
    try {
      const res = await authFetchRef.current("/api/marketplace/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerToken: selectedOffer.offerToken,
          qty,
          genericName: product.genericName,
          uom: selectedOffer.uom,
        }),
      });

      if (res.status === 401) {
        return;
      }

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };

      if (res.status === 403) {
        const msg =
          typeof data.error === "string" ? data.error : "You cannot add this item.";
        toast.error(msg);
        return;
      }

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
            typeof data.error === "string" ? data.error : "Could not add to cart"
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
      setCartPending(false);
    }
  }

  const subtotal = selectedOffer ? selectedOffer.price * qty : 0;
  const desc =
    product?.description?.trim() ||
    (product?.efda && product.efda.trim()
      ? `EFDA Reg: ${product.efda.trim()}`
      : null);

  const guestEarliestExpiry = product
    ? earliestOfferExpiry(product.offers)
    : null;
  const guestAnyInStock = product
    ? product.offers.some((o) => o.stock > 0)
    : false;
  const guestExpiryVisual = marketplaceExpiryVisual(guestEarliestExpiry);

  const selectedOwn =
    selectedOffer &&
    isSupplierOwnListing(selectedOffer, supplierDocName, supplierGroup);

  return (
    <TooltipProvider delayDuration={200}>
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
      <Link
        href="/marketplace"
        className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-2 text-sm font-medium transition-colors"
      >
        ← Back to Marketplace
      </Link>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : error || !product ? (
        <Card className="border-destructive/30">
          <CardContent className="py-8 text-center text-sm">
            {error ?? "Product not found."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,35%)] lg:items-start">
          <div className="min-w-0 space-y-6">
            {!isAuthenticated ? (
              <p
                className="border-border bg-muted/50 text-muted-foreground rounded-lg border px-4 py-3 text-sm leading-relaxed"
                role="note"
              >
                Sign in to view live pricing, stock levels, and supplier offers.
              </p>
            ) : null}
            <p className="text-muted-foreground text-sm leading-none">
              {product.itemGroup || "Medication"}
            </p>
            <h1 className="text-foreground text-3xl font-bold tracking-tight md:text-4xl">
              {product.genericName}
            </h1>
            {desc ? (
              <p className="text-muted-foreground text-base leading-relaxed">
                {desc}
              </p>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Product Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {product.description?.trim() ? (
                  <div>
                    <p className="text-foreground font-medium">Description</p>
                    <p className="text-muted-foreground mt-1 text-pretty">
                      {product.description.trim()}
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    Product information as registered with EFDA.
                  </p>
                )}
                <div className="flex items-start gap-2">
                  <Shield className="text-sidebar-foreground/80 mt-0.5 size-4 shrink-0" />
                  <span>
                    <span className="text-foreground font-medium">
                      EFDA Registration:{" "}
                    </span>
                    <span className="font-mono tabular-nums">
                      {product.efda?.trim() || "—"}
                    </span>
                  </span>
                </div>
                <p>
                  <span className="text-foreground font-medium">Category: </span>
                  {product.itemGroup || "—"}
                </p>
                <p>
                  <span className="text-foreground font-medium">
                    Unit of Measure:{" "}
                  </span>
                  <span className="font-mono">{product.uom || "—"}</span>
                </p>
              </CardContent>
            </Card>

            <div>
              <h2 className="text-foreground mb-3 text-lg font-semibold">
                Available Suppliers ({product.offers.length})
              </h2>
              {!isAuthenticated ? (
                <div className="rounded-xl border border-[#e5e7eb] bg-white p-4">
                  <p className="text-foreground text-[15px] font-medium">
                    {product.offers.length} verified suppliers available
                  </p>
                  <p className="text-muted-foreground mt-2 text-sm">
                    Sign in to compare offers and see supplier-level pricing.
                  </p>
                  {guestEarliestExpiry ? (
                    <p
                      className={cn(
                        "mt-3 inline-flex items-center gap-2 font-mono text-sm tabular-nums",
                        guestExpiryVisual === "red"
                          ? "text-destructive font-semibold"
                          : guestExpiryVisual === "amber"
                            ? "text-[#e17100] font-medium"
                            : "text-[#4a5565]"
                      )}
                    >
                      <Calendar className="size-4 shrink-0" />
                      Next batch expiry: {formatExpiryLong(guestEarliestExpiry)}
                    </p>
                  ) : (
                    <p className="text-muted-foreground mt-3 text-sm">
                      No batch on record
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {product.offers.map((offer, idx) => {
                    const ev = marketplaceExpiryVisual(offer.batchExpiry);
                    const low = offer.stock < 10;
                    const selected = selectedIdx === idx;
                    const ownListing = isSupplierOwnListing(
                      offer,
                      supplierDocName,
                      supplierGroup
                    );
                    const card = (
                      <button
                        type="button"
                        disabled={ownListing}
                        onClick={() => {
                          if (ownListing) return;
                          setSelectedIdx(idx);
                          setQty(1);
                        }}
                        className={cn(
                          "w-full rounded-xl border bg-white p-4 text-left transition-colors",
                          ownListing &&
                            "cursor-not-allowed opacity-90",
                          !ownListing &&
                            selected &&
                            "border-primary ring-primary/20 ring-2",
                          !ownListing &&
                            !selected &&
                            "border-[#e5e7eb] hover:border-[#d1d5dc]"
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p
                              className="text-foreground font-medium"
                              data-supplier-id={maskJweLikePublicString(
                                offer.vendorAlias
                              )}
                            >
                              {offer.vendorAlias}
                            </p>
                            {ownListing ? (
                              <Badge
                                variant="secondary"
                                className="mt-2 border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                              >
                                Your Listing
                              </Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                className="mt-2 border-0 bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100"
                              >
                                Verified Supplier
                              </Badge>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="font-mono text-2xl font-semibold tabular-nums text-primary">
                              ETB {formatMoney(offer.price)}
                            </p>
                            <p className="text-muted-foreground font-mono text-xs">
                              {offer.uom}
                            </p>
                          </div>
                        </div>
                        <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          <span className="font-mono tabular-nums">
                            Stock: {offer.stock} {offer.uom}
                          </span>
                          {offer.batchExpiry ? (
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 font-mono tabular-nums",
                                ev === "red"
                                  ? "text-destructive font-semibold"
                                  : ev === "amber"
                                    ? "text-[#e17100] font-medium"
                                    : "text-[#4a5565]"
                              )}
                            >
                              <Calendar className="size-3.5 shrink-0" />
                              {formatExpiryLong(offer.batchExpiry)}
                            </span>
                          ) : null}
                          {offer.batchLabel ? (
                            <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                              <Tag className="size-3.5 shrink-0" />
                              {offer.batchLabel}
                            </span>
                          ) : null}
                        </div>
                        {low && !ownListing ? (
                          <p className="mt-2 text-[12px] font-medium text-[#e17100]">
                            ⚠ Low stock
                          </p>
                        ) : null}
                      </button>
                    );
                    return ownListing ? (
                      <Tooltip key={`${offer.vendorAlias}-${idx}`}>
                        <TooltipTrigger asChild>
                          <span className="block w-full">{card}</span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          You cannot purchase your own listings
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <React.Fragment key={`${offer.vendorAlias}-${idx}`}>
                        {card}
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <aside className="lg:sticky lg:top-24">
            <Card className="shadow-md">
              {!isAuthenticated ? (
                <>
                  <CardHeader>
                    <CardTitle className="text-base">Pricing &amp; purchase</CardTitle>
                    <p className="text-muted-foreground text-sm">
                      Member accounts unlock live prices, quantities, and checkout.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full border-[#d1d5dc] bg-white"
                      onClick={() => router.push(loginReturnHref)}
                    >
                      Sign in to view pricing
                    </Button>
                    <div>
                      <p className="text-muted-foreground mb-1.5 text-xs font-medium uppercase tracking-wide">
                        Availability
                      </p>
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
                    {guestEarliestExpiry ? (
                      <p
                        className={cn(
                          "flex items-center gap-2 font-mono text-sm tabular-nums",
                          guestExpiryVisual === "red"
                            ? "text-destructive font-semibold"
                            : guestExpiryVisual === "amber"
                              ? "text-[#e17100] font-medium"
                              : "text-foreground"
                        )}
                      >
                        <Calendar className="size-4 shrink-0" />
                        Expiry: {formatExpiryLong(guestEarliestExpiry)}
                      </p>
                    ) : null}
                    <Link
                      href={loginReturnHref}
                      className="block text-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Sign in to purchase
                    </Link>
                    <p className="text-muted-foreground text-center text-xs">
                      Secure checkout • Verified suppliers only
                    </p>
                  </CardContent>
                </>
              ) : (
                <>
                  <CardHeader>
                    <CardTitle className="text-base">Selected Supplier</CardTitle>
                    {selectedOffer ? (
                      <>
                        <p
                          className="text-foreground font-medium"
                          data-supplier-id={maskJweLikePublicString(
                            selectedOffer.vendorAlias
                          )}
                        >
                          {selectedOffer.vendorAlias}
                        </p>
                        {selectedOwn ? (
                          <Badge
                            variant="secondary"
                            className="mt-1 w-fit border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                          >
                            Your Listing
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="mt-1 w-fit border-0 bg-emerald-100 text-emerald-900"
                          >
                            Verified Supplier
                          </Badge>
                        )}
                        {/* TODO: Replace with real fulfillment rate once order tracking is built */}
                      </>
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedOffer ? (
                      <>
                        <div>
                          <p className="font-mono text-3xl font-semibold tabular-nums text-primary">
                            ETB {formatMoney(selectedOffer.price)}
                          </p>
                          <p className="text-muted-foreground font-mono text-sm">
                            {selectedOffer.uom}
                          </p>
                        </div>
                        <div className="space-y-2 text-sm">
                          <p className="font-mono tabular-nums">
                            <span className="text-muted-foreground">
                              Stock available:{" "}
                            </span>
                            {Math.floor(selectedOffer.stock)} {selectedOffer.uom}
                          </p>
                          {selectedOffer.batchExpiry ? (
                            <p
                              className={cn(
                                "flex items-center gap-2 font-mono tabular-nums",
                                marketplaceExpiryVisual(
                                  selectedOffer.batchExpiry
                                ) === "red"
                                  ? "text-destructive font-semibold"
                                  : marketplaceExpiryVisual(
                                        selectedOffer.batchExpiry
                                      ) === "amber"
                                    ? "text-[#e17100] font-medium"
                                    : "text-foreground"
                              )}
                            >
                              <Calendar className="size-4 shrink-0" />
                              Expiry:{" "}
                              {formatExpiryLong(selectedOffer.batchExpiry)}
                            </p>
                          ) : null}
                          {selectedOffer.batchLabel ? (
                            <p className="flex items-center gap-2 font-mono tabular-nums">
                              <Tag className="size-4 shrink-0" />
                              Batch: {selectedOffer.batchLabel}
                            </p>
                          ) : null}
                        </div>

                        {selectedOwn ? (
                          <div className="space-y-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div>
                                  <Badge
                                    variant="secondary"
                                    className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 w-full justify-center py-2"
                                  >
                                    Your Listing
                                  </Badge>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                You cannot purchase your own listings
                              </TooltipContent>
                            </Tooltip>
                            <p className="text-muted-foreground text-center text-sm">
                              You cannot purchase your own listings.
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="shrink-0"
                                disabled={qty <= 1}
                                onClick={() =>
                                  setQty((q) => Math.max(1, q - 1))
                                }
                                aria-label="Decrease quantity"
                              >
                                <Minus className="size-4" />
                              </Button>
                              <Input
                                type="number"
                                min={1}
                                max={maxQty}
                                className="font-mono text-center tabular-nums"
                                value={qty}
                                onChange={(e) => {
                                  const n = Number.parseInt(e.target.value, 10);
                                  if (Number.isNaN(n)) return;
                                  setQty(Math.min(Math.max(1, n), maxQty));
                                }}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="shrink-0"
                                disabled={qty >= maxQty}
                                onClick={() =>
                                  setQty((q) => Math.min(maxQty, q + 1))
                                }
                                aria-label="Increase quantity"
                              >
                                <Plus className="size-4" />
                              </Button>
                            </div>

                            <div className="flex justify-between border-t pt-4 text-sm">
                              <span className="text-muted-foreground">
                                Subtotal
                              </span>
                              <span className="font-mono font-medium tabular-nums">
                                ETB {formatMoney(subtotal)}
                              </span>
                            </div>
                            <div className="flex justify-between text-base">
                              <span className="font-medium">Total</span>
                              <span className="font-mono text-lg font-semibold tabular-nums text-primary">
                                ETB {formatMoney(subtotal)}
                              </span>
                            </div>

                            <Button
                              type="button"
                              className="bg-primary text-primary-foreground hover:bg-primary/90 w-full"
                              disabled={
                                cartPending || selectedOffer.stock <= 0
                              }
                              onClick={() => void handleAddToCart()}
                            >
                              {cartPending ? (
                                <Loader2 className="mr-2 size-4 animate-spin" />
                              ) : (
                                <ShoppingCart className="mr-2 size-4" />
                              )}
                              Add to Cart
                            </Button>
                          </>
                        )}
                        <p className="text-muted-foreground text-center text-xs">
                          Secure checkout • Verified suppliers only
                        </p>
                      </>
                    ) : null}
                  </CardContent>
                </>
              )}
            </Card>
          </aside>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}
