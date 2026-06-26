"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Minus,
  Plus,
  ShoppingBag,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type CartRow = {
  id: string;
  genericName: string;
  vendorAlias: string;
  price: number;
  uom: string;
  quantity: number;
  isExpired: boolean;
  maxQuantity: number;
  batchNumber: string | null;
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

export default function MarketplaceCartPage() {
  const router = useRouter();
  const [items, setItems] = React.useState<CartRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const loadCart = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/marketplace/cart", {
        credentials: "include",
      });
      if (res.status === 401 || res.status === 403) {
        router.replace(
          `/login?callbackUrl=${encodeURIComponent("/marketplace/cart")}`
        );
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          typeof j.error === "string" ? j.error : "Could not load cart."
        );
      }
      const raw = (await res.json()) as CartRow[];
      setItems(Array.isArray(raw) ? raw : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load cart.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [router]);

  React.useEffect(() => {
    void loadCart();
  }, [loadCart]);

  async function patchQuantity(id: string, nextQty: number) {
    setUpdatingId(id);
    try {
      const res = await fetch("/api/marketplace/cart", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, quantity: nextQty }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(
          typeof j.error === "string" && j.error.trim()
            ? j.error.trim()
            : "Could not update quantity."
        );
        return;
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("bamys-cart-updated"));
      }
      await loadCart();
    } catch {
      toast.error("Could not update quantity.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function removeItem(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch("/api/marketplace/cart", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(
          typeof j.error === "string" && j.error.trim()
            ? j.error.trim()
            : "Could not remove item."
        );
        return;
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("bamys-cart-updated"));
      }
      await loadCart();
    } catch {
      toast.error("Could not remove item.");
    } finally {
      setDeletingId(null);
    }
  }

  const subtotal = items.reduce(
    (sum, row) => sum + row.price * row.quantity,
    0
  );
  const lineCount = items.length;

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 md:px-6">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Loading cart…
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-6 px-4 py-16 text-center md:py-24">
        <ShoppingCart className="text-muted-foreground size-16" aria-hidden />
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">
            Your cart is empty
          </h1>
        </div>
        <Button asChild size="lg">
          <Link href="/marketplace">Continue Shopping</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <div className="mb-8">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-3xl">
          Shopping Cart
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {lineCount} {lineCount === 1 ? "item" : "items"} in your cart
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,35%)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-3">
          {items.map((row) => {
            const lineTotal = row.price * row.quantity;
            const busy = updatingId === row.id || deletingId === row.id;
            const maxQ = Math.max(0, row.maxQuantity);
            const canInc = maxQ > 0 && row.quantity < maxQ;
            const canDec = row.quantity > 1;

            return (
              <Card
                key={row.id}
                className={cn(
                  "overflow-hidden rounded-xl border border-[#e8eaed] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)]",
                  row.isExpired && "border-amber-400/60 bg-amber-50/40"
                )}
              >
                <CardContent className="relative px-5 py-4">
                  <div className="flex items-start gap-3 pr-10">
                    <div className="bg-primary/10 flex size-14 shrink-0 items-center justify-center rounded-xl">
                      <ShoppingBag
                        className="text-primary size-[22px]"
                        aria-hidden
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-[15px] font-bold leading-snug tracking-tight text-[#0a0a0a]">
                        {row.genericName}
                      </p>
                      <p className="text-[13px] leading-snug text-[#6b7280]">
                        Supplier: {row.vendorAlias}
                      </p>
                      <p className="font-mono text-[12px] leading-snug tabular-nums text-[#6b7280]">
                        Batch: {row.batchNumber ?? "—"}
                      </p>
                      {row.isExpired ? (
                        <p className="pt-0.5 text-[11px] font-medium leading-snug text-amber-800 dark:text-amber-200">
                          Offer expired — remove and re-add from marketplace.
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="absolute right-4 top-4 shrink-0 rounded-md p-1.5 text-[#dc2626] transition-colors hover:bg-red-50 disabled:opacity-50"
                      aria-label="Remove item"
                      disabled={busy}
                      onClick={() => void removeItem(row.id)}
                    >
                      {deletingId === row.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4 stroke-[1.75]" />
                      )}
                    </button>
                  </div>

                  <div className="mt-4 border-b border-[#eef0f3]" />

                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 pt-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-[12px] leading-tight text-[#6b7280]">
                        {row.uom}
                      </span>
                      <span className="text-primary font-mono text-lg font-bold leading-tight tabular-nums">
                        {formatEtb(row.price)}
                      </span>
                    </div>

                    <div className="flex items-center justify-center gap-2 px-1">
                      <button
                        type="button"
                        disabled={busy || !canDec || row.isExpired}
                        onClick={() =>
                          void patchQuantity(row.id, row.quantity - 1)
                        }
                        aria-label="Decrease quantity"
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-md border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors",
                          "hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-40"
                        )}
                      >
                        <Minus className="size-3.5 text-[#111827]" aria-hidden />
                      </button>
                      <span className="min-w-[1.5rem] text-center text-sm font-semibold tabular-nums text-[#111827]">
                        {updatingId === row.id ? (
                          <Loader2 className="inline size-4 animate-spin" />
                        ) : (
                          row.quantity
                        )}
                      </span>
                      <button
                        type="button"
                        disabled={busy || !canInc || row.isExpired}
                        onClick={() =>
                          void patchQuantity(row.id, row.quantity + 1)
                        }
                        aria-label="Increase quantity"
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-md border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors",
                          "hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-40"
                        )}
                      >
                        <Plus className="size-3.5 text-[#111827]" aria-hidden />
                      </button>
                    </div>

                    <div className="flex min-w-0 flex-col items-end gap-1 text-right">
                      <span className="text-[12px] leading-tight text-[#6b7280]">
                        Subtotal
                      </span>
                      <span className="font-mono text-base font-bold tabular-nums text-[#0a0a0a]">
                        {formatEtb(lineTotal)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <aside className="lg:sticky lg:top-24">
          <Card className="border-border shadow-sm">
            <CardContent className="space-y-4 p-5">
              <h2 className="text-foreground text-lg font-semibold">
                Order Summary
              </h2>
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-muted-foreground">
                  Subtotal ({lineCount}{" "}
                  {lineCount === 1 ? "item" : "items"})
                </span>
                <span className="font-mono tabular-nums">
                  {formatEtb(subtotal)}
                </span>
              </div>
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Tax:</span>
                <span className="text-muted-foreground text-right text-xs">
                  Calculated at invoice
                </span>
              </div>
              {/* TODO: Implement tax calculation based on Ethiopian VAT rules before beta launch */}
              <div className="border-border flex justify-between gap-4 border-t pt-4">
                <span className="font-medium">Total</span>
                <span className="text-primary font-mono text-xl font-semibold tabular-nums">
                  {formatEtb(subtotal)}
                </span>
              </div>
              <Button
                type="button"
                size="lg"
                className="h-11 w-full"
                onClick={() => router.push("/marketplace/checkout")}
              >
                Proceed to Checkout
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
              <p className="text-muted-foreground border-border rounded-lg border bg-[#f9fafb] px-3 py-2 text-center text-xs">
                Verified suppliers only • Secure checkout
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
