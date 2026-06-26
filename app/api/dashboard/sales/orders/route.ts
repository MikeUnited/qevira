import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { fetchEarliestBatchExpiry } from "@/lib/erpnext-batch-expiry";
import { erpnextFetch, readErpnextEnv, type ErpnextEnv } from "@/lib/erpnext-auth";
import { getSupplierCredentials } from "@/lib/supplier-credentials";
import { tryExtractFrappeMessage } from "@/lib/frappe-user-message";
import { getUserProfile } from "@/lib/server-user-profile";
import { decrypt, SESSION_COOKIE } from "@/lib/session";

const FORBIDDEN = "Must be a registered supplier to view orders.";

function extractDataRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const o = json as { data?: unknown };
  if (!Array.isArray(o.data)) return [];
  return o.data.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && !Array.isArray(r)
  );
}

function extractFrappeError(data: unknown): string {
  if (!data || typeof data !== "object") return "ERPNext request failed.";
  const fromTry = tryExtractFrappeMessage(data);
  if (fromTry) return fromTry;
  const o = data as Record<string, unknown>;
  if (typeof o.exception === "string" && o.exception.trim()) {
    return o.exception.trim().slice(0, 500);
  }
  return "ERPNext request failed.";
}

function parseQty(raw: unknown): number {
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** `data` from GET /api/resource/Sales Order/{name} */
function parseSalesOrderData(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  const o = json as { data?: unknown };
  const d = o.data;
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  return d as Record<string, unknown>;
}

function getEmbeddedSalesOrderItems(
  data: Record<string, unknown>
): Record<string, unknown>[] {
  const raw = data.items;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && !Array.isArray(r)
  );
}

function itemsIncludeSupplierWarehouse(
  items: Record<string, unknown>[],
  supplierWarehouse: string
): boolean {
  for (const row of items) {
    const w =
      typeof row.warehouse === "string" ? row.warehouse.trim() : "";
    if (w === supplierWarehouse) return true;
  }
  return false;
}

type SupplierContext =
  | {
      ok: true;
      env: ErpnextEnv;
      supplierWarehouse: string;
      supplierId: string;
    }
  | { ok: false; response: NextResponse };

async function requireSupplier(): Promise<SupplierContext> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: FORBIDDEN }, { status: 403 }),
    };
  }

  const sessionPayload = await decrypt(token);
  const sessionEmail =
    typeof sessionPayload?.email === "string"
      ? sessionPayload.email.trim()
      : "";
  if (!sessionEmail) {
    return {
      ok: false,
      response: NextResponse.json({ error: FORBIDDEN }, { status: 403 }),
    };
  }

  const profile = await getUserProfile();
  if (!profile.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: FORBIDDEN }, { status: 403 }),
    };
  }
  if (profile.data.supplierGroup === null) {
    return {
      ok: false,
      response: NextResponse.json({ error: FORBIDDEN }, { status: 403 }),
    };
  }

  const env = readErpnextEnv();
  if ("error" in env) {
    return {
      ok: false,
      response: NextResponse.json({ error: env.error }, { status: 500 }),
    };
  }

  const supplierQs = new URLSearchParams({
    filters: JSON.stringify([["email_id", "=", sessionEmail]]),
    fields: JSON.stringify(["name"]),
    limit_page_length: "1",
  });
  const supplierRes = await erpnextFetch(
    env,
    `/api/resource/Supplier?${supplierQs}`,
    { cache: "no-store" }
  );
  const supplierJson = await supplierRes.json().catch(() => ({}));
  const supplierRows = extractDataRows(supplierJson);
  const supplierId =
    supplierRows[0] &&
    typeof supplierRows[0].name === "string" &&
    supplierRows[0].name.trim()
      ? supplierRows[0].name.trim()
      : "";
  if (!supplierId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Could not resolve supplier record for this account." },
        { status: 403 }
      ),
    };
  }

  const whQs = new URLSearchParams({
    fields: JSON.stringify(["custom_warehouse"]),
  });
  const docRes = await erpnextFetch(
    env,
    `/api/resource/Supplier/${encodeURIComponent(supplierId)}?${whQs}`,
    { cache: "no-store" }
  );
  const docJson = await docRes.json().catch(() => ({}));
  if (!docRes.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: extractFrappeError(docJson) },
        { status: 502 }
      ),
    };
  }
  const data =
    docJson &&
    typeof docJson === "object" &&
    "data" in docJson &&
    docJson.data &&
    typeof docJson.data === "object" &&
    docJson.data !== null &&
    !Array.isArray(docJson.data)
      ? (docJson.data as Record<string, unknown>)
      : null;
  const cw = data?.custom_warehouse;
  const supplierWarehouse =
    typeof cw === "string" ? cw.trim() : cw != null ? String(cw).trim() : "";
  if (!supplierWarehouse) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Supplier warehouse not provisioned. Please contact support.",
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true, env, supplierWarehouse, supplierId };
}

