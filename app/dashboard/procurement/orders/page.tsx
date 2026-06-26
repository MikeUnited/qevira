import { requireKycStep6OrRedirect } from "@/lib/kyc-suggested-step";

import { ProcurementOrdersClient } from "./procurement-orders-client";

export default async function ProcurementOrdersPage() {
  await requireKycStep6OrRedirect();
  return <ProcurementOrdersClient />;
}
