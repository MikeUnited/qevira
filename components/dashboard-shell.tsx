"use client";

// Legacy shell - used only by (dashboard) route group. Safe to delete after confirming no active routes depend on it.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Pill,
  ShoppingCart,
  Package,
  Settings,
  Store,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarProvider,
  SidebarInset,
} from "@/components/ui/sidebar";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Browse Drugs", href: "/marketplace", icon: Pill },
  { label: "My Orders", href: "/orders", icon: ShoppingCart },
  { label: "Inventory", href: "/inventory", icon: Package },
  { label: "Settings", href: "/settings", icon: Settings },
];

function isNavItemActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === "/dashboard" || pathname === "/";
  }
  if (href === "/marketplace") {
    return (
      pathname === "/marketplace" || pathname.startsWith("/marketplace/")
    );
  }
  return pathname === href;
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <SidebarProvider>
      <Sidebar side="left" variant="sidebar" collapsible="offcanvas">
        <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-sidebar-foreground">
            <span className="text-primary text-lg font-bold">UnitedPharma</span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isNavItemActive(pathname, item.href)}
                    >
                      <Link href={item.href}>
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarFooter className="mt-auto border-t border-sidebar-border pt-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={
                    pathname === "/dashboard" ||
                    pathname.startsWith("/dashboard/")
                  }
                >
                  <Link href="/dashboard">
                    <Store className="size-4" />
                    <span>Importer Portal (Seller View)</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/register"}>
                  <Link href="/register">
                    <span className="text-xs font-medium">Register / Login</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
