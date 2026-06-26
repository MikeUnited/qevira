"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type InventoryRow = {
  itemCode: string;
  itemName: string;
  itemGroup: string;
  stockUom: string;
  qty: number;
};

const USAGE_REASONS = [
  "Dispensed to Patient",
  "Expired/Damaged",
  "Transfer",
  "Other",
] as const;

function buyerStockBadge(qty: number): { label: string; className: string } {
  if (qty <= 0) {
    return {
      label: "Out of Stock",
      className:
        "border-0 bg-red-100 font-medium text-red-800 dark:bg-red-950/40 dark:text-red-100",
    };
  }
  if (qty < 10) {
    return {
      label: "Low Stock",
      className:
        "border-0 bg-amber-100 font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
    };
  }
  return {
    label: "In Stock",
    className:
      "border-0 bg-emerald-100 font-medium text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
  };
}

export function BuyerInventoryClient() {
  const [loading, setLoading] = React.useState(true);
  const [warehouse, setWarehouse] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<InventoryRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const [usageOpen, setUsageOpen] = React.useState(false);
  const [usageRow, setUsageRow] = React.useState<InventoryRow | null>(null);
  const [qtyUsed, setQtyUsed] = React.useState(1);
  const [reason, setReason] = React.useState<string>(USAGE_REASONS[0]);
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/inventory/buyer", {
        credentials: "include",
      });
      const json = (await res.json().catch(() => ({}))) as {
        items?: InventoryRow[];
        warehouse?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Failed to load inventory.");
        setItems([]);
        setWarehouse(null);
        return;
      }
      setWarehouse(json.warehouse ?? null);
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch {
      setError("Failed to load inventory.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  function openUsage(row: InventoryRow) {
    setUsageRow(row);
    setQtyUsed(1);
    setReason(USAGE_REASONS[0]);
    setNotes("");
    setUsageOpen(true);
  }

  async function submitUsage() {
    if (!usageRow || !warehouse) return;
    const max = Math.floor(usageRow.qty);
    if (qtyUsed < 1 || qtyUsed > max) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/dashboard/inventory/buyer/reduce", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemCode: usageRow.itemCode,
          warehouse,
          quantity: qtyUsed,
          reason,
          notes,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
      if (!res.ok) {
        setError(json.error ?? "Could not record usage.");
        return;
      }
      setError(null);
      setUsageOpen(false);
      setUsageRow(null);
      toast.success("Usage recorded.");
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          My Inventory
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Track your stock levels and record usage
        </p>
      </div>

      {!warehouse && !loading && !error ?
        <div className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-4 py-3 text-sm">
          Your inventory warehouse is being set up. Complete KYC to activate.
        </div>
      : null}

      {error ?
        <p className="text-destructive text-sm">{error}</p>
      : null}

      {loading ?
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      : warehouse && items.length === 0 ?
        <p className="text-muted-foreground text-sm">
          No stock recorded yet. Stock will appear here after your orders are
          confirmed received.
        </p>
      : warehouse ?
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Current Stock</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => {
                const st = buyerStockBadge(row.qty);
                return (
                  <TableRow key={row.itemCode}>
                    <TableCell className="font-medium">{row.itemName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.itemGroup}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.qty.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell>{row.stockUom}</TableCell>
                    <TableCell>
                      <Badge className={cn("border-0", st.className)}>
                        {st.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={row.qty <= 0}
                        onClick={() => openUsage(row)}
                      >
                        Record Usage
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      : null}

      <Dialog open={usageOpen} onOpenChange={setUsageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record usage</DialogTitle>
          </DialogHeader>
          {usageRow ?
            <div className="space-y-4 py-2">
              <div>
                <Label>Item</Label>
                <p className="text-foreground mt-1 text-sm font-medium">
                  {usageRow.itemName}
                </p>
              </div>
              <div>
                <Label htmlFor="qty-used">Quantity Used</Label>
                <Input
                  id="qty-used"
                  type="number"
                  min={1}
                  max={Math.max(1, Math.floor(usageRow.qty))}
                  value={qtyUsed}
                  onChange={(e) =>
                    setQtyUsed(Number.parseInt(e.target.value, 10) || 1)
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Reason</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {USAGE_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="usage-notes">Notes (optional)</Label>
                <Textarea
                  id="usage-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1"
                  rows={3}
                />
              </div>
            </div>
          : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setUsageOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submitUsage()}
              disabled={
                submitting ||
                !usageRow ||
                qtyUsed < 1 ||
                qtyUsed > Math.floor(usageRow.qty)
              }
            >
              {submitting ? "Saving…" : "Record Usage"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
