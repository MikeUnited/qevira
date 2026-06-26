import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_COPY: Record<
  string,
  { description: string; className: string }
> = {
  Processing: {
    description: "Awaiting supplier confirmation",
    className:
      "border-amber-300 bg-amber-500 text-white hover:bg-amber-500 dark:border-amber-600 dark:bg-amber-600",
  },
  Confirmed: {
    description: "Supplier has accepted and is preparing shipment",
    className:
      "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600 dark:border-emerald-600 dark:bg-emerald-600",
  },
  Cancelled: {
    description: "Order cancelled by party",
    className: "",
  },
};

type OrderStatusBadgeProps = {
  status: string;
  className?: string;
};

/**
 * Procurement order status with a short human-readable explanation beneath the badge.
 */
export function OrderStatusBadge({ status, className }: OrderStatusBadgeProps) {
  const meta = STATUS_COPY[status];
  const isCancelled = status === "Cancelled";

  const description =
    meta?.description ?? "Order status update from supplier.";

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <Badge
        variant={isCancelled ? "destructive" : "outline"}
        className={cn(!isCancelled && meta?.className)}
      >
        {status}
      </Badge>
      <p className="text-muted-foreground max-w-[14rem] text-right text-[11px] leading-snug">
        {description}
      </p>
    </div>
  );
}
