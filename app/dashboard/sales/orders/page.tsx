import { requireKycStep6OrRedirect } from "@/lib/kyc-suggested-step";

import { SupplierOrdersClient } from "./orders-client";

export default async function SupplierOrdersPage() {
  await requireKycStep6OrRedirect();
  return <SupplierOrdersClient />;
}
