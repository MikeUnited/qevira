import { requireKycStep6OrRedirect } from "@/lib/kyc-suggested-step";

import { SalesCatalogClient } from "../../sales-catalog-client";

export default async function SalesNewItemPage() {
  await requireKycStep6OrRedirect();
  return <SalesCatalogClient />;
}
