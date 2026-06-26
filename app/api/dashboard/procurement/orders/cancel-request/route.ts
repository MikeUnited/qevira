import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

import { isOrderOverdue } from "@/lib/order-overdue";
import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { getBuyerContext } from "@/lib/get-buyer-profile";
import { tryExtractFrappeMessage } from "@/lib/frappe-user-message";
import { getSessionEmail } from "@/lib/session";

function parseSoData(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  const o = json as { data?: unknown };
  const d = o.data;
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  return d as Record<string, unknown>;
}

function deliveryDateStr(raw: unknown): string | null {
  if (raw == null) return null;
  const s = typeof raw === "string" ? raw.trim() : String(raw);
  if (!s) return null;
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export async function POST(req: NextRequest) {
  const sessionEmail = await getSessionEmail();
  if (!sessionEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const buyerContext = await getBuyerContext(sessionEmail);
  if (!buyerContext) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orderId =
    typeof raw === "object" &&
    raw !== null &&
    "orderId" in raw &&
    typeof (raw as { orderId: unknown }).orderId === "string"
      ? (raw as { orderId: string }).orderId.trim()
      : "";
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  }

  const env = readErpnextEnv();
  if ("error" in env) {
    return NextResponse.json({ error: env.error }, { status: 500 });
  }

  const soQs = new URLSearchParams({
    fields: JSON.stringify([
      "name",
      "customer",
      "delivery_date",
      "docstatus",
      "status",
    ]),
  });

  const soRes = await erpnextFetch(
    env,
    `/api/resource/${encodeURIComponent("Sales Order")}/${encodeURIComponent(orderId)}?${soQs}`,
    { cache: "no-store" }
  );
  const soJson = await soRes.json().catch(() => ({}));
  if (!soRes.ok) {
    const msg = tryExtractFrappeMessage(soJson) ?? "Order not found.";
    return NextResponse.json({ error: msg }, { status: 404 });
  }

  const data = parseSoData(soJson);
  if (!data) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const customer =
    typeof data.customer === "string" ? data.customer.trim() : "";
  if (!customer || customer !== buyerContext.customerId) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const deliveryRaw = data.delivery_date;
  const deliveryDate = deliveryDateStr(deliveryRaw);
  if (!isOrderOverdue(deliveryDate)) {
    return NextResponse.json(
      { error: "Order is not yet overdue." },
      { status: 400 }
    );
  }

  const ts = new Date().toISOString();
  const content = `Buyer requested cancellation. Reason: Order overdue. Requested by: ${sessionEmail} at ${ts}`;

  const commentRes = await erpnextFetch(env, "/api/resource/Comment", {
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
  const commentJson = await commentRes.json().catch(() => ({}));
  if (!commentRes.ok) {
    const msg =
      tryExtractFrappeMessage(commentJson) ??
      "Could not record cancellation request.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const adminTo =
    process.env.ADMIN_NOTIFICATION_EMAIL?.trim() ||
    process.env.DEV_EMAIL_OVERRIDE?.trim() ||
    "";
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (apiKey && adminTo) {
    const resend = new Resend(apiKey);
    const deliveryDisplay = deliveryDate ?? "—";
    const { error: sendErr } = await resend.emails.send({
      from: "noreply@qevira.michaelalene.com",
      to: adminTo,
      subject: `Cancellation Request — ${orderId}`,
      text: `Buyer ${sessionEmail} has requested cancellation of order ${orderId} due to overdue delivery. Original due date: ${deliveryDisplay}.`,
    });
    if (sendErr) {
      console.error(
        "[procurement/orders/cancel-request] Resend error:",
        sendErr
      );
    }
  } else if (!adminTo) {
    console.warn(
      "[procurement/orders/cancel-request] ADMIN_NOTIFICATION_EMAIL and DEV_EMAIL_OVERRIDE are unset; skipping email."
    );
  } else if (!apiKey) {
    console.warn(
      "[procurement/orders/cancel-request] RESEND_API_KEY is unset; skipping email."
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Cancellation request submitted.",
  });
}
