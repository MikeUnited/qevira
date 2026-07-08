import { requireKycStep6OrRedirect } from "@/lib/kyc-suggested-step";

import { SalesStockClient } from "../../stock/stock-client";

export default async function SalesReceiveStockPage() {
  await requireKycStep6OrRedirect();
  return <SalesStockClient />;
}
