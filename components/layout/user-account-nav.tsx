"use client";

import * as React from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  LogOut,
  Settings,
  User as UserIcon,
  Users,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function initialsFromName(name: string): string {
  const t = name.trim();
  if (!t) return "";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) {
    const w = parts[0]!;
    return w.slice(0, Math.min(2, w.length)).toUpperCase();
  }
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function roleBadgeClass(role: string): string {
  const r = role.trim();
  if (r === "OWNER") {
    return "border-indigo-200 bg-indigo-100 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200";
  }
  if (r === "DIRECTOR") {
    return "border-purple-200 bg-purple-100 text-purple-800 dark:border-purple-800 dark:bg-purple-950/50 dark:text-purple-200";
  }
  if (r === "PHARMACIST") {
    return "border-zinc-200 bg-zinc-100 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-200";
  }
  if (r === "Supplier") {
    return "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200";
  }
  if (r === "Buyer") {
    return "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200";
  }
  return "border-border bg-muted text-muted-foreground";
}

export type UserAccountNavProps = {
  email: string;
  /** Organization or full name for display and initials. */
  name: string;
  role: string;
  /** When set (e.g. marketplace), show browsing mode in the menu header. */
  marketplaceMode?: "buying" | "selling";
};

export function UserAccountNav({
  email,
  name,
  role,
  marketplaceMode,
}: UserAccountNavProps) {
  const displayName = name.trim() || email;
  const initials = initialsFromName(displayName);
  const showTeamManagement =
    role === "OWNER" || role === "DIRECTOR";

  async function logout() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="ring-offset-background rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Account menu"
        >
          <Avatar className="size-9 border-0 shadow-none after:border-0">
            <AvatarFallback className="size-9 bg-indigo-600 text-sm font-semibold text-white">
              {initials ? (
                <span>{initials}</span>
              ) : (
                <UserIcon className="size-4 text-white" aria-hidden />
              )}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="pointer-events-none px-2 py-2">
          <div className="text-sm font-semibold">{displayName}</div>
          <div className="text-muted-foreground text-xs">{email}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn("text-[10px] font-medium", roleBadgeClass(role))}
            >
              {role}
            </Badge>
            {marketplaceMode ?
              <Badge
                variant="outline"
                className="border-amber-200 bg-amber-50 text-[10px] font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
              >
                Marketplace ·{" "}
                {marketplaceMode === "selling" ? "Selling" : "Buying"}
              </Badge>
            : null}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard" className="flex cursor-pointer items-center gap-2">
            <LayoutDashboard className="size-4" />
            Dashboard
          </Link>
        </DropdownMenuItem>
        {showTeamManagement ? (
          <DropdownMenuItem asChild>
            <Link
              href="/dashboard/settings/team"
              className="flex cursor-pointer items-center gap-2"
            >
              <Users className="size-4" />
              Team Management
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link
            href="/dashboard/settings"
            className="flex cursor-pointer items-center gap-2"
          >
            <Settings className="size-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="cursor-pointer"
          onSelect={(e) => {
            e.preventDefault();
            void logout();
          }}
        >
          <LogOut className="size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
