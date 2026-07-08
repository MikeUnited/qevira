// Rate limiting migrated to Redis for persistence
// across server restarts and multi-instance deployments

import { randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

import redis from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { registrationOtpIdentifier } from "@/lib/registration-otp-identifier";
import { checkRateLimit } from "@/lib/rate-limit";

const CODE_TTL_MS = 10 * 60 * 1000;

const OTP_EMAIL_WINDOW_SEC = 600;
const MAX_OTP_EMAIL_PER_WINDOW = 3;

const COOLDOWN_KEY_SEC = 60;

function buildOtpEmailHtml(code: string): string {
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
                Qevira
              </td>
            </tr>
            <tr>
              <td style="padding:24px;color:#18181b;font-size:15px;line-height:1.6;">
                <p style="margin:0 0 16px;">Your verification code is:</p>
                <p style="margin:0 0 20px;font-size:28px;font-weight:700;letter-spacing:0.15em;color:#18181b;">
                  ${code}
                </p>
                <p style="margin:0 0 12px;font-size:13px;color:#71717a;">
                  This code expires in <strong>10 minutes</strong>. Do not share it with anyone.
                </p>
                <p style="margin:0;font-size:13px;color:#52525b;">If you did not request this, you can ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function POST(req: NextRequest) {
  let registerMode: "email" | "phone" = "email";
  let email = "";
  let phone = "";
  try {
    const body = (await req.json().catch(() => ({}))) as {
      registerMode?: unknown;
      email?: unknown;
      phone?: unknown;
    };
    registerMode = body.registerMode === "phone" ? "phone" : "email";
    email = typeof body.email === "string" ? body.email : "";
    phone = typeof body.phone === "string" ? body.phone : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const identifier = registrationOtpIdentifier(registerMode, email, phone);
  if (!identifier) {
    return NextResponse.json(
      {
        error:
          registerMode === "email"
            ? "A valid email is required."
            : "A valid phone number is required.",
      },
      { status: 400 }
    );
  }

  const cooldownKey = `ratelimit:otp:cooldown:${identifier}`;
  if (await redis.exists(cooldownKey)) {
    return NextResponse.json(
      { error: "Please wait before requesting another code." },
      { status: 429 }
    );
  }

  const emailLimit = await checkRateLimit(
    `ratelimit:otp:email:${identifier}`,
    MAX_OTP_EMAIL_PER_WINDOW,
    OTP_EMAIL_WINDOW_SEC
  );
  if (!emailLimit.allowed) {
    return NextResponse.json(
      { error: "Too many verification requests. Please try again later." },
      { status: 429 }
    );
  }

  const code = String(randomInt(100_000, 1_000_000));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);

  await prisma.verificationCode.upsert({
    where: { email: identifier },
    create: {
      email: identifier,
      code,
      lastSentAt: now,
      expiresAt,
      attempts: 0,
    },
    update: {
      code,
      lastSentAt: now,
      expiresAt,
      attempts: 0,
    },
  });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[otp/request] RESEND_API_KEY is not set.");
    return NextResponse.json(
      { error: "Email delivery is not configured." },
      { status: 500 }
    );
  }

  const devOverride =
    process.env.NODE_ENV === "development" && process.env.DEV_EMAIL_OVERRIDE;
  const toAddress = devOverride
    ? process.env.DEV_EMAIL_OVERRIDE!
    : registerMode === "email"
      ? identifier
      : null;

  if (!toAddress) {
    console.error(
      "[otp/request] No recipient: use email registration or set DEV_EMAIL_OVERRIDE for phone testing."
    );
    return NextResponse.json(
      {
        error:
          "Verification delivery is not configured for this sign-up method.",
      },
      { status: 500 }
    );
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: "noreply@qevira.michaelalene.com",
    to: toAddress!,
    subject: "Your Qevira verification code",
    html: buildOtpEmailHtml(code),
  });

  if (error) {
    console.error("[otp/request] Resend error:", error);
    return NextResponse.json(
      { error: "Could not send verification email." },
      { status: 502 }
    );
  }

  await redis.set(cooldownKey, "1", "EX", COOLDOWN_KEY_SEC);

  return NextResponse.json({ ok: true }, { status: 200 });
}
