"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type ApiNotification = {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
};

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const t = d.getTime();
  if (Number.isNaN(t)) return "";
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 45) return "Just now";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return rtf.format(-diffHr, "hour");
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffDay) < 7) return rtf.format(-diffDay, "day");
  return d.toLocaleDateString();
}

export function NotificationBell() {
  const router = useRouter();
  const [notifications, setNotifications] = React.useState<ApiNotification[]>(
    []
  );
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const fetchNotifications = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications", {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        notifications?: ApiNotification[];
        unreadCount?: number;
      };
      if (Array.isArray(data.notifications)) {
        setNotifications(data.notifications);
      }
      if (typeof data.unreadCount === "number") {
        setUnreadCount(data.unreadCount);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  React.useEffect(() => {
    if (open) void fetchNotifications();
  }, [open, fetchNotifications]);

  React.useEffect(() => {
    const id = window.setInterval(() => {
      void fetchNotifications();
    }, 30000);
    return () => window.clearInterval(id);
  }, [fetchNotifications]);

  async function markAllRead() {
    const res = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ markAllRead: true }),
    });
    if (res.ok) void fetchNotifications();
  }

  async function onRowClick(n: ApiNotification) {
    if (!n.isRead) {
      const res = await fetch(`/api/notifications/${encodeURIComponent(n.id)}`, {
        method: "PATCH",
        credentials: "include",
      });
      if (res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          isRead?: boolean;
        };
        setNotifications((prev) =>
          prev.map((x) =>
            x.id === n.id ? { ...x, isRead: j.isRead ?? true } : x
          )
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      }
    }
    if (n.link) {
      setOpen(false);
      router.push(n.link);
    }
  }

  async function onDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const res = await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      setNotifications((prev) => {
        const row = prev.find((x) => x.id === id);
        const next = prev.filter((x) => x.id !== id);
        if (row && !row.isRead) {
          setUnreadCount((c) => Math.max(0, c - 1));
        }
        return next;
      });
    }
  }

  const badgeLabel =
    unreadCount > 9 ? "9+" : unreadCount > 0 ? String(unreadCount) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative shrink-0"
          aria-label="Notifications"
        >
          <Bell className="size-[18px]" />
          {badgeLabel ? (
            <span className="bg-destructive text-destructive-foreground absolute -right-0.5 -top-0.5 flex min-w-[1.125rem] items-center justify-center rounded-full px-[5px] py-0 text-[10px] font-semibold leading-none">
              {badgeLabel}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-80 max-h-96 flex-col overflow-hidden p-0"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-auto py-1 text-sm"
            disabled={unreadCount === 0 || loading}
            onClick={() => void markAllRead()}
          >
            Mark all read
          </Button>
        </div>
        <div className="max-h-[min(24rem,calc(100vh-8rem))] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10">
              <Bell className="size-10 opacity-40" aria-hidden />
              <p className="text-sm">No notifications yet</p>
            </div>
          ) : (
            <ul className="divide-border divide-y">
              {notifications.map((n) => (
                <li key={n.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => void onRowClick(n)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void onRowClick(n);
                      }
                    }}
                    className={cn(
                      "hover:bg-muted/50 group relative flex cursor-pointer flex-col gap-0.5 px-3 py-2.5 pr-8 text-left transition-colors",
                      !n.isRead && "bg-indigo-50 dark:bg-indigo-950/30"
                    )}
                  >
                    <span className="text-sm font-semibold">{n.title}</span>
                    <span className="text-muted-foreground line-clamp-2 text-xs">
                      {n.message}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatRelativeTime(n.createdAt)}
                    </span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground absolute right-1 top-1.5 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Delete notification"
                      onClick={(e) => void onDelete(n.id, e)}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
