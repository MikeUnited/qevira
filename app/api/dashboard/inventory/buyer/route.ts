import { NextResponse } from "next/server";

import { resolveBuyerWarehouseName } from "@/lib/buyer-warehouse-resolve";
import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import {
  ensureBuyerWarehouse,
  linkWarehouseToCustomer,
  upsertBuyerWarehouseMapping,
} from "@/lib/erpnext-warehouse";
import { getBuyerContext } from "@/lib/get-buyer-profile";
import { getSessionEmail } from "@/lib/session";

function slugFromCustomerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function extractDataRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const o = json as { data?: unknown };
  if (!Array.isArray(o.data)) return [];
  return o.data.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && !Array.isArray(r)
  );
}

export async function GET() {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const buyer = await getBuyerContext(email);
  if (!buyer) {
    return NextResponse.json(
      { error: "No buyer account found." },
      { status: 403 }
    );
  }

  const env = readErpnextEnv();
  if ("error" in env) {
    return NextResponse.json({ error: env.error }, { status: 500 });
  }

  const customerId = buyer.customerId;

  let warehouse = await resolveBuyerWarehouseName(customerId);

  if (!warehouse) {
    const custQs = new URLSearchParams({
      fields: JSON.stringify(["custom_warehouse", "customer_name"]),
    });
    const custRes = await erpnextFetch(
      env,
      `/api/resource/Customer/${encodeURIComponent(customerId)}?${custQs}`,
      { cache: "no-store" }
    );
    const custJson = await custRes.json().catch(() => ({}));
    if (!custRes.ok) {
      return NextResponse.json(
        { error: "Could not load customer profile." },
        { status: 502 }
      );
    }
    const custData =
      custJson &&
      typeof custJson === "object" &&
      "data" in custJson &&
      custJson.data &&
      typeof custJson.data === "object" &&
      custJson.data !== null &&
      !Array.isArray(custJson.data)
        ? (custJson.data as Record<string, unknown>)
        : null;

    const warehouseRaw = custData?.custom_warehouse;
    const fromErp =
      typeof warehouseRaw === "string" && warehouseRaw.trim()
        ? warehouseRaw.trim()
        : null;

    if (fromErp) {
      await upsertBuyerWarehouseMapping(customerId, fromErp);
      warehouse = fromErp;
    } else {
      const customerName =
        custData && typeof custData.customer_name === "string"
          ? custData.customer_name.trim()
          : "";
      if (customerName) {
        try {
          const slug = slugFromCustomerName(customerName);
          if (slug) {
            const warehouseName = await ensureBuyerWarehouse(
              customerId,
              slug
            );
            await linkWarehouseToCustomer(customerId, warehouseName);
            return NextResponse.json({
              items: [],
              warehouse: warehouseName,
              justCreated: true,
            });
          }
        } catch {
          /* fall through */
        }
      }
      return NextResponse.json({ items: [], warehouse: null });
    }
  }

  const fullWarehouseName = warehouse.endsWith(" - BAMYS")
    ? warehouse
    : `${warehouse} - BAMYS`;

  const binQs = new URLSearchParams({
    filters: JSON.stringify([["warehouse", "=", fullWarehouseName]]),
    fields: JSON.stringify(["item_code", "actual_qty", "warehouse"]),
    limit_page_length: "500",
  });
  const binRes = await erpnextFetch(
    env,
    `/api/resource/Bin?${binQs}`,
    { cache: "no-store" }
  );
  const binJson = await binRes.json().catch(() => ({}));
  if (!binRes.ok) {
    return NextResponse.json(
      { error: "Could not load stock bins." },
      { status: 502 }
    );
  }
  const binRows = extractDataRows(binJson);

  const items: Array<{
    itemCode: string;
    itemName: string;
    itemGroup: string;
    stockUom: string;
    qty: number;
  }> = [];

  for (const row of binRows) {
    const itemCode =
      typeof row.item_code === "string" ? row.item_code.trim() : "";
    if (!itemCode) continue;
    const qtyRaw = row.actual_qty;
    const qty =
      typeof qtyRaw === "number"
        ? qtyRaw
        : typeof qtyRaw === "string"
          ? Number.parseFloat(qtyRaw)
          : 0;

    const itemQs = new URLSearchParams({
      fields: JSON.stringify(["item_name", "item_group", "stock_uom"]),
    });
    const itemRes = await erpnextFetch(
      env,
      `/api/resource/Item/${encodeURIComponent(itemCode)}?${itemQs}`,
      { cache: "no-store" }
    );
    const itemJson = await itemRes.json().catch(() => ({}));
    let itemName = itemCode;
    let itemGroup = "—";
    let stockUom = "—";
    if (itemRes.ok) {
      const id =
        itemJson &&
        typeof itemJson === "object" &&
        "data" in itemJson &&
        itemJson.data &&
        typeof itemJson.data === "object" &&
        itemJson.data !== null &&
        !Array.isArray(itemJson.data)
          ? (itemJson.data as Record<string, unknown>)
          : null;
      if (id) {
        if (typeof id.item_name === "string" && id.item_name.trim()) {
          itemName = id.item_name.trim();
        }
        if (typeof id.item_group === "string" && id.item_group.trim()) {
          itemGroup = id.item_group.trim();
        }
        if (typeof id.stock_uom === "string" && id.stock_uom.trim()) {
          stockUom = id.stock_uom.trim();
        }
      }
    }

    items.push({
      itemCode,
      itemName,
      itemGroup,
      stockUom,
      qty: Number.isFinite(qty) ? qty : 0,
    });
  }

  return NextResponse.json({ items, warehouse });
}
