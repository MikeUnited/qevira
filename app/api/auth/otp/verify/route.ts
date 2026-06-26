import { NextResponse } from "next/server";
import { SignJWT } from "jose";

import { prisma } from "@/lib/prisma";
import { registrationOtpIdentifier } from "@/lib/registration-otp-identifier";

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  let registerMode: "email" | "phone" = "email";
  let email = "";
  let phone = "";
  let otpCode = "";
  try {
    const body = (await req.json().catch(() => ({}))) as {
      registerMode?: unknown;
      email?: unknown;
      phone?: unknown;
      otpCode?: unknown;
    };
    registerMode = body.registerMode === "phone" ? "phone" : "email";
    email = typeof body.email === "string" ? body.email : "";
    phone = typeof body.phone === "string" ? body.phone : "";
    otpCode =
      typeof body.otpCode === "string" ? body.otpCode.replace(/\s/g, "") : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const identifier = registrationOtpIdentifier(registerMode, email, phone);
  if (!identifier || otpCode.length !== 6 || !/^\d{6}$/.test(otpCode)) {
    return NextResponse.json(
      { error: "Invalid email or verification code." },
      { status: 400 }
    );
  }

  const secretRaw = process.env.RESET_TOKEN_SECRET;
  if (!secretRaw) {
    console.error("[otp/verify] RESET_TOKEN_SECRET is not set.");
    return NextResponse.json(
      { error: "Verification is not configured." },
      { status: 500 }
    );
  }
  const secret = new TextEncoder().encode(secretRaw);

  const row = await prisma.verificationCode.findUnique({
    where: { email: identifier },
  });

  if (!row) {
    return NextResponse.json(
      { error: "Invalid or expired verification code." },
      { status: 400 }
    );
  }

  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.verificationCode.delete({ where: { id: row.id } }).catch(() => {});
    return NextResponse.json(
      { error: "Invalid or expired verification code." },
      { status: 400 }
    );
  }

  if (row.code !== otpCode) {
    const updated = await prisma.verificationCode.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    if (updated.attempts >= MAX_ATTEMPTS) {
      await prisma.verificationCode
        .delete({ where: { id: row.id } })
        .catch(() => {});
      return NextResponse.json(
        { error: "Too many incorrect attempts." },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Invalid verification code." },
      { status: 400 }
    );
  }

  await prisma.verificationCode.delete({ where: { id: row.id } });

  const verifiedToken = await new SignJWT({
    email: identifier,
    verified: true,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("bamys-registration")
    .setExpirationTime("15m")
    .sign(secret);

  return NextResponse.json({ ok: true, verifiedToken }, { status: 200 });
}
