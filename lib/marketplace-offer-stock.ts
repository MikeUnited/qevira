import { jwtDecrypt } from "jose";

import { erpnextFetch, type ErpnextEnv } from "@/lib/erpnext-auth";

function extractDataRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const o = json as { data?: unknown };
  if (!Array.isArray(o.data)) return [];
  return o.data.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && !Array.isArray(r)
  );
}

function parseQty(raw: unknown): number {
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export type OfferStockMeta = {
  itemCode: string | null;
  availableQty: number;
};

async function resolveOfferStock(
  env: ErpnextEnv,
  secret: Uint8Array,
  offerToken: string
): Promise<OfferStockMeta> {
  let payload: Record<string, unknown>;
  try {
    const { payload: p } = await jwtDecrypt(offerToken, secret);
    payload = p as Record<string, unknown>;
  } catch {
    return { itemCode: null, availableQty: 0 };
  }

  const itemCode =
    typeof payload.itemCode === "string" ? payload.itemCode.trim() : "";
  if (!itemCode) return { itemCode: null, availableQty: 0 };

  const itemPriceQs = new URLSearchParams({
    filters: JSON.stringify([
      ["item_code", "=", itemCode],
      ["price_list", "=", "Standard Buying"],
    ]),
    fields: JSON.stringify(["supplier"]),
    limit_page_length: "1",
  });

  const itemPriceRes = await erpnextFetch(
    env,
    `/api/resource/Item Price?${itemPriceQs}`,
    { cache: "no-store" }
  );
  const itemPriceJson = await itemPriceRes.json().catch(() => ({}));
  if (!itemPriceRes.ok) return { itemCode, availableQty: 0 };

  const priceRows = extractDataRows(itemPriceJson);
  const firstPrice = priceRows[0];
  const supplierId =
    firstPrice &&
    typeof firstPrice.supplier === "string" &&
    firstPrice.supplier.trim()
      ? firstPrice.supplier.trim()
      : "";
  if (!supplierId) return { itemCode, availableQty: 0 };

  const supplierQs = new URLSearchParams({
    fields: JSON.stringify(["supplier_name", "custom_warehouse"]),
  });
  const supplierRes = await erpnextFetch(
    env,
    `/api/resource/Supplier/${encodeURIComponent(supplierId)}?${supplierQs}`,
    { cache: "no-store" }
  );
  const supplierJson = await supplierRes.json().catch(() => ({}));
  if (!supplierRes.ok) return { itemCode, availableQty: 0 };

  const supplierDoc =
    supplierJson &&
    typeof supplierJson === "object" &&
    "data" in supplierJson &&
    supplierJson.data &&
    typeof supplierJson.data === "object" &&
    supplierJson.data !== null &&
    !Array.isArray(supplierJson.data)
      ? (supplierJson.data as Record<string, unknown>)
      : null;

  const warehouseRaw = supplierDoc?.custom_warehouse;
  const warehouse =
    typeof warehouseRaw === "string" && warehouseRaw.trim()
      ? warehouseRaw.trim()
      : "";
  if (!warehouse) return { itemCode, availableQty: 0 };

  const binQs = new URLSearchParams({
    filters: JSON.stringify([
      ["item_code", "=", itemCode],
      ["warehouse", "=", warehouse],
    ]),
    fields: JSON.stringify(["actual_qty"]),
    limit_page_length: "1000",
  });
  const binRes = await erpnextFetch(env, `/api/resource/Bin?${binQs}`, {
    cache: "no-store",
  });
  const binJson = await binRes.json().catch(() => ({}));
  if (!binRes.ok) return { itemCode, availableQty: 0 };

  let totalQty = 0;
  for (const row of extractDataRows(binJson)) {
    totalQty += parseQty(row.actual_qty);
  }
  return { itemCode, availableQty: totalQty };
}

/**
 * Resolves warehouse stock for a cart offer JWE (same rules as checkout preview).
 * Returns 0 when the token cannot be resolved.
 */
export async function getAvailableQtyForOfferToken(
  env: ErpnextEnv,
  secret: Uint8Array,
  offerToken: string
): Promise<number> {
  const { availableQty } = await resolveOfferStock(env, secret, offerToken);
  return availableQty;
}

export async function getOfferStockMeta(
  env: ErpnextEnv,
  secret: Uint8Array,
  offerToken: string
): Promise<OfferStockMeta> {
  return resolveOfferStock(env, secret, offerToken);
}
