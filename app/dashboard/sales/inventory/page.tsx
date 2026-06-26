import { requireKycStep6OrRedirect } from "@/lib/kyc-suggested-step";

import { SalesInventoryClient } from "./inventory-client";

export default async function SalesInventoryPage() {
  await requireKycStep6OrRedirect();
  return <SalesInventoryClient />;
}
