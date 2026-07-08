import { NotificationType } from "@prisma/client";
import { NextResponse } from "next/server";
import { Resend } from "resend";

import { createNotification } from "@/lib/notifications-service";
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

function buildDirectorNotificationHtml(opts: {
  requestedBy: string;
  reviewUrl: string;
}): string {
  const { requestedBy, reviewUrl } = opts;
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
            <tr>
              <td style="padding:24px 24px 8px;color:#18181b;font-size:20px;font-weight:700;">Approval Required</td>
            </tr>
            <tr>
              <td style="padding:8px 24px 24px;color:#3f3f46;font-size:15px;line-height:1.6;">
                <p style="margin:0 0 16px;">${escapeHtml(requestedBy)} has submitted a cart for your review and approval.</p>
                <p style="margin:0 0 20px;">Please log in to review the cart and place the order on their behalf.</p>
                <p style="margin:0;">
                  <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;">Review Cart</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;background:#fafafa;border-top:1px solid #e4e4e7;color:#71717a;font-size:12px;">Qevira Marketplace automated notification</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function POST() {
  const session = await getSessionPayload();
  if (!session?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.teamRole !== "PHARMACIST") {
    return NextResponse.json(
      { error: "Only pharmacists can submit approval requests." },
      { status: 403 }
    );
  }

  const organizationId = session.organizationId?.trim();
  if (!organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sessionEmail = session.email.trim();

  const existing = await prisma.cartApprovalRequest.findFirst({
    where: {
      requestedBy: sessionEmail,
      organizationId,
      status: "PENDING",
    },
  });

  if (existing) {
    return NextResponse.json(
      {
        error:
          "You already have a pending approval request. Please wait for a Director to review it.",
      },
      { status: 409 }
    );
  }

  await prisma.cartApprovalRequest.create({
    data: {
      requestedBy: sessionEmail,
      organizationId,
      status: "PENDING",
    },
  });

  const directors = await prisma.teamMember.findMany({
    where: {
      organizationId,
      role: { in: ["DIRECTOR", "OWNER"] },
      status: "ACCEPTED",
    },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.RESEND_API_KEY;

  if (apiKey && baseUrl) {
    const resend = new Resend(apiKey);
    const reviewUrl = `${baseUrl}/dashboard/procurement/approvals`;
    const html = buildDirectorNotificationHtml({
      requestedBy: sessionEmail,
      reviewUrl,
    });

    for (const d of directors) {
      const to = resolveEmailRecipient(d.email.trim());
      try {
        const { error } = await resend.emails.send({
          from: "noreply@qevira.michaelalene.com",
          to,
          subject: "Cart Approval Required - Qevira Marketplace",
          html,
        });
        if (error) {
          console.error(
            "[team/cart/request-approval] Resend error:",
            error
          );
        }
      } catch (e) {
        console.error("[team/cart/request-approval] Resend failed:", e);
      }
    }
  } else {
    console.error(
      "[team/cart/request-approval] RESEND_API_KEY or NEXT_PUBLIC_APP_URL missing; skipping emails."
    );
  }

  for (const d of directors) {
    await createNotification(
      d.email.trim(),
      "Cart Approval Required",
      `${sessionEmail} has submitted a cart for your approval.`,
      NotificationType.APPROVAL_REQUEST,
      "/dashboard/procurement/approvals"
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Approval request sent to your organization's directors.",
  });
}
