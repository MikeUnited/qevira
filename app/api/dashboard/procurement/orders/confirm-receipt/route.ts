import { NextRequest, NextResponse } from "next/server";
import { NotificationType } from "@prisma/client";

import { resolveBuyerWarehouseName } from "@/lib/buyer-warehouse-resolve";
import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { getBuyerContext } from "@/lib/get-buyer-profile";
import { createNotification } from "@/lib/notifications-service";
import { prisma } from "@/lib/prisma";
import { getSessionEmail, getSessionPayload } from "@/lib/session";

// Requires Read permission on Batch DocType
// for Qevira API Service role in ERPNext

// TODO: Implement partial receipt before beta
// Currently all-or-nothing receipt confirmation

function extractDataRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const o = json as { data?: unknown };
  if (!Array.isArray(o.data)) return [];
  return o.data.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && !Array.isArray(r)
  );
}

async function fetchEarliestAvailableBatchName(
  env: Parameters<typeof erpnextFetch>[0],
  itemCode: string
): Promise<string | null> {
  const qs = new URLSearchParams({
    filters: JSON.stringify([
      ["item", "=", itemCode],
      ["batch_qty", ">", 0],
    ]),
    fields: JSON.stringify(["name", "expiry_date", "batch_qty"]),
    order_by: "expiry_date asc",
    limit_page_length: "1",
  });
  const res = await erpnextFetch(
    env,
    `/api/resource/${encodeURIComponent("Batch")}?${qs}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const json = await res.json().catch(() => ({}));
  const rows = extractDataRows(json);
  const first = rows[0];
  const name =
    first && typeof first.name === "string" && first.name.trim()
      ? first.name.trim()
      : "";
  return name || null;
}

export async function POST(req: NextRequest) {
  const sessionEmail = await getSessionEmail();
  if (!sessionEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await getSessionPayload();
  const role = session?.teamRole;
  if (role === "PHARMACIST") {
    return NextResponse.json(
      { error: "Only Directors and Owners can confirm receipt." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orderId =
    body &&
    typeof body === "object" &&
    "orderId" in body &&
    typeof (body as { orderId?: unknown }).orderId === "string"
      ? (body as { orderId: string }).orderId.trim()
      : "";
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  }

  const buyer = await getBuyerContext(sessionEmail);
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

  const existing = await prisma.procurementReceiptConfirmation.findUnique({
    where: {
      userId_orderId: { userId: sessionEmail, orderId },
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Receipt already confirmed for this order." },
      { status: 400 }
    );
  }

  const soQs = new URLSearchParams({
    fields: JSON.stringify([
      "name",
      "customer",
      "delivery_date",
      "docstatus",
      "status",
      "items",
      "grand_total",
    ]),
  });
  const soRes = await erpnextFetch(
    env,
    `/api/resource/${encodeURIComponent("Sales Order")}/${encodeURIComponent(orderId)}?${soQs}`,
    { cache: "no-store" }
  );
  const soJson = await soRes.json().catch(() => ({}));
  if (!soRes.ok) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const data =
    soJson &&
    typeof soJson === "object" &&
    "data" in soJson &&
    soJson.data &&
    typeof soJson.data === "object" &&
    soJson.data !== null &&
    !Array.isArray(soJson.data)
      ? (soJson.data as Record<string, unknown>)
      : null;
  if (!data) {
    return NextResponse.json({ error: "Invalid order response." }, { status: 502 });
  }

  const customer =
    typeof data.customer === "string" ? data.customer.trim() : "";
  if (!customer || customer !== buyer.customerId) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const docstatusRaw = data.docstatus;
  const docstatus =
    typeof docstatusRaw === "number"
      ? docstatusRaw
      : typeof docstatusRaw === "string"
        ? Number.parseInt(docstatusRaw, 10)
        : NaN;
  if (docstatus !== 1) {
    return NextResponse.json(
      { error: "Order must be submitted before confirming receipt." },
      { status: 400 }
    );
  }

  const buyerWarehouse =
    (await resolveBuyerWarehouseName(buyer.customerId)) ?? "";
  if (!buyerWarehouse) {
    return NextResponse.json(
      { error: "No inventory warehouse configured." },
      { status: 400 }
    );
  }

  const fullWarehouseName = buyerWarehouse.endsWith(" - BAMYS")
    ? buyerWarehouse
    : `${buyerWarehouse} - BAMYS`;

  const itemsRaw = data.items;
  const itemsRows = Array.isArray(itemsRaw) ? itemsRaw : [];
  if (itemsRows.length === 0) {
    return NextResponse.json(
      { error: "Order has no line items." },
      { status: 400 }
    );
  }

  type ParsedLine = {
    item_code: string;
    qty: number;
    rate: number;
    soBatchNo?: string;
  };

  const parsedLines: ParsedLine[] = [];
  for (const row of itemsRows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const ic =
      typeof r.item_code === "string" ? r.item_code.trim() : "";
    if (!ic) continue;
    const qtyRaw = r.qty;
    const qty =
      typeof qtyRaw === "number"
        ? qtyRaw
        : typeof qtyRaw === "string"
          ? Number.parseFloat(qtyRaw)
          : 0;
    const rateRaw = r.rate;
    const rate =
      typeof rateRaw === "number"
        ? rateRaw
        : typeof rateRaw === "string"
          ? Number.parseFloat(rateRaw)
          : 0;
    const soBatch =
      typeof r.batch_no === "string" && r.batch_no.trim()
        ? r.batch_no.trim()
        : undefined;
    parsedLines.push({
      item_code: ic,
      qty: Number.isFinite(qty) ? qty : 0,
      rate: Number.isFinite(rate) ? rate : 0,
      ...(soBatch ? { soBatchNo: soBatch } : {}),
    });
  }

  const uniqueItemCodes = [...new Set(parsedLines.map((l) => l.item_code))];
  const batchMap: Record<string, string> = {};
  await Promise.all(
    uniqueItemCodes.map(async (itemCode) => {
      const name = await fetchEarliestAvailableBatchName(env, itemCode);
      if (name) {
        batchMap[itemCode] = name;
      }
    })
  );

  const seItems: Array<{
    item_code: string;
    qty: number;
    t_warehouse: string;
    basic_rate: number;
    batch_no?: string;
  }> = [];

  for (const item of parsedLines) {
    const batchNo = item.soBatchNo ?? batchMap[item.item_code];
    seItems.push({
      item_code: item.item_code,
      qty: item.qty,
      t_warehouse: fullWarehouseName,
      basic_rate: item.rate,
      ...(batchNo ? { batch_no: batchNo } : {}),
    });
  }

  if (seItems.length === 0) {
    return NextResponse.json(
      { error: "Could not parse order line items." },
      { status: 400 }
    );
  }

  const companyName =
    process.env.ERPNEXT_COMPANY?.trim() ||
    process.env.ERPNEXT_COMPANY_NAME?.trim() ||
    "BAMYS";
  const postingDate = new Date().toISOString().slice(0, 10);

  const stockPayload = {
    stock_entry_type: "Material Receipt",
    company: companyName,
    posting_date: postingDate,
    items: seItems,
  };

  const createRes = await erpnextFetch(env, "/api/resource/Stock Entry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stockPayload),
    cache: "no-store",
  });
  const createJson = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    const msg =
      typeof createJson === "object" &&
      createJson !== null &&
      "exception" in createJson
        ? String((createJson as { exception?: string }).exception).slice(
            0,
            500
          )
        : "Stock entry failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const created = createJson as { data?: { name?: string } };
  const seName =
    typeof created.data?.name === "string" && created.data.name.trim()
      ? created.data.name.trim()
      : null;
  if (seName) {
    const submitRes = await erpnextFetch(
      env,
      `/api/resource/${encodeURIComponent("Stock Entry")}/${encodeURIComponent(seName)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docstatus: 1 }),
        cache: "no-store",
      }
    );
    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      return NextResponse.json(
        {
          error: `Stock entry created but submit failed: ${errText.slice(0, 300)}`,
        },
        { status: 502 }
      );
    }
  }

  const content = `Buyer confirmed receipt of all items. Stock moved to buyer warehouse: ${fullWarehouseName}`;
  await erpnextFetch(env, "/api/resource/Comment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      doctype: "Comment",
      comment_type: "Comment",
      reference_doctype: "Sales Order",
      reference_name: orderId,
      content,
    }),
    cache: "no-store",
  });

  await prisma.procurementReceiptConfirmation.create({
    data: {
      userId: sessionEmail,
      orderId,
    },
  });

  await createNotification(
    sessionEmail,
    "Receipt Confirmed",
    `You confirmed receipt of order ${orderId}. Your inventory has been updated.`,
    NotificationType.ORDER_UPDATE,
    "/dashboard/inventory"
  );

  return NextResponse.json({ ok: true });
}
