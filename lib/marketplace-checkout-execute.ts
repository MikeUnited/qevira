import { NextResponse } from "next/server";
import { jwtDecrypt } from "jose";
import { Resend } from "resend";

import { NotificationType } from "@prisma/client";

import { erpnextFetch, readErpnextEnv, type ErpnextEnv } from "@/lib/erpnext-auth";
import { createNotification } from "@/lib/notifications-service";
import { prisma } from "@/lib/prisma";

export function extractDataRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const o = json as { data?: unknown };
  if (!Array.isArray(o.data)) return [];
  return o.data.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && !Array.isArray(r)
  );
}

function supplierIdFromRow(row: Record<string, unknown>): string {
  const s = row.supplier;
  if (typeof s === "string" && s.trim()) return s.trim();
  if (
    s &&
    typeof s === "object" &&
    s !== null &&
    "name" in s &&
    typeof (s as { name?: unknown }).name === "string"
  ) {
    return (s as { name: string }).name.trim();
  }
  return "";
}

export async function rollbackSalesOrders(
  env: ErpnextEnv,
  orderNames: string[]
): Promise<void> {
  for (const name of orderNames) {
    try {
      const res = await erpnextFetch(
        env,
        `/api/resource/${encodeURIComponent("Sales Order")}/${encodeURIComponent(name)}`,
        { method: "DELETE", cache: "no-store" }
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(
          `[checkout/execute] rollback DELETE failed for ${name}:`,
          res.status,
          text.slice(0, 500)
        );
      }
    } catch (e) {
      console.error(`[checkout/execute] rollback DELETE failed for ${name}:`, e);
    }
  }
}

export type ResolvedLine = {
  cartItemId: string;
  itemCode: string;
  qty: number;
  rate: number;
  uom: string;
  supplierId: string;
  warehouse: string;
};

