"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type CartItemRow = {
  genericName: string;
  vendorAlias: string;
  quantity: number;
  price: number;
  uom: string;
};

type ApprovalRequest = {
  id: string;
  requestedBy: string;
  createdAt: string;
  status: string;
  cartItems: CartItemRow[];
};

function formatMoney(n: number) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function relativeTimeLabel(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function ProcurementApprovalsPage() {
  const [requests, setRequests] = React.useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actionId, setActionId] = React.useState<string | null>(null);
  const [rejectingId, setRejectingId] = React.useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = React.useState("");

  async function loadRequests() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/team/cart/approvals", {
        credentials: "include",
      });
      const json = (await res.json().catch(() => ({}))) as {
        requests?: unknown;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof json.error === "string" && json.error.trim()
            ? json.error
            : "Could not load approvals."
        );
      }
      const raw = json.requests;
      const list = Array.isArray(raw) ? raw : [];
      setRequests(
        list.filter(
          (r): r is ApprovalRequest =>
            r !== null &&
            typeof r === "object" &&
            typeof (r as ApprovalRequest).id === "string"
        )
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load approvals.";
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadRequests();
  }, []);

  async function approve(id: string) {
    setActionId(id);
    try {
      const res = await fetch("/api/team/cart/approvals", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id, action: "APPROVE" }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        const msg =
          typeof json.error === "string" && json.error.trim()
            ? json.error.trim()
            : "Approval failed.";
        toast.error(msg);
        return;
      }
      toast.success("Order placed successfully");
      setRejectingId(null);
      setRejectNotes("");
      await loadRequests();
    } catch {
      toast.error("Approval failed. Please try again.");
    } finally {
      setActionId(null);
    }
  }

  async function reject(id: string) {
    setActionId(id);
    try {
      const res = await fetch("/api/team/cart/approvals", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: id,
          action: "REJECT",
          notes: rejectNotes.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        const msg =
          typeof json.error === "string" && json.error.trim()
            ? json.error.trim()
            : "Could not reject request.";
        toast.error(msg);
        return;
      }
      toast.success("Request rejected");
      setRejectingId(null);
      setRejectNotes("");
      await loadRequests();
    } catch {
      toast.error("Could not reject request.");
    } finally {
      setActionId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          Pending Approvals
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Review and approve pharmacist cart requests
        </p>
      </div>

      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="py-6 text-sm">{loadError}</CardContent>
        </Card>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No pending approval requests.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {requests.map((req) => {
            const total = req.cartItems.reduce(
              (sum, c) => sum + c.price * c.quantity,
              0
            );
            const busy = actionId === req.id;
            const showReject = rejectingId === req.id;

            return (
              <Card key={req.id}>
                <CardHeader className="border-border border-b pb-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base font-medium">
                        {req.requestedBy}
                      </CardTitle>
                      <CardDescription>
                        Submitted {relativeTimeLabel(req.createdAt)}
                      </CardDescription>
                    </div>
                    <Badge variant="secondary">{req.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  {req.cartItems.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No items in cart.
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
                          {req.cartItems.map((c, idx) => (
                            <TableRow key={`${c.genericName}-${idx}`}>
                              <TableCell className="font-medium">
                                {c.genericName}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {c.vendorAlias}
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums">
                                {c.quantity}
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums">
                                {formatMoney(c.price)}
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums">
                                {formatMoney(c.price * c.quantity)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                    <span className="text-sm font-medium">Total order value</span>
                    <span className="text-lg font-semibold font-mono tabular-nums">
                      {formatMoney(total)}
                    </span>
                  </div>

                  {showReject ? (
                    <div className="space-y-2">
                      <label
                        htmlFor={`reject-notes-${req.id}`}
                        className="text-muted-foreground text-xs font-medium"
                      >
                        Notes (optional)
                      </label>
                      <Textarea
                        id={`reject-notes-${req.id}`}
                        value={rejectNotes}
                        onChange={(e) => setRejectNotes(e.target.value)}
                        placeholder="Reason for rejection…"
                        rows={3}
                        className="resize-y text-sm"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => void reject(req.id)}
                        >
                          {busy ? (
                            <>
                              <Loader2 className="mr-2 size-4 animate-spin" />
                              Rejecting…
                            </>
                          ) : (
                            "Confirm reject"
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setRejectingId(null);
                            setRejectNotes("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                        disabled={busy}
                        onClick={() => void approve(req.id)}
                      >
                        {busy && actionId === req.id ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Placing order…
                          </>
                        ) : (
                          "Approve & Place Order"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-destructive/50 text-destructive hover:bg-destructive/10"
                        disabled={busy}
                        onClick={() => {
                          setRejectingId(req.id);
                          setRejectNotes("");
                        }}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
