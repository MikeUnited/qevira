import { redirect } from "next/navigation";

import { getUserProfile } from "@/lib/server-user-profile";

import { BuyerInventoryClient } from "./buyer-inventory-client";

export default async function InventoryPage() {
  const result = await getUserProfile();
  if (!result.ok) {
    redirect("/login");
  }

  const profile = result.data;
  const hasSupplier = profile.supplierGroup != null;
  const hasCustomer = profile.customerGroup != null;

  if (hasSupplier && !hasCustomer) {
    redirect("/dashboard/sales/inventory");
  }

  if (!hasCustomer) {
    redirect("/dashboard");
  }

  return <BuyerInventoryClient />;
}
