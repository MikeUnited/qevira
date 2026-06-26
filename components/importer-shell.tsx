"use client";

// TODO: This shell is a legacy component.
// Verify no active routes use it before deleting.
// (Currently only app/importer/layout.tsx imports ImporterShell; /importer now redirects to /dashboard.)

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ShoppingCart } from "lucide-react";
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
];

export function ImporterShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <SidebarProvider>
      <Sidebar side="left" variant="sidebar" collapsible="offcanvas">
        <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-semibold text-sidebar-foreground"
          >
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
                      isActive={
                        pathname === "/dashboard" ||
                        pathname.startsWith("/dashboard/")
                      }
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
                <SidebarMenuButton asChild isActive={false}>
                  <Link href="/dashboard">
                    <ShoppingCart className="size-4" />
                    <span>Buyer View (Dashboard)</span>
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
