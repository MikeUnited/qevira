import type { Metadata } from "next";
import { MarketplaceTopNav } from "@/components/marketplace/marketplace-top-nav";

export const metadata: Metadata = {
  title: "BAMYS Marketplace | Institutional Pharmaceutical Procurement Ethiopia",
  description:
    "Institutional pharmaceutical procurement for Ethiopia — browse generics, compare vendor offers, and purchase through BAMYS.",
};

export default function MarketplaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[#f9fafb] flex min-h-svh flex-col">
      <MarketplaceTopNav />
      <main className="flex-1">{children}</main>
    </div>
  );
}
