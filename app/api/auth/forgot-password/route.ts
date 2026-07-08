// Rate limiting migrated to Redis for persistence
// across server restarts and multi-instance deployments

import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { Resend } from "resend";

import { getClientIp } from "@/lib/client-ip";
import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import {
  getRateLimitCount,
  incrementRateLimitWithWindow,
} from "@/lib/rate-limit";

const GENERIC_OK = {
  ok: true,
  message:
    "If this email is registered, you will receive a reset link shortly.",
} as const;

const RATE_LIMIT_MSG = "Too many reset attempts. Please try again later.";

const FORGOT_WINDOW_SEC = 60 * 60;
const MAX_FORGOT_EMAIL = 3;
const MAX_FORGOT_IP = 10;

async function userExistsInErpnext(email: string): Promise<boolean> {
  const env = readErpnextEnv();
  if ("error" in env) {
    return false;
  }
  const res = await erpnextFetch(
    env,
    `/api/resource/User/${encodeURIComponent(email)}`,
    { cache: "no-store" }
  );
  return res.ok;
}

export async function POST(req: NextRequest) {
  let emailRaw = "";
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: unknown;
    };
    emailRaw =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    return NextResponse.json(GENERIC_OK, { status: 200 });
  }

  if (!emailRaw) {
    return NextResponse.json(GENERIC_OK, { status: 200 });
  }

  const emailKey = emailRaw;
  const ip = getClientIp(req);

  const ipKey = `ratelimit:forgot:ip:${ip}`;
  const emailKeyFull = `ratelimit:forgot:email:${emailKey}`;

  if ((await getRateLimitCount(ipKey)) >= MAX_FORGOT_IP) {
    return NextResponse.json({ error: RATE_LIMIT_MSG }, { status: 429 });
  }

  await incrementRateLimitWithWindow(ipKey, FORGOT_WINDOW_SEC);

  if ((await getRateLimitCount(emailKeyFull)) >= MAX_FORGOT_EMAIL) {
    return NextResponse.json({ error: RATE_LIMIT_MSG }, { status: 429 });
  }

  await incrementRateLimitWithWindow(emailKeyFull, FORGOT_WINDOW_SEC);

  try {
    const exists = await userExistsInErpnext(emailRaw);
    if (!exists) {
      return NextResponse.json(GENERIC_OK, { status: 200 });
    }

    const secretRaw = process.env.RESET_TOKEN_SECRET;
    if (!secretRaw) {
      console.error("[forgot-password] RESET_TOKEN_SECRET is not set.");
      return NextResponse.json(GENERIC_OK, { status: 200 });
    }
    const secret = new TextEncoder().encode(secretRaw);

    const token = await new SignJWT({ email: emailRaw })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("15m")
      .sign(secret);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
    if (!baseUrl) {
      console.error("[forgot-password] NEXT_PUBLIC_APP_URL is not set.");
      return NextResponse.json(GENERIC_OK, { status: 200 });
    }

    const resetLink = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("[forgot-password] RESEND_API_KEY is not set.");
      return NextResponse.json(GENERIC_OK, { status: 200 });
    }

    if (
      process.env.NODE_ENV === "development" &&
      process.env.DEV_EMAIL_OVERRIDE
    ) {
      console.log(
        `[DEV] Password reset email for ${emailRaw} redirected to ${process.env.DEV_EMAIL_OVERRIDE}`
      );
    }

    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: "noreply@qevira.michaelalene.com",
      to:
        process.env.NODE_ENV === "development" && process.env.DEV_EMAIL_OVERRIDE
          ? process.env.DEV_EMAIL_OVERRIDE
          : emailRaw,
      subject: "Reset your Qevira password",
      html: `
<!DOCTYPE html>
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
                Qevira
              </td>
            </tr>
            <tr>
              <td style="padding:24px;color:#18181b;font-size:15px;line-height:1.6;">
                <p style="margin:0 0 16px;">You requested a password reset for your Qevira account.</p>
                <p style="margin:0 0 20px;">
                  <a href="${resetLink}" style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;">Reset password</a>
                </p>
                <p style="margin:0 0 12px;font-size:13px;color:#71717a;">Or copy this link:</p>
                <p style="margin:0 0 20px;font-size:12px;word-break:break-all;color:#52525b;">${resetLink}</p>
                <p style="margin:0 0 8px;font-size:13px;color:#52525b;">This link expires in 15 minutes.</p>
                <p style="margin:0;font-size:13px;color:#52525b;">If you did not request this, ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    });

    if (error) {
      console.error("[forgot-password] Resend error:", error);
    }
  } catch (e) {
    console.error("[forgot-password] Unexpected error:", e);
  }

  return NextResponse.json(GENERIC_OK, { status: 200 });
}
