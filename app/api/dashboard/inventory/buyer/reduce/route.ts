import { NextRequest, NextResponse } from "next/server";
import { NotificationType } from "@prisma/client";

import { resolveBuyerWarehouseName } from "@/lib/buyer-warehouse-resolve";
import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { getBuyerContext } from "@/lib/get-buyer-profile";
import { createNotification } from "@/lib/notifications-service";
import { getSessionEmail } from "@/lib/session";

export async function POST(req: NextRequest) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const itemCode =
    typeof o.itemCode === "string" ? o.itemCode.trim() : "";
  const warehouse =
    typeof o.warehouse === "string" ? o.warehouse.trim() : "";
  const quantity =
    typeof o.quantity === "number"
      ? o.quantity
      : typeof o.quantity === "string"
        ? Number.parseFloat(o.quantity)
        : NaN;
  const reason =
    typeof o.reason === "string" ? o.reason.trim() : "";
  const notes =
    typeof o.notes === "string" ? o.notes.trim() : "";

  if (!itemCode || !warehouse || !Number.isFinite(quantity) || quantity < 1) {
    return NextResponse.json(
      { error: "itemCode, warehouse, and positive quantity are required." },
      { status: 400 }
    );
  }

  const env = readErpnextEnv();
  if ("error" in env) {
    return NextResponse.json({ error: env.error }, { status: 500 });
  }

  const customerId = buyer.customerId;
  const cw = await resolveBuyerWarehouseName(customerId);
  if (!cw || cw !== warehouse) {
    return NextResponse.json(
      { error: "Warehouse does not match your account." },
      { status: 403 }
    );
  }

  const itemQs = new URLSearchParams({
    fields: JSON.stringify(["item_name"]),
  });
  const itemRes = await erpnextFetch(
    env,
    `/api/resource/Item/${encodeURIComponent(itemCode)}?${itemQs}`,
    { cache: "no-store" }
  );
  const itemJson = await itemRes.json().catch(() => ({}));
  let itemName = itemCode;
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
    if (id && typeof id.item_name === "string" && id.item_name.trim()) {
      itemName = id.item_name.trim();
    }
  }

  const companyName =
    process.env.ERPNEXT_COMPANY?.trim() ||
    process.env.ERPNEXT_COMPANY_NAME?.trim() ||
    "BAMYS";

  const postingDate = new Date().toISOString().slice(0, 10);

  const sePayload: Record<string, unknown> = {
    stock_entry_type: "Material Issue",
    company: companyName,
    posting_date: postingDate,
    remarks:
      reason +
      (notes ? ` — ${notes}` : ""),
    items: [
      {
        item_code: itemCode,
        qty: quantity,
        s_warehouse: warehouse,
        basic_rate: 0,
      },
    ],
  };

  const createRes = await erpnextFetch(env, "/api/resource/Stock Entry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sePayload),
    cache: "no-store",
  });
  const createJson = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    return NextResponse.json(
      {
        error:
          typeof createJson === "object" &&
          createJson !== null &&
          "exception" in createJson
            ? String((createJson as { exception?: string }).exception).slice(
                0,
                500
              )
            : "Stock entry failed.",
      },
      { status: 502 }
    );
  }

  const created = createJson as { data?: { name?: string } };
  const seName =
    typeof created.data?.name === "string" && created.data.name.trim()
      ? created.data.name.trim()
      : null;
  if (seName) {
    const submitRes = await erpnextFetch(
      env,
      `/api/resource/Stock Entry/${encodeURIComponent(seName)}`,
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
        { error: `Stock entry created but submit failed: ${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }
  }

  await createNotification(
    email,
    "Stock Updated",
    `${quantity} units of ${itemName} recorded as used.`,
    NotificationType.SYSTEM,
    "/dashboard/inventory"
  );

  return NextResponse.json({ ok: true });
}
