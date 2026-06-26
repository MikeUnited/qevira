import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

import { registrationOtpIdentifier } from "@/lib/registration-otp-identifier";

export async function verifyRegistrationJwtFromBody(body: {
  verifiedToken?: unknown;
  registerMode?: unknown;
  email?: unknown;
  phone?: unknown;
}): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const token =
    typeof body.verifiedToken === "string" ? body.verifiedToken.trim() : "";
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Verification required." },
        { status: 400 }
      ),
    };
  }

  const secretRaw = process.env.RESET_TOKEN_SECRET;
  if (!secretRaw) {
    console.error("[registration-verify] RESET_TOKEN_SECRET is not set.");
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Registration verification is not configured." },
        { status: 500 }
      ),
    };
  }
  const secret = new TextEncoder().encode(secretRaw);

  const registerMode = body.registerMode === "phone" ? "phone" : "email";
  const email = typeof body.email === "string" ? body.email : "";
  const phone = typeof body.phone === "string" ? body.phone : "";
  const expected = registrationOtpIdentifier(registerMode, email, phone);
  if (!expected) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid contact for verification." },
        { status: 400 }
      ),
    };
  }

  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      audience: "bamys-registration",
    });
    if (payload.verified !== true) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Invalid verification token." },
          { status: 400 }
        ),
      };
    }
    const claim = payload.email;
    if (typeof claim !== "string" || claim !== expected) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Invalid verification token." },
          { status: 400 }
        ),
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or expired verification token." },
        { status: 400 }
      ),
    };
  }
}