async function fetchSupplierWarehouse(
  env: ErpnextEnv,
  supplierId: string
): Promise<string | null> {
  const qs = new URLSearchParams({
    fields: JSON.stringify(["custom_warehouse"]),
  });
  const res = await erpnextFetch(
    env,
    `/api/resource/Supplier/${encodeURIComponent(supplierId)}?${qs}`,
    { cache: "no-store" }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const data =
    json &&
    typeof json === "object" &&
    "data" in json &&
    json.data &&
    typeof json.data === "object" &&
    json.data !== null &&
    !Array.isArray(json.data)
      ? (json.data as Record<string, unknown>)
      : null;
  const wh = data?.custom_warehouse;
  return typeof wh === "string" && wh.trim() ? wh.trim() : null;
}

async function fetchItemPriceSupplier(
  env: ErpnextEnv,
  itemCode: string
): Promise<string | null> {
  const itemPriceQs = new URLSearchParams({
    filters: JSON.stringify([
      ["item_code", "=", itemCode],
      ["price_list", "=", "Standard Buying"],
    ]),
    fields: JSON.stringify(["supplier"]),
    limit_page_length: "1",
  });
  const res = await erpnextFetch(
    env,
    `/api/resource/Item Price?${itemPriceQs}`,
    { cache: "no-store" }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const rows = extractDataRows(json);
  const first = rows[0];
  return first ? supplierIdFromRow(first) : null;
}

function parseSalesOrderNameFromResponse(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const data = (json as { data?: unknown }).data;
  if (
    data &&
    typeof data === "object" &&
    data !== null &&
    "name" in data &&
    typeof (data as { name?: unknown }).name === "string"
  ) {
    const n = (data as { name: string }).name.trim();
    return n || null;
  }
  return null;
}

function parseGrandTotalFromSalesOrderResponse(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  const data = (json as { data?: unknown }).data;
  if (!data || typeof data !== "object" || data === null) return null;
  const gt = (data as { grand_total?: unknown }).grand_total;
  if (typeof gt === "number" && !Number.isNaN(gt)) return gt;
  if (typeof gt === "string") {
    const n = Number.parseFloat(gt);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatEtbAmount(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat("en-ET", {
      style: "currency",
      currency: "ETB",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ETB`;
  }
}

function resolveEmailRecipient(realEmail: string): string {
  return process.env.NODE_ENV === "development" &&
    process.env.DEV_EMAIL_OVERRIDE
    ? process.env.DEV_EMAIL_OVERRIDE
    : realEmail;
}

async function fetchSupplierEmailAndName(
  env: ErpnextEnv,
  supplierId: string
): Promise<{ email: string | null; supplierName: string | null }> {
  const qs = new URLSearchParams({
    fields: JSON.stringify(["email_id", "supplier_name"]),
  });
  const res = await erpnextFetch(
    env,
    `/api/resource/Supplier/${encodeURIComponent(supplierId)}?${qs}`,
    { cache: "no-store" }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { email: null, supplierName: null };
  }
  const data =
    json &&
    typeof json === "object" &&
    "data" in json &&
    json.data &&
    typeof json.data === "object" &&
    json.data !== null &&
    !Array.isArray(json.data)
      ? (json.data as Record<string, unknown>)
      : null;
  if (!data) return { email: null, supplierName: null };
  const emailRaw = data.email_id;
  const nameRaw = data.supplier_name;
  const email =
    typeof emailRaw === "string" && emailRaw.trim()
      ? emailRaw.trim()
      : null;
  const supplierName =
    typeof nameRaw === "string" && nameRaw.trim()
      ? nameRaw.trim()
      : null;
  return { email, supplierName };
}

function buildSupplierOrderEmailHtml(opts: {
  orderName: string;
  grandTotalFormatted: string;
  ctaUrl: string;
}): string {
  const { orderName, grandTotalFormatted, ctaUrl } = opts;
  const safeOrder = escapeHtml(orderName);
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;background:#f4f4f5;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 16px;">
      <tr>
        <td align="center">
          <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.05);">
            <tr>
              <td style="background:#18181b;color:#fafafa;padding:20px 24px;font-size:18px;font-weight:700;">
                New Order Received
              </td>
            </tr>
            <tr>
              <td style="padding:24px;color:#18181b;font-size:15px;line-height:1.6;">
                <p style="margin:0 0 16px;">A new Draft Sales Order (<strong>${safeOrder}</strong>) has been created for your warehouse. Please log in to verify stock and confirm fulfillment.</p>
                <p style="margin:0 0 20px;"><strong>Order value:</strong> ${escapeHtml(grandTotalFormatted)}</p>
                <p style="margin:0 0 20px;">
                  <a href="${ctaUrl}" style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;">Open orders dashboard</a>
                </p>
                <p style="margin:0;font-size:12px;color:#71717a;">Automated notification from BAMYS Marketplace. Do not reply.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildBuyerOrderConfirmationEmailHtml(opts: {
  orderIdsHtml: string;
  ctaUrl: string;
}): string {
  const { orderIdsHtml, ctaUrl } = opts;
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;background:#f4f4f5;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 16px;">
      <tr>
        <td align="center">
          <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.05);">
            <tr>
              <td style="background:#18181b;color:#fafafa;padding:20px 24px;font-size:18px;font-weight:700;">
                Your Order Has Been Placed
              </td>
            </tr>
            <tr>
              <td style="padding:24px;color:#18181b;font-size:15px;line-height:1.6;">
                <p style="margin:0 0 16px;">Your pharmaceutical order has been successfully submitted to our suppliers.</p>
                <p style="margin:0 0 8px;font-weight:600;">Order IDs</p>
                <ul style="margin:0 0 20px;padding-left:20px;">${orderIdsHtml}</ul>
                <p style="margin:0 0 20px;">
                  <a href="${ctaUrl}" style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;">View procurement history</a>
                </p>
                <p style="margin:0;font-size:12px;color:#71717a;">Automated notification from BAMYS Marketplace. Do not reply.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export type ExecuteCheckoutParams = {
  cartOwnerUserId: string;
  buyerCustomerName: string;
  buyerNotificationEmail: string;
  idempotencyKey: string;
  releaseIdempotencyLockIfHeld: () => Promise<void>;
};

/**
 * Shared ERPNext Sales Order + cart update + emails (same behavior as checkout POST body).
 * Caller must hold idempotency lock (STARTED) before invoking.
 */
export async function executeMarketplaceCheckoutOrder(
  params: ExecuteCheckoutParams
): Promise<NextResponse> {
  const {
    cartOwnerUserId,
    buyerCustomerName,
    buyerNotificationEmail,
    idempotencyKey,
    releaseIdempotencyLockIfHeld,
  } = params;

  if (!process.env.OFFER_TOKEN_SECRET) {
    await releaseIdempotencyLockIfHeld();
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 500 }
    );
  }
  const secretBuf = Buffer.from(process.env.OFFER_TOKEN_SECRET, "base64");
  if (secretBuf.length !== 32) {
    await releaseIdempotencyLockIfHeld();
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 500 }
    );
  }
  const secret = new Uint8Array(secretBuf);

  const env = readErpnextEnv();
  if ("error" in env) {
    await releaseIdempotencyLockIfHeld();
    return NextResponse.json({ error: env.error }, { status: 500 });
  }

  const cartRows = await prisma.cartItem.findMany({
    where: {
      userId: cartOwnerUserId,
      orderId: null,
    },
  });

  if (cartRows.length === 0) {
    await releaseIdempotencyLockIfHeld();
    return NextResponse.json(
      { error: "Your cart is empty." },
      { status: 400 }
    );
  }

  const resolvedLines: ResolvedLine[] = [];

  for (const row of cartRows) {
    let payload: Record<string, unknown>;
    try {
      const { payload: p } = await jwtDecrypt(row.offerToken, secret);
      payload = p as Record<string, unknown>;
    } catch {
      await releaseIdempotencyLockIfHeld();
      return NextResponse.json(
        {
          error:
            "One or more items have expired prices. Please refresh your cart.",
        },
        { status: 400 }
      );
    }

    const itemCode =
      typeof payload.itemCode === "string" ? payload.itemCode.trim() : "";
    const priceRaw = payload.price;
    const rate =
      typeof priceRaw === "number"
        ? priceRaw
        : typeof priceRaw === "string"
          ? Number.parseFloat(priceRaw)
          : NaN;

    if (!itemCode || Number.isNaN(rate)) {
      await releaseIdempotencyLockIfHeld();
      return NextResponse.json(
        {
          error:
            "One or more items have expired prices. Please refresh your cart.",
        },
        { status: 400 }
      );
    }

    const supplierId = await fetchItemPriceSupplier(env, itemCode);
    if (!supplierId) {
      await releaseIdempotencyLockIfHeld();
      return NextResponse.json(
        {
          error:
            "Availability error for one or more items. Please refresh your cart and try again.",
        },
        { status: 400 }
      );
    }

    const warehouse = await fetchSupplierWarehouse(env, supplierId);
    if (!warehouse) {
      await releaseIdempotencyLockIfHeld();
      return NextResponse.json(
        {
          error:
            "Availability error for one or more items. Please refresh your cart or contact support.",
        },
        { status: 400 }
      );
    }

    resolvedLines.push({
      cartItemId: row.id,
      itemCode,
      qty: row.quantity,
      rate,
      uom: row.uom,
      supplierId,
      warehouse,
    });
  }

  const bySupplier = new Map<
    string,
    { warehouse: string; lines: ResolvedLine[] }
  >();

  for (const line of resolvedLines) {
    const existing = bySupplier.get(line.supplierId);
    if (existing) {
      if (existing.warehouse !== line.warehouse) {
        await releaseIdempotencyLockIfHeld();
        return NextResponse.json(
          {
            error:
              "Inconsistent warehouse for the same supplier. Contact support.",
          },
          { status: 400 }
        );
      }
      existing.lines.push(line);
    } else {
      bySupplier.set(line.supplierId, {
        warehouse: line.warehouse,
        lines: [line],
      });
    }
  }

  const supplierIds = [...bySupplier.keys()].sort();
  const createdOrders: string[] = [];
  const createdGrandTotals: (number | null)[] = [];

  const transactionDate = new Date().toISOString().slice(0, 10);
  const companyOptional = process.env.ERPNEXT_COMPANY?.trim();

  for (const supplierId of supplierIds) {
    const group = bySupplier.get(supplierId)!;
    const salesOrderPayload: Record<string, unknown> = {
      customer: buyerCustomerName,
      docstatus: 0,
      transaction_date: transactionDate,
      delivery_date: transactionDate,
      items: group.lines.map((l) => ({
        item_code: l.itemCode,
        qty: l.qty,
        rate: l.rate,
        warehouse: group.warehouse,
        uom: l.uom,
        delivery_date: transactionDate,
      })),
    };
    if (companyOptional) {
      salesOrderPayload.company = companyOptional;
    }

    const soRes = await erpnextFetch(env, "/api/resource/Sales Order", {
      method: "POST",
      body: JSON.stringify(salesOrderPayload),
      cache: "no-store",
    });
    const soJson = await soRes.json().catch(() => ({}));
    const orderName = parseSalesOrderNameFromResponse(soJson);

    if (!soRes.ok || !orderName) {
      console.error(
        "[checkout/execute] Sales Order create failed:",
        soRes.status,
        JSON.stringify(soJson).slice(0, 800)
      );
      await rollbackSalesOrders(env, createdOrders);
      await releaseIdempotencyLockIfHeld();
      return NextResponse.json(
        {
          error:
            "Order creation failed. All partial orders have been rolled back.",
        },
        { status: 500 }
      );
    }

    createdOrders.push(orderName);
    createdGrandTotals.push(parseGrandTotalFromSalesOrderResponse(soJson));

    // TODO: Resolve supplier email from supplierId
    // for supplier notification
    // For now only notify the buyer
    await createNotification(
      buyerNotificationEmail,
      "Order Placed Successfully",
      `Your order ${orderName} has been submitted to the supplier for confirmation.`,
      NotificationType.ORDER_UPDATE,
      "/dashboard/procurement/orders"
    );
  }

  try {
    for (let i = 0; i < supplierIds.length; i++) {
      const supplierId = supplierIds[i];
      const orderName = createdOrders[i];
      const group = bySupplier.get(supplierId)!;
      const ids = group.lines.map((l) => l.cartItemId);
      await prisma.cartItem.updateMany({
        where: {
          id: { in: ids },
          userId: cartOwnerUserId,
          orderId: null,
        },
        data: {
          orderId: orderName,
          orderStatus: "ordered",
        },
      });
    }
  } catch (e) {
    console.error(
      "[checkout/execute] Prisma cart update failed after all Sales Orders created:",
      e
    );
    await rollbackSalesOrders(env, createdOrders);
    await releaseIdempotencyLockIfHeld();
    return NextResponse.json(
      {
        error:
          "Order creation failed. All partial orders have been rolled back.",
      },
      { status: 500 }
    );
  }

  await prisma.idempotencyRecord.update({
    where: { key: idempotencyKey },
    data: {
      response: JSON.stringify({ ok: true, orders: createdOrders }),
    },
  });

  const apiKey = process.env.RESEND_API_KEY;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");

  if (!apiKey) {
    console.error(
      "[checkout/execute] RESEND_API_KEY is not set; skipping notification emails."
    );
  } else if (!baseUrl) {
    console.error(
      "[checkout/execute] NEXT_PUBLIC_APP_URL is not set; skipping notification emails."
    );
  } else {
    const resend = new Resend(apiKey);
    const supplierOrdersUrl = `${baseUrl}/dashboard/sales/orders`;
    const procurementOrdersUrl = `${baseUrl}/dashboard/procurement/orders`;

    for (let i = 0; i < supplierIds.length; i++) {
      const supplierId = supplierIds[i]!;
      const orderName = createdOrders[i]!;
      const grandTotal = createdGrandTotals[i] ?? null;
      try {
        const { email: supplierEmail } = await fetchSupplierEmailAndName(
          env,
          supplierId
        );
        if (!supplierEmail) {
          console.error(
            "[checkout/execute] No supplier email on file; skipping supplier notification."
          );
          continue;
        }
        const to = resolveEmailRecipient(supplierEmail);
        const { error } = await resend.emails.send({
          from: "noreply@qevira.michaelalene.com",
          to,
          subject: `New Order [${orderName}] - Action Required`,
          html: buildSupplierOrderEmailHtml({
            orderName,
            grandTotalFormatted: formatEtbAmount(grandTotal),
            ctaUrl: supplierOrdersUrl,
          }),
        });
        if (error) {
          console.error(
            "[checkout/execute] Resend supplier notification error:",
            error
          );
        }
      } catch (e) {
        console.error("[checkout/execute] Supplier notification failed:", e);
      }
    }

    try {
      const to = resolveEmailRecipient(buyerNotificationEmail);
      const orderIdsHtml = createdOrders
        .map((id) => `<li>${escapeHtml(id)}</li>`)
        .join("");
      const { error } = await resend.emails.send({
        from: "noreply@qevira.michaelalene.com",
        to,
        subject: "Order Confirmed - BAMYS Marketplace",
        html: buildBuyerOrderConfirmationEmailHtml({
          orderIdsHtml,
          ctaUrl: procurementOrdersUrl,
        }),
      });
      if (error) {
        console.error(
          "[checkout/execute] Resend buyer confirmation error:",
          error
        );
      }
    } catch (e) {
      console.error("[checkout/execute] Buyer confirmation failed:", e);
    }
  }

  return NextResponse.json({ ok: true, orders: createdOrders }, { status: 200 });
}
