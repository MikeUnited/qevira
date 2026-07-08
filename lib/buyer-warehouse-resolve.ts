import { upsertBuyerWarehouseMapping } from "@/lib/erpnext-warehouse";
import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { prisma } from "@/lib/prisma";

/**
 * Resolves the buyer warehouse for an ERPNext Customer document name.
 * Prefers Prisma mapping, then ERPNext `custom_warehouse`; backfills Prisma when ERPNext has a value.
 */
export async function resolveBuyerWarehouseName(
  customerId: string
): Promise<string | null> {
  const row = await prisma.buyerWarehouse.findUnique({
    where: { customerId },
  });
  if (row?.warehouseName?.trim()) {
    return row.warehouseName.trim();
  }

  const env = readErpnextEnv();
  if ("error" in env) {
    return null;
  }

  const qs = new URLSearchParams({
    fields: JSON.stringify(["custom_warehouse"]),
  });
  const res = await erpnextFetch(
    env,
    `/api/resource/Customer/${encodeURIComponent(customerId)}?${qs}`,
    { cache: "no-store" }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return null;
  }

  const custData =
    json &&
    typeof json === "object" &&
    "data" in json &&
    json.data &&
    typeof json.data === "object" &&
    json.data !== null &&
    !Array.isArray(json.data)
      ? (json.data as Record<string, unknown>)
      : null;

  const w =
    custData && typeof custData.custom_warehouse === "string"
      ? custData.custom_warehouse.trim()
      : "";
  if (!w) {
    return null;
  }

  await upsertBuyerWarehouseMapping(customerId, w);

  return w;
}
