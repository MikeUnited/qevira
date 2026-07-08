import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  iconClassName?: string;
  description?: string;
  loading?: boolean;
  className?: string;
};

function StatCard({
  label,
  value,
  icon: Icon,
  iconClassName,
  description,
  loading = false,
  className,
}: StatCardProps) {
  return (
    <Card className={cn("border-border/80 shadow-sm", className)}>
      <CardContent className="pt-6">
        {loading ?
          <Skeleton className="h-20 w-full rounded-lg" />
        : <div className="flex items-start justify-between">
            <div>
              <p className="text-muted-foreground text-xs font-medium">
                {label}
              </p>
              <p className="text-foreground mt-1 font-mono text-2xl font-semibold tabular-nums">
                {value}
              </p>
              {description ?
                <p className="text-muted-foreground mt-1 text-xs">
                  {description}
                </p>
              : null}
            </div>
            <Icon
              className={cn(
                "size-5 shrink-0",
                iconClassName ?? "text-muted-foreground"
              )}
              aria-hidden
            />
          </div>
        }
      </CardContent>
    </Card>
  );
}

export { StatCard };
