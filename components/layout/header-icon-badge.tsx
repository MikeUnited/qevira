import { cn } from "@/lib/utils";

/**
 * Fixed 32×32 hit target so badge offsets match across bell, cart, etc.
 */
export function HeaderIconAnchor({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex size-8 shrink-0 items-center justify-center",
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * Count pill for header icons (cart, notifications). Shared size, color, and offset.
 */
export function HeaderIconBadge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-primary text-primary-foreground pointer-events-none absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full text-[10px] font-semibold leading-none tabular-nums",
        className
      )}
    >
      {children}
    </span>
  );
}

export function formatHeaderBadgeCount(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? "9+" : String(count);
}
