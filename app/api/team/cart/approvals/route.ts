import { NextRequest, NextResponse } from "next/server";
import { NotificationType, Prisma } from "@prisma/client";
import { Resend } from "resend";

import { executeMarketplaceCheckoutOrder } from "@/lib/marketplace-checkout-execute";
import { createNotification } from "@/lib/notifications-service";
import { getBuyerContextForEmail } from "@/lib/get-buyer-profile";
import { prisma } from "@/lib/prisma";
import { getSessionPayload } from "@/lib/session";

function resolveEmailRecipient(realEmail: string): string {
  return process.env.NODE_ENV === "development" &&
    process.env.DEV_EMAIL_OVERRIDE
    ? process.env.DEV_EMAIL_OVERRIDE
    : realEmail;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildRejectionEmailHtml(opts: {
  notes?: string | null;
}): string {
  const notesBlock =
    opts.notes?.trim() ?
      `<p style="margin:16px 0 0;color:#3f3f46;font-size:14px;"><strong>Note:</strong> ${escapeHtml(opts.notes.trim())}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;">
            <tr>
              <td style="padding:24px;color:#18181b;font-size:15px;line-height:1.6;">
                <p style="margin:0 0 12px;font-weight:600;">Cart approval request not approved</p>
                <p style="margin:0;">Your procurement request was reviewed and rejected.</p>
                ${notesBlock}
                <p style="margin:20px 0 0;font-size:12px;color:#71717a;">Qevira Marketplace automated notification</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildApprovalEmailHtml(opts: { ordersUrl: string }): string {
  const { ordersUrl } = opts;
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;">
            <tr>
              <td style="padding:24px;color:#18181b;font-size:15px;line-height:1.6;">
                <p style="margin:0 0 12px;font-weight:600;">Your cart has been approved</p>
                <p style="margin:0 0 20px;">Your procurement request has been approved and the order has been placed.</p>
                <p style="margin:0;">
                  <a href="${escapeHtml(ordersUrl)}" style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;">View orders</a>
                </p>
                <p style="margin:20px 0 0;font-size:12px;color:#71717a;">Qevira Marketplace automated notification</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function GET() {
  const session = await getSessionPayload();
  if (!session?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.teamRole === "PHARMACIST") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const organizationId = session.organizationId?.trim();
  if (!organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requests = await prisma.cartApprovalRequest.findMany({
    where: { organizationId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });

  const out = await Promise.all(
    requests.map(async (req) => {
      const cartItems = await prisma.cartItem.findMany({
        where: {
          userId: req.requestedBy,
          orderId: null,
        },
      });
      return {
        id: req.id,
        requestedBy: req.requestedBy,
        createdAt: req.createdAt.toISOString(),
        status: req.status,
        cartItems: cartItems.map((c) => ({
          genericName: c.genericName,
          vendorAlias: c.vendorAlias,
          quantity: c.quantity,
          price: c.price,
          uom: c.uom,
        })),
      };
    })
  );

  return NextResponse.json({ requests: out });
}

export async function PUT(request: NextRequest) {
  const session = await getSessionPayload();
  if (!session?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.teamRole !== "DIRECTOR" && session.teamRole !== "OWNER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const organizationId = session.organizationId?.trim();
  if (!organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const directorEmail = session.email.trim();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const requestId =
    body &&
    typeof body === "object" &&
    "requestId" in body &&
    typeof (body as { requestId?: unknown }).requestId === "string"
      ? (body as { requestId: string }).requestId.trim()
      : "";
  const action =
    body &&
    typeof body === "object" &&
    "action" in body &&
    ((body as { action?: unknown }).action === "APPROVE" ||
      (body as { action?: unknown }).action === "REJECT")
      ? (body as { action: "APPROVE" | "REJECT" }).action
      : null;

  const notesRaw =
    body &&
    typeof body === "object" &&
    "notes" in body &&
    typeof (body as { notes?: unknown }).notes === "string"
      ? (body as { notes: string }).notes
      : undefined;

  if (!requestId || !action) {
    return NextResponse.json(
      { error: "Missing requestId or action." },
      { status: 400 }
    );
  }

  const row = await prisma.cartApprovalRequest.findFirst({
    where: { id: requestId, organizationId },
  });

  if (!row || row.status !== "PENDING") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const pharmacistEmail = row.requestedBy.trim();

  if (action === "REJECT") {
    await prisma.cartApprovalRequest.update({
      where: { id: row.id },
      data: {
        status: "REJECTED",
        reviewedBy: directorEmail,
        reviewedAt: new Date(),
        notes: notesRaw?.trim() || null,
      },
    });

    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      const resend = new Resend(apiKey);
      const to = resolveEmailRecipient(pharmacistEmail);
      try {
        const { error } = await resend.emails.send({
          from: "noreply@qevira.michaelalene.com",
          to,
          subject: "Cart approval request — Qevira Marketplace",
          html: buildRejectionEmailHtml({ notes: notesRaw }),
        });
        if (error) {
          console.error("[team/cart/approvals] Resend rejection email:", error);
        }
      } catch (e) {
        console.error("[team/cart/approvals] Rejection email failed:", e);
      }
    }

    return NextResponse.json({ ok: true });
  }

  const buyerCtx = await getBuyerContextForEmail(pharmacistEmail);
  if (!buyerCtx) {
    return NextResponse.json(
      {
        error:
          "Could not resolve buyer account for this request. The pharmacist may need to complete registration.",
      },
      { status: 400 }
    );
  }

  const idempotencyKey = crypto.randomUUID();
  let idempotencyLockHeld = false;
  const releaseIdempotencyLockIfHeld = async () => {
    if (!idempotencyLockHeld) return;
    try {
      await prisma.idempotencyRecord.delete({ where: { key: idempotencyKey } });
    } catch {
      // ignore
    }
  };

  try {
    await prisma.idempotencyRecord.create({
      data: {
        key: idempotencyKey,
        userId: directorEmail,
        response: "STARTED",
      },
    });
    idempotencyLockHeld = true;
  } catch (e) {
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
    ) {
      return NextResponse.json(
        { error: "Idempotency check failed." },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: "Duplicate request. Please retry." },
      { status: 409 }
    );
  }

  const execResponse = await executeMarketplaceCheckoutOrder({
    cartOwnerUserId: pharmacistEmail,
    buyerCustomerName: buyerCtx.customerId,
    buyerNotificationEmail: pharmacistEmail,
    idempotencyKey,
    releaseIdempotencyLockIfHeld,
  });

  const execJson = (await execResponse.json()) as {
    ok?: unknown;
    error?: unknown;
    orders?: unknown;
  };

  if (execResponse.status !== 200 || execJson.ok !== true) {
    const msg =
      typeof execJson.error === "string" && execJson.error.trim()
        ? execJson.error.trim()
        : "Order could not be placed.";
    return NextResponse.json({ error: msg }, { status: execResponse.status });
  }

  const createdOrderIds = Array.isArray(execJson.orders)
    ? execJson.orders.filter((x): x is string => typeof x === "string")
    : [];

  await prisma.cartApprovalRequest.update({
    where: { id: row.id },
    data: {
      status: "APPROVED",
      reviewedBy: directorEmail,
      reviewedAt: new Date(),
      notes: notesRaw?.trim() || null,
    },
  });

  const apiKey = process.env.RESEND_API_KEY;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (apiKey && baseUrl) {
    const resend = new Resend(apiKey);
    const ordersUrl = `${baseUrl}/dashboard/procurement/orders`;
    const to = resolveEmailRecipient(pharmacistEmail);
    try {
      const { error } = await resend.emails.send({
        from: "noreply@qevira.michaelalene.com",
        to,
        subject: "Your cart has been approved - Qevira",
        html: buildApprovalEmailHtml({ ordersUrl }),
      });
      if (error) {
        console.error("[team/cart/approvals] Resend approval email:", error);
      }
    } catch (e) {
      console.error("[team/cart/approvals] Approval email failed:", e);
    }
  }

  await createNotification(
    pharmacistEmail,
    "Cart Approved",
    "Your cart has been approved and the order has been placed on your behalf.",
    NotificationType.ORDER_UPDATE,
    "/dashboard/procurement/orders"
  );

  return NextResponse.json({ ok: true, orders: createdOrderIds });
}
