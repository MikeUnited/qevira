import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtDecrypt } from "jose";

import { erpnextFetch, readErpnextEnv, type ErpnextEnv } from "@/lib/erpnext-auth";
import { getBuyerContext } from "@/lib/get-buyer-profile";
import { prisma } from "@/lib/prisma";
import { getUserProfile } from "@/lib/server-user-profile";
import { decrypt, SESSION_COOKIE } from "@/lib/session";

type PreviewItem = {
  /** Prisma cart row id — use for DELETE /api/marketplace/cart */
  cartItemId: string;
  genericName: string;
  qty: number;
  price: number;
  batchExpiry: string | null;
  stockWarning: boolean;
  isExpired: boolean;
  /** Warehouse total when resolved; omitted for expired-token lines. */
  availableQty?: number;
};

type VendorGroup = {
  supplierName: string;
  items: PreviewItem[];
};

type PreviewResponse = {
  summary: { totalAmount: number; itemCount: number };
  vendors: VendorGroup[];
};

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

function formatBatchExpiry(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    return s.length > 0 ? s : null;
  }
  return null;
}

function expiredLine(
  cart: {
    id: string;
    genericName: string;
    vendorAlias: string;
    price: number;
    quantity: number;
  }
): { supplierName: string; item: PreviewItem } {
  return {
    supplierName: cart.vendorAlias,
    item: {
      cartItemId: cart.id,
      genericName: cart.genericName,
      qty: cart.quantity,
      price: cart.price,
      batchExpiry: null,
      stockWarning: false,
      isExpired: true,
    },
  };
}

async function resolveLine(
  env: ErpnextEnv,
  secret: Uint8Array,
  cart: {
    id: string;
    offerToken: string;
    genericName: string;
    vendorAlias: string;
    price: number;
    quantity: number;
  }
): Promise<{ supplierName: string; item: PreviewItem }> {
  const base = {
    genericName: cart.genericName,
    qty: cart.quantity,
    price: cart.price,
  };

  let payload: Record<string, unknown>;
  try {
    const { payload: p } = await jwtDecrypt(cart.offerToken, secret);
    payload = p as Record<string, unknown>;
  } catch {
    return expiredLine(cart);
  }

  const itemCode =
    typeof payload.itemCode === "string" ? payload.itemCode.trim() : "";
  if (!itemCode) {
    return expiredLine(cart);
  }

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
  if (!itemPriceRes.ok) {
    return expiredLine(cart);
  }

  const priceRows = extractDataRows(itemPriceJson);
  const firstPrice = priceRows[0];
  const supplierId =
    firstPrice &&
    typeof firstPrice.supplier === "string" &&
    firstPrice.supplier.trim()
      ? firstPrice.supplier.trim()
      : "";
  if (!supplierId) {
    return expiredLine(cart);
  }

  const supplierQs = new URLSearchParams({
    fields: JSON.stringify(["supplier_name", "custom_warehouse"]),
  });
  const supplierRes = await erpnextFetch(
    env,
    `/api/resource/Supplier/${encodeURIComponent(supplierId)}?${supplierQs}`,
    { cache: "no-store" }
  );
  const supplierJson = await supplierRes.json().catch(() => ({}));
  if (!supplierRes.ok) {
    return expiredLine(cart);
  }

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

  const supplierName =
    supplierDoc &&
    typeof supplierDoc.supplier_name === "string" &&
    supplierDoc.supplier_name.trim()
      ? supplierDoc.supplier_name.trim()
      : "Unknown supplier";

  const warehouseRaw = supplierDoc?.custom_warehouse;
  const warehouse =
    typeof warehouseRaw === "string" && warehouseRaw.trim()
      ? warehouseRaw.trim()
      : "";

  let stockWarning = false;
  let availableQtyForLine = 0;
  if (warehouse) {
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
    if (binRes.ok) {
      const binRows = extractDataRows(binJson);
      let totalQty = 0;
      for (const row of binRows) {
        totalQty += parseQty(row.actual_qty);
      }
      availableQtyForLine = totalQty;
      stockWarning = totalQty < cart.quantity;
    } else {
      stockWarning = true;
      availableQtyForLine = 0;
    }
  } else {
    stockWarning = true;
    availableQtyForLine = 0;
  }

  const batchQs = new URLSearchParams({
    filters: JSON.stringify([["item", "=", itemCode]]),
    fields: JSON.stringify(["expiry_date"]),
    order_by: "expiry_date asc",
    limit_page_length: "1",
  });
  const batchRes = await erpnextFetch(env, `/api/resource/Batch?${batchQs}`, {
    cache: "no-store",
  });
  const batchJson = await batchRes.json().catch(() => ({}));
  let batchExpiry: string | null = null;
  if (batchRes.ok) {
    const batchRows = extractDataRows(batchJson);
    const firstBatch = batchRows[0];
    if (firstBatch) {
      batchExpiry = formatBatchExpiry(firstBatch.expiry_date);
    }
  }

  return {
    supplierName,
    item: {
      cartItemId: cart.id,
      ...base,
      batchExpiry,
      stockWarning,
      isExpired: false,
      availableQty: availableQtyForLine,
    },
  };
}

export async function GET() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const sessionPayload = await decrypt(sessionToken);
  const sessionEmail =
    typeof sessionPayload?.email === "string"
      ? sessionPayload.email.trim()
      : "";
  if (!sessionEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!(await getBuyerContext(sessionEmail))) {
    const profile = await getUserProfile();
    if (!profile.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Must be a registered buyer to preview checkout." },
      { status: 403 }
    );
  }

  if (!process.env.OFFER_TOKEN_SECRET) {
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 500 }
    );
  }
  const secretBuf = Buffer.from(process.env.OFFER_TOKEN_SECRET, "base64");
  if (secretBuf.length !== 32) {
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 500 }
    );
  }
  const secret = new Uint8Array(secretBuf);

  const env = readErpnextEnv();
  if ("error" in env) {
    return NextResponse.json({ error: env.error }, { status: 500 });
  }

  const cartItems = await prisma.cartItem.findMany({
    where: { userId: sessionEmail, orderId: null },
    orderBy: { createdAt: "desc" },
  });

  const resolved = await Promise.all(
    cartItems.map((row) => resolveLine(env, secret, row))
  );

  const vendorMap = new Map<string, PreviewItem[]>();
  for (const { supplierName, item } of resolved) {
    const list = vendorMap.get(supplierName) ?? [];
    list.push(item);
    vendorMap.set(supplierName, list);
  }

  const vendors: VendorGroup[] = [...vendorMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([supplierName, items]) => ({ supplierName, items }));

  let totalAmount = 0;
  let itemCount = 0;
  for (const { item } of resolved) {
    if (item.isExpired) continue;
    totalAmount += item.price * item.qty;
    itemCount += 1;
  }

  const body: PreviewResponse = {
    summary: {
      totalAmount,
      itemCount,
    },
    vendors,
  };

  return NextResponse.json(body, { status: 200 });
}
