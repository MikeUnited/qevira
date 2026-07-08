import { NextResponse } from "next/server";
import { errors, jwtVerify } from "jose";

import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { tryExtractFrappeMessage } from "@/lib/frappe-user-message";

function extractError(data: unknown): string {
  if (!data || typeof data !== "object") return "Could not update password.";
  const fromTry = tryExtractFrappeMessage(data);
  if (fromTry) return fromTry;
  const o = data as Record<string, unknown>;
  if (typeof o.exception === "string" && o.exception.trim()) {
    return o.exception.trim().slice(0, 500);
  }
  return "Could not update password.";
}

export async function POST(req: Request) {
  let token = "";
  let newPassword = "";
  try {
    const body = (await req.json().catch(() => ({}))) as {
      token?: unknown;
      newPassword?: unknown;
    };
    token = typeof body.token === "string" ? body.token.trim() : "";
    newPassword =
      typeof body.newPassword === "string" ? body.newPassword : "";
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired reset link." },
      { status: 400 }
    );
  }

  if (!token) {
    return NextResponse.json(
      { error: "Invalid or expired reset link." },
      { status: 400 }
    );
  }

  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const secretRaw = process.env.RESET_TOKEN_SECRET;
  if (!secretRaw) {
    console.error("[reset-password] RESET_TOKEN_SECRET is not set.");
    return NextResponse.json(
      { error: "Password reset is not configured." },
      { status: 500 }
    );
  }
  const secret = new TextEncoder().encode(secretRaw);

  let email: string;
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    const emailRaw = payload.email;
    email =
      typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
    if (!email) {
      return NextResponse.json(
        { error: "Invalid or expired reset link." },
        { status: 400 }
      );
    }
  } catch (e) {
    if (e instanceof errors.JWTExpired) {
      return NextResponse.json(
        {
          error:
            "This reset link has expired. Please request a new one from Forgot password.",
        },
        { status: 400 }
      );
    }
    if (e instanceof errors.JWSSignatureVerificationFailed) {
      console.error(
        "[reset-password] JWT signature invalid — often RESET_TOKEN_SECRET differs from the server that sent the email (e.g. prod link on local dev)."
      );
      return NextResponse.json(
        {
          error:
            "This reset link is not valid on this server. Request a new link from Forgot password on this site, or use the same RESET_TOKEN_SECRET as the environment that sent the email.",
        },
        { status: 400 }
      );
    }
    console.error(
      "[reset-password] JWT verify failed:",
      e instanceof Error ? e.message : e
    );
    return NextResponse.json(
      { error: "Invalid or expired reset link." },
      { status: 400 }
    );
  }

  const env = readErpnextEnv();
  if ("error" in env) {
    return NextResponse.json({ error: env.error }, { status: 500 });
  }

  const putRes = await erpnextFetch(
    env,
    `/api/resource/User/${encodeURIComponent(email)}`,
    {
      method: "PUT",
      body: JSON.stringify({ new_password: newPassword }),
      cache: "no-store",
    }
  );
  const putJson = await putRes.json().catch(() => ({}));

  if (!putRes.ok) {
    console.error(
      "[reset-password] ERPNext User update failed:",
      putRes.status,
      JSON.stringify(putJson).slice(0, 800)
    );
    const frappeMsg = extractError(putJson);
    if (putRes.status === 403) {
      return NextResponse.json(
        {
          error:
            frappeMsg ||
            "ERPNext refused to update this user. The API key user needs permission to write User (e.g. System Manager).",
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: frappeMsg },
      { status: putRes.status >= 500 ? 502 : 400 }
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
