"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

const ALLOWED_ITEM_GROUPS = [
  "Prescription Drugs",
  "Over-The-Counter (OTC)",
  "Medical Devices",
  "Consumables",
] as const;

const ALLOWED_UOMS = [
  "Tablet",
  "Strip",
  "Box",
  "Carton",
  "Vial",
  "Ampoule",
  "Tube",
] as const;

const initialFormData = {
  itemName: "",
  itemGroup: "",
  uom: "",
  efdaRegistrationNo: "",
  description: "",
};

type FormData = typeof initialFormData;

export function SalesCatalogClient() {
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formData.itemGroup.trim() || !formData.uom.trim()) {
      toast.error("Please select both item group and unit of measure.");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/vendor/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

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

      toast.success("Item added to catalog!");
      setFormData(initialFormData);
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
            Catalog Management
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add pharmaceutical items to your marketplace catalog. All submissions
            require a valid EFDA registration number.
          </p>
        </header>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add New Pharmaceutical Item</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <div className="space-y-2">
              <Label htmlFor="itemName">Item Name</Label>
              <Input
                id="itemName"
                name="itemName"
                required
                value={formData.itemName}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, itemName: e.target.value }))
                }
                placeholder="e.g. Amoxicillin 500mg"
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="itemGroup">Item Group</Label>
              <Select
                value={formData.itemGroup || undefined}
                onValueChange={(v) =>
                  setFormData((f) => ({ ...f, itemGroup: v }))
                }
              >
                <SelectTrigger id="itemGroup" className="w-full">
                  <SelectValue placeholder="Select item group" />
                </SelectTrigger>
                <SelectContent>
                  {ALLOWED_ITEM_GROUPS.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="uom">Unit of Measure</Label>
              <Select
                value={formData.uom || undefined}
                onValueChange={(v) => setFormData((f) => ({ ...f, uom: v }))}
              >
                <SelectTrigger id="uom" className="w-full">
                  <SelectValue placeholder="Select UOM" />
                </SelectTrigger>
                <SelectContent>
                  {ALLOWED_UOMS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="border-primary/20 bg-primary/5 dark:border-primary/30 dark:bg-primary/10 space-y-2 rounded-lg border p-3">
              <Label
                htmlFor="efdaRegistrationNo"
                className="flex items-center gap-2 text-foreground"
              >
                <ShieldCheck
                  className="text-primary size-4 shrink-0"
                  aria-hidden
                />
                EFDA Registration Number
              </Label>
              <Input
                id="efdaRegistrationNo"
                name="efdaRegistrationNo"
                required
                value={formData.efdaRegistrationNo}
                onChange={(e) =>
                  setFormData((f) => ({
                    ...f,
                    efdaRegistrationNo: e.target.value,
                  }))
                }
                placeholder="Official EFDA registration"
                autoComplete="off"
                className="border-primary/20 bg-background font-mono dark:border-primary/40 dark:bg-background/80"
              />
              <p className="text-muted-foreground text-xs leading-relaxed">
                Required for regulatory compliance. Must match your EFDA
                certificate.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Optional product details, strength, pack size…"
                rows={4}
              />
            </div>

            <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Adding…
                </>
              ) : (
                "Add to catalog"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
