"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchAllVendorCatalogItems } from "@/lib/fetch-all-catalog";
import type { VendorCatalogRow } from "@/types/marketplace";

type FormData = {
  itemCode: string;
  batchNo: string;
  expiryDate: string;
  qty: string | number;
  unitPrice: string | number;
};

const initialFormData: FormData = {
  itemCode: "",
  batchNo: "",
  expiryDate: "",
  qty: "",
  unitPrice: "",
};

async function generateIdempotencyKey(
  itemCode: string,
  batchNo: string,
  expiryDate: string
): Promise<string> {
  const content = `${itemCode}:${batchNo}:${expiryDate}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export function SalesStockClient() {
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [catalogItems, setCatalogItems] = useState<VendorCatalogRow[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogSearch, setCatalogSearch] = useState("");
  /** Bumps after reset so Radix Select remounts; avoids stale value / missing onValueChange. */
  const [catalogSelectKey, setCatalogSelectKey] = useState(0);

  function resetReceiptForm() {
    setFormData(initialFormData);
    setCatalogSearch("");
    setCatalogSelectKey((k) => k + 1);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadCatalog() {
      setCatalogLoading(true);
      try {
        const items = await fetchAllVendorCatalogItems({
          credentials: "include",
        });
        if (!cancelled) setCatalogItems(items);
      } catch {
        if (!cancelled) {
          setCatalogItems([]);
          toast.error("Could not load your catalog. Try again later.");
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    }

    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredCatalogItems = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return catalogItems;
    return catalogItems.filter(
      (row) =>
        row.itemName.toLowerCase().includes(q) ||
        row.itemCode.toLowerCase().includes(q)
    );
  }, [catalogItems, catalogSearch]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const qty = Number(formData.qty);
      const unitPrice = Number(formData.unitPrice);
      if (Number.isNaN(qty) || Number.isNaN(unitPrice)) {
        throw new Error("Quantity and unit price must be valid numbers.");
      }

      const itemCode = formData.itemCode.trim();
      const batchNo = formData.batchNo.trim();
      const expiryDate = formData.expiryDate.trim();
      if (!itemCode) {
        toast.error("Select a catalog item.");
        return;
      }
      const idempotencyKey = await generateIdempotencyKey(
        itemCode,
        batchNo,
        expiryDate
      );

      const res = await fetch("/api/vendor/inventory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-inventory-idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          itemCode,
          batchNo,
          expiryDate,
          qty,
          unitPrice,
        }),
      });

      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          cached?: boolean;
        };
        if (data.ok && data.cached) {
          toast.info(
            "This batch entry was already recorded. Your inventory is up to date."
          );
          resetReceiptForm();
          return;
        }
        const errData = data as { error?: string };
        const message409 =
          typeof errData.error === "string" && errData.error.trim()
            ? errData.error
            : `Request failed (${res.status})`;
        throw new Error(message409);
      }

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };

      if (!res.ok) {
        const message =
          typeof data.error === "string" && data.error.trim()
            ? data.error
            : `Request failed (${res.status})`;
        throw new Error(message);
      }

      toast.success("Stock and pricing successfully recorded!");
      resetReceiptForm();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground -ml-2 h-9 w-fit gap-2 px-2"
          asChild
        >
          <Link href="/dashboard/sales/inventory">
            <ArrowLeft className="size-4 shrink-0" aria-hidden />
            Back to Inventory
          </Link>
        </Button>
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Stock &amp; Pricing Management
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Record a batch receipt, set the unit price on the standard price list,
            and update stock for your catalog items.
          </p>
        </header>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Receive Batch &amp; Set Price</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <div className="space-y-2">
              <Label htmlFor="catalog-search">Item</Label>
              {catalogLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-11 w-full rounded-lg" />
                  <Skeleton className="h-11 w-full rounded-lg" />
                </div>
              ) : catalogItems.length === 0 ? (
                <p className="text-muted-foreground text-sm leading-relaxed">
                  No items in catalog.{" "}
                  <Link
                    href="/dashboard/sales/inventory/new-item"
                    className="text-primary font-medium underline-offset-4 hover:underline"
                  >
                    Add items first
                  </Link>
                  .
                </p>
              ) : (
                <>
                  <Input
                    id="catalog-search"
                    type="search"
                    placeholder="Search by name or code…"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    autoComplete="off"
                    className="w-full"
                  />
                  <Select
                    key={catalogSelectKey}
                    required
                    value={formData.itemCode ? formData.itemCode : undefined}
                    onValueChange={(code) => {
                      if (code === "__no_catalog_match__") return;
                      const row = catalogItems.find((r) => r.itemCode === code);
                      setFormData((f) => ({
                        ...f,
                        itemCode: code,
                        unitPrice:
                          row && row.price > 0
                            ? String(row.price)
                            : f.unitPrice,
                      }));
                    }}
                  >
                    <SelectTrigger
                      id="itemCode"
                      className="h-11 w-full min-w-0 font-mono text-sm"
                    >
                      <SelectValue placeholder="Select a catalog item" />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      className="max-h-[min(24rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)]"
                    >
                      {filteredCatalogItems.length === 0 ? (
                        <SelectItem value="__no_catalog_match__" disabled>
                          No matches. Try another search.
                        </SelectItem>
                      ) : (
                        filteredCatalogItems.map((row) => (
                          <SelectItem
                            key={row.itemCode}
                            value={row.itemCode}
                            className="font-mono text-xs sm:text-sm"
                          >
                            <span className="block truncate font-sans">
                              {row.itemName}
                            </span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="batchNo">Batch Number</Label>
              <Input
                id="batchNo"
                name="batchNo"
                required
                value={formData.batchNo}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, batchNo: e.target.value }))
                }
                autoComplete="off"
                className="font-mono tabular-nums"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expiryDate">Expiry Date</Label>
              <Input
                id="expiryDate"
                name="expiryDate"
                type="date"
                required
                value={formData.expiryDate}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, expiryDate: e.target.value }))
                }
                className="font-mono tabular-nums"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="qty">Quantity</Label>
              <Input
                id="qty"
                name="qty"
                type="number"
                min={1}
                step={1}
                required
                value={formData.qty}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, qty: e.target.value }))
                }
                className="font-mono tabular-nums"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unitPrice">Unit Price (ETB)</Label>
              <Input
                id="unitPrice"
                name="unitPrice"
                type="number"
                min={0.01}
                step={0.01}
                required
                value={formData.unitPrice}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, unitPrice: e.target.value }))
                }
                className="font-mono tabular-nums"
              />
            </div>

            <Button
              type="submit"
              disabled={
                isSubmitting ||
                catalogLoading ||
                catalogItems.length === 0
              }
              className="w-full sm:w-auto"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Recording…
                </>
              ) : (
                "Record stock & pricing"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
