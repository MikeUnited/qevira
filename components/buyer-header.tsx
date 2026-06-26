"use client";

import { Search } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function BuyerHeader() {
  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4 backdrop-blur md:px-[72px] border-border bg-background/95 supports-[backdrop-filter]:bg-background/60">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <SidebarTrigger className="-ml-1 shrink-0 md:ml-0" />
        <div className="relative min-w-0 flex-1 sm:max-w-xs md:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 shrink-0 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search drugs, SKU..."
            className="w-full min-w-0 bg-muted/50 pl-9 text-sm"
          />
        </div>
      </div>
      <div className="ml-auto shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="rounded-full">
              <Avatar size="sm" className="size-8">
                <AvatarImage src="" alt="User" />
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                  WH
                </AvatarFallback>
              </Avatar>
              <span className="sr-only">Open user menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Wholesaler Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Profile</DropdownMenuItem>
            <DropdownMenuItem>Billing</DropdownMenuItem>
            <DropdownMenuItem>Team</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive">
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
