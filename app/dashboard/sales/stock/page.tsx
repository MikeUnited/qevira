import { requireKycStep6OrRedirect } from "@/lib/kyc-suggested-step";

import { SalesStockClient } from "./stock-client";

export default async function SalesStockPage() {
  await requireKycStep6OrRedirect();
  return <SalesStockClient />;
}
