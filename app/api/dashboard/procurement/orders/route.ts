import { NextResponse } from "next/server";

import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { getBuyerContext } from "@/lib/get-buyer-profile";
import { tryExtractFrappeMessage } from "@/lib/frappe-user-message";
import { prisma } from "@/lib/prisma";
import { getSessionEmail } from "@/lib/session";

function extractDataRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const o = json as { data?: unknown };
  if (!Array.isArray(o.data)) return [];
  return o.data.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && !Array.isArray(r)
  );
}

function docstatusLabel(raw: unknown): string {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : NaN;
  if (n === 0) return "Processing";
  if (n === 1) return "Confirmed";
  if (n === 2) return "Cancelled";
  return "Processing";
}

function parseErpnextErrorBody(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const env = readErpnextEnv();
  if ("error" in env) {
    return NextResponse.json({ error: env.error }, { status: 500 });
  }

  const buyerContext = await getBuyerContext(email);
  if (!buyerContext) {
    return NextResponse.json(
      { error: "No buyer account found." },
      { status: 403 }
    );
  }
  const customerId = buyerContext.customerId;

  const customerDocQs = new URLSearchParams({
    fields: JSON.stringify(["name", "customer_name", "customer_group"]),
  });

  let customerRes: Response;
  try {
    customerRes = await erpnextFetch(
      env,
      `/api/resource/Customer/${encodeURIComponent(customerId)}?${customerDocQs}`,
      { cache: "no-store" }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERPNext request failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!customerRes.ok) {
    const text = await customerRes.text().catch(() => "");
    const parsed = parseErpnextErrorBody(text);
    const msg =
      tryExtractFrappeMessage(parsed) ??
      `ERPNext returned ${customerRes.status}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const customerJson = await customerRes.json().catch(() => ({}));
  const customerData =
    customerJson &&
    typeof customerJson === "object" &&
    "data" in customerJson &&
    customerJson.data &&
    typeof customerJson.data === "object" &&
    customerJson.data !== null &&
    !Array.isArray(customerJson.data)
      ? (customerJson as { data: Record<string, unknown> }).data
      : null;

  const customerName =
    customerData && typeof customerData.customer_name === "string"
      ? customerData.customer_name.trim()
      : null;
  const customerGroup =
    customerData && typeof customerData.customer_group === "string"
      ? customerData.customer_group.trim()
      : null;

  const soQs = new URLSearchParams({
    filters: JSON.stringify([["customer", "=", customerId]]),
    fields: JSON.stringify([
      "name",
      "transaction_date",
      "delivery_date",
      "status",
      "docstatus",
      "grand_total",
    ]),
    order_by: "transaction_date desc",
    limit_page_length: "100",
  });

  let soRes: Response;
  try {
    soRes = await erpnextFetch(
      env,
      `/api/resource/Sales Order?${soQs}`,
      { cache: "no-store" }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERPNext request failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!soRes.ok) {
    const text = await soRes.text().catch(() => "");
    const parsed = parseErpnextErrorBody(text);
    const msg =
      tryExtractFrappeMessage(parsed) ?? `ERPNext returned ${soRes.status}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const soJson = await soRes.json().catch(() => ({}));
  const orders = extractDataRows(soJson);

  const results = await Promise.all(
    orders.map(async (order) => {
      const name = typeof order.name === "string" ? order.name.trim() : "";
      const cartItems = await prisma.cartItem.findMany({
        where: { orderId: name, userId: email },
      });

      return {
        orderId: name,
        date: order.transaction_date ?? null,
        delivery_date: order.delivery_date ?? null,
        status: docstatusLabel(order.docstatus),
        docstatus: order.docstatus,
        grandTotal: order.grand_total ?? null,
        items: cartItems.map(
          (item: {
            genericName: string;
            vendorAlias: string;
            quantity: number;
            price: number;
            uom: string;
          }) => ({
          genericName: item.genericName,
          vendorAlias: item.vendorAlias,
          quantity: item.quantity,
          price: item.price,
          uom: item.uom,
        })),
      };
    })
  );

  const sorted = [...results].sort((a, b) => {
    const da = a.date != null ? String(a.date) : "";
    const db = b.date != null ? String(b.date) : "";
    return db.localeCompare(da);
  });

  return NextResponse.json(
    {
      customerId,
      customerName,
      customerGroup,
      orders: sorted,
    },
    { status: 200 }
  );
}