async function fetchBinTotal(
  env: ErpnextEnv,
  itemCode: string,
  warehouse: string
): Promise<number> {
  const binQs = new URLSearchParams({
    filters: JSON.stringify([
      ["item_code", "=", itemCode],
      ["warehouse", "=", warehouse],
    ]),
    fields: JSON.stringify(["actual_qty"]),
    limit_page_length: "1000",
  });
  const res = await erpnextFetch(env, `/api/resource/Bin?${binQs}`, {
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return 0;
  let total = 0;
  for (const row of extractDataRows(json)) {
    total += parseQty(row.actual_qty);
  }
  return total;
}

async function listOrdersForWarehouse(
  env: ErpnextEnv,
  warehouse: string
): Promise<Record<string, unknown>[]> {
  const soQs = new URLSearchParams({
    filters: JSON.stringify([
      ["Sales Order Item", "warehouse", "=", warehouse],
    ]),
    fields: JSON.stringify([
      "name",
      "customer",
      "customer_name",
      "transaction_date",
      "delivery_date",
      "status",
      "docstatus",
      "grand_total",
      "total_qty",
    ]),
    limit_page_length: "500",
  });

  let res = await erpnextFetch(
    env,
    `/api/resource/Sales Order?${soQs}`,
    { cache: "no-store" }
  );
  let json = await res.json().catch(() => ({}));
  let rows = res.ok ? extractDataRows(json) : [];

  if (!res.ok || rows.length === 0) {
    const soiQs = new URLSearchParams({
      filters: JSON.stringify([["warehouse", "=", warehouse]]),
      fields: JSON.stringify(["parent"]),
      limit_page_length: "1000",
    });
    const soiRes = await erpnextFetch(
      env,
      `/api/resource/Sales Order Item?${soiQs}`,
      { cache: "no-store" }
    );
    const soiJson = await soiRes.json().catch(() => ({}));
    if (!soiRes.ok) {
      return [];
    }
    const parents = new Set<string>();
    for (const r of extractDataRows(soiJson)) {
      const p = typeof r.parent === "string" ? r.parent.trim() : "";
      if (p) parents.add(p);
    }
    if (parents.size === 0) return [];

    const soQs2 = new URLSearchParams({
      filters: JSON.stringify([["name", "in", [...parents]]]),
      fields: JSON.stringify([
        "name",
        "customer",
        "customer_name",
        "transaction_date",
        "delivery_date",
        "status",
        "docstatus",
        "grand_total",
        "total_qty",
      ]),
      limit_page_length: "500",
    });
    res = await erpnextFetch(
      env,
      `/api/resource/Sales Order?${soQs2}`,
      { cache: "no-store" }
    );
    json = await res.json().catch(() => ({}));
    rows = res.ok ? extractDataRows(json) : [];
  }

  return rows;
}

async function verifyWarehouseOwnsOrder(
  env: ErpnextEnv,
  orderName: string,
  supplierWarehouse: string
): Promise<boolean> {
  const qs = new URLSearchParams({
    fields: JSON.stringify(["name", "items"]),
  });
  const res = await erpnextFetch(
    env,
    `/api/resource/${encodeURIComponent("Sales Order")}/${encodeURIComponent(orderName)}?${qs}`,
    { cache: "no-store" }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return false;
  const data = parseSalesOrderData(json);
  if (!data) return false;
  const items = getEmbeddedSalesOrderItems(data);
  return itemsIncludeSupplierWarehouse(items, supplierWarehouse);
}

export async function GET(req: NextRequest) {
  const ctx = await requireSupplier();
  if (!ctx.ok) return ctx.response;

  const orderName = req.nextUrl.searchParams.get("orderName")?.trim() ?? "";

  if (orderName) {
    const detailQs = new URLSearchParams({
      fields: JSON.stringify([
        "name",
        "customer",
        "customer_name",
        "transaction_date",
        "delivery_date",
        "docstatus",
        "grand_total",
        "items",
      ]),
    });
    const soRes = await erpnextFetch(
      ctx.env,
      `/api/resource/${encodeURIComponent("Sales Order")}/${encodeURIComponent(orderName)}?${detailQs}`,
      { cache: "no-store" }
    );
    const soJson = await soRes.json().catch(() => ({}));
    if (!soRes.ok) {
      return NextResponse.json(
        { error: extractFrappeError(soJson) },
        { status: 502 }
      );
    }
    const soData = parseSalesOrderData(soJson);
    if (!soData) {
      return NextResponse.json(
        { error: "Sales Order not found." },
        { status: 404 }
      );
    }

    const itemRows = getEmbeddedSalesOrderItems(soData);
    if (
      !itemsIncludeSupplierWarehouse(itemRows, ctx.supplierWarehouse)
    ) {
      return NextResponse.json(
        {
          error:
            "Unauthorized: This order does not belong to your warehouse.",
        },
        { status: 403 }
      );
    }

    const orderPayload = {
      name: soData.name,
      customer: soData.customer,
      customer_name: soData.customer_name,
      transaction_date: soData.transaction_date,
      delivery_date: soData.delivery_date,
      docstatus: soData.docstatus,
      grand_total: soData.grand_total,
    };

    const lines: Array<{
      item_code: string;
      item_name: string | null;
      qty: number;
      rate: number;
      amount: number | null;
      warehouse: string | null;
      uom: string | null;
      actual_qty: number;
      earliest_batch_expiry: string | null;
    }> = [];

    for (const row of itemRows) {
      const itemCode =
        typeof row.item_code === "string" ? row.item_code.trim() : "";
      if (!itemCode) continue;
      const wh =
        typeof row.warehouse === "string" ? row.warehouse.trim() : "";
      const qtyOrdered = parseQty(row.qty);
      const rate = parseQty(row.rate);
      const amountRaw = row.amount;
      const amount =
        typeof amountRaw === "number"
          ? amountRaw
          : typeof amountRaw === "string"
            ? Number.parseFloat(amountRaw)
            : null;
      const itemName =
        typeof row.item_name === "string" ? row.item_name.trim() : null;
      const uom = typeof row.uom === "string" ? row.uom.trim() : null;

      const actualQty = await fetchBinTotal(
        ctx.env,
        itemCode,
        ctx.supplierWarehouse
      );

      lines.push({
        item_code: itemCode,
        item_name: itemName,
        qty: qtyOrdered,
        rate,
        amount: Number.isFinite(amount ?? NaN) ? amount : null,
        warehouse: wh || null,
        uom,
        actual_qty: actualQty,
        earliest_batch_expiry: null,
      });
    }

    // TODO: Replace with per-tenant credentials once all suppliers are provisioned
    const batchExpiries = await Promise.all(
      lines.map((l) => fetchEarliestBatchExpiry(ctx.env, l.item_code))
    );
    for (let i = 0; i < lines.length; i++) {
      lines[i].earliest_batch_expiry = batchExpiries[i] ?? null;
    }

    return NextResponse.json(
      {
        supplierWarehouse: ctx.supplierWarehouse,
        order: orderPayload,
        lines,
      },
      { status: 200 }
    );
  }

  const orders = await listOrdersForWarehouse(ctx.env, ctx.supplierWarehouse);

  return NextResponse.json(
    {
      supplierWarehouse: ctx.supplierWarehouse,
      orders,
    },
    { status: 200 }
  );
}

export async function PUT(req: NextRequest) {
  const ctx = await requireSupplier();
  if (!ctx.ok) return ctx.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orderName =
    typeof body === "object" &&
    body !== null &&
    "orderName" in body &&
    typeof (body as { orderName?: unknown }).orderName === "string"
      ? (body as { orderName: string }).orderName.trim()
      : "";

  if (!orderName) {
    return NextResponse.json({ error: "orderName is required." }, { status: 400 });
  }

  const owns = await verifyWarehouseOwnsOrder(
    ctx.env,
    orderName,
    ctx.supplierWarehouse
  );
  if (!owns) {
    return NextResponse.json(
      {
        error:
          "Unauthorized: This order does not belong to your warehouse.",
      },
      { status: 403 }
    );
  }

  const getRes = await erpnextFetch(
    ctx.env,
    `/api/resource/${encodeURIComponent("Sales Order")}/${encodeURIComponent(orderName)}`,
    { cache: "no-store" }
  );
  const getJson = await getRes.json().catch(() => ({}));
  if (!getRes.ok) {
    return NextResponse.json(
      { error: extractFrappeError(getJson) },
      { status: 502 }
    );
  }
  const doc =
    getJson &&
    typeof getJson === "object" &&
    "data" in getJson &&
    getJson.data &&
    typeof getJson.data === "object" &&
    getJson.data !== null
      ? (getJson.data as Record<string, unknown>)
      : null;
  if (!doc) {
    return NextResponse.json(
      { error: "Sales Order not found." },
      { status: 404 }
    );
  }

  const currentStatus = doc.docstatus;
  if (currentStatus === 1 || currentStatus === 2) {
    return NextResponse.json(
      { error: "Order is already submitted or cancelled." },
      { status: 400 }
    );
  }

  const tenantCreds = await getSupplierCredentials(ctx.supplierId);
  const tenantAuth = tenantCreds ?? undefined;

  const putPayload = { ...doc, docstatus: 1 };
  const putRes = await erpnextFetch(
    ctx.env,
    `/api/resource/${encodeURIComponent("Sales Order")}/${encodeURIComponent(orderName)}`,
    {
      method: "PUT",
      body: JSON.stringify(putPayload),
      cache: "no-store",
    },
    tenantAuth
  );
  const putJson = await putRes.json().catch(() => ({}));

  if (!putRes.ok) {
    console.error(
      "[dashboard/sales/orders] submit failed:",
      putRes.status,
      JSON.stringify(putJson).slice(0, 800)
    );
    return NextResponse.json(
      { error: extractFrappeError(putJson) },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
