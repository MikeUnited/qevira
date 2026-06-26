import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { extractFrappeMessage } from "@/lib/register-kyc";
import { verifyRegistrationJwtFromBody } from "@/lib/registration-verify-token";
import { createSession } from "@/lib/session";

const PLACEHOLDER_FIRST = "Pending";
const PLACEHOLDER_MIDDLE = "-";
const PLACEHOLDER_LAST = "Registration";
const PLACEHOLDER_DOB = "1900-01-01";

type InitBody = {
  /** When true, only password + one contact (email or phone) are required; profile is completed later. */
  minimal?: boolean;
  registerMode?: "email" | "phone";
  email?: string;
  phone?: string;
  password?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  dob?: string;
  /** JWT from POST /api/auth/otp/verify (aud: bamys-registration). */
  verifiedToken?: string;
};

export async function POST(req: NextRequest) {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const body = raw as InitBody;
    const gate = await verifyRegistrationJwtFromBody(body);
    if (!gate.ok) return gate.response;

    const env = readErpnextEnv();
    if ("error" in env) {
      return NextResponse.json({ error: env.error }, { status: 500 });
    }

    const password = String(body.password ?? "");

    if (body.minimal === true) {
      const registerMode = body.registerMode === "phone" ? "phone" : "email";

      if (password.length < 8) {
        return NextResponse.json(
          { error: "Password must be at least 8 characters." },
          { status: 400 }
        );
      }

      let email: string;
      let mobile_no: string | undefined;

      if (registerMode === "email") {
        email = String(body.email ?? "").trim();
        if (!email || !email.includes("@")) {
          return NextResponse.json(
            { error: "A valid email is required." },
            { status: 400 }
          );
        }
        mobile_no = undefined;
      } else {
        const phone = String(body.phone ?? "").trim();
        if (phone.length < 6) {
          return NextResponse.json(
            { error: "A valid phone number is required." },
            { status: 400 }
          );
        }
        mobile_no = phone;
        email = `reg-${randomUUID()}@register.bamys.local`;
      }

      const payload = {
        email,
        first_name: PLACEHOLDER_FIRST,
        middle_name: PLACEHOLDER_MIDDLE,
        last_name: PLACEHOLDER_LAST,
        birth_date: PLACEHOLDER_DOB,
        ...(mobile_no !== undefined ? { mobile_no } : {}),
        new_password: password,
        send_welcome_email: 0,
      };

      const erpResponse = await erpnextFetch(env, "/api/resource/User", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const text = await erpResponse.text();
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }

      if (!erpResponse.ok) {
        const frappeMsg = extractFrappeMessage(data);
        let friendly = frappeMsg ?? `ERPNext returned ${erpResponse.status}`;

        if (erpResponse.status === 401) {
          friendly =
            "ERPNext rejected credentials (401). Check ERPNEXT_API_KEY, ERPNEXT_API_SECRET, ERPNEXT_SITE_NAME, and ERPNEXT_URL.";
          console.error("[api/register/init] ERPNext 401");
        } else if (erpResponse.status === 409) {
          friendly =
            frappeMsg ??
            "This email is already registered. Sign in or use a different email.";
        }

        return NextResponse.json(
          {
            ...(typeof data === "object" && data !== null ? data : {}),
            error: friendly,
          },
          { status: erpResponse.status }
        );
      }

      await createSession(email);

      return NextResponse.json(
        {
          ok: true,
          message: "User created",
          userId: email,
        },
        { status: 200 }
      );
    }

    const email = String(body.email ?? "").trim();
    const first_name = String(body.firstName ?? "").trim();
    const middle_name = String(body.middleName ?? "").trim();
    const last_name = String(body.lastName ?? "").trim();
    const birth_date = String(body.dob ?? "").trim();
    const mobile_no = String(body.phone ?? "").trim();

    if (
      !email ||
      !first_name ||
      !middle_name ||
      !last_name ||
      !birth_date ||
      !mobile_no ||
      !password
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: email, firstName, middleName, lastName, dob, phone, password.",
        },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const payload = {
      email,
      first_name,
      middle_name,
      last_name,
      birth_date,
      mobile_no,
      new_password: password,
      send_welcome_email: 0,
    };

    const erpResponse = await erpnextFetch(env, "/api/resource/User", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const text = await erpResponse.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!erpResponse.ok) {
      const frappeMsg = extractFrappeMessage(data);
      let friendly = frappeMsg ?? `ERPNext returned ${erpResponse.status}`;

      if (erpResponse.status === 401) {
        friendly =
          "ERPNext rejected credentials (401). Check ERPNEXT_API_KEY, ERPNEXT_API_SECRET, ERPNEXT_SITE_NAME, and ERPNEXT_URL.";
        console.error("[api/register/init] ERPNext 401");
      } else if (erpResponse.status === 409) {
        friendly =
          frappeMsg ??
          "This email is already registered. Sign in or use a different email.";
      }

      return NextResponse.json(
        {
          ...(typeof data === "object" && data !== null ? data : {}),
          error: friendly,
        },
        { status: erpResponse.status }
      );
    }

    await createSession(email);

    return NextResponse.json(
      {
        ok: true,
        message: "User created",
        userId: email,
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("[api/register/init]", e);
    return NextResponse.json(
      { error: "Registration service unavailable" },
      { status: 502 }
    );
  }
}
