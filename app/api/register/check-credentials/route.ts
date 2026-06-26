import { NextRequest, NextResponse } from "next/server";

import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";

function normalizeEthiopiaPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  return `+251${digits}`;
}

/**
 * Returns whether email / phone is NOT already a User in ERPNext.
 */
export async function POST(req: NextRequest) {
  let body: { mode?: string; email?: string; phone?: string };
  try {
    body = (await req.json()) as {
      mode?: string;
      email?: string;
      phone?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const env = readErpnextEnv();
  if ("error" in env) {
    return NextResponse.json({ error: env.error }, { status: 500 });
  }

  const mode = body.mode === "phone" ? "phone" : "email";

  if (mode === "email") {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "Enter a valid email address." },
        { status: 400 }
      );
    }

    const res = await erpnextFetch(
      env,
      `/api/resource/User/${encodeURIComponent(email)}`
    );

    if (res.status === 200) {
      return NextResponse.json({
        available: false,
        error:
          "This email is already registered. Sign in or use a different email.",
      });
    }

    if (res.status === 404) {
      return NextResponse.json({ available: true });
    }

    const text = await res.text();
    let msg = `Could not verify email (${res.status})`;
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j.message) msg = j.message;
    } catch {
      /* ignore */
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const rawPhone = String(body.phone ?? "").trim();
  const fullPhone = normalizeEthiopiaPhone(rawPhone);
  if (!fullPhone || fullPhone.length < 10) {
    return NextResponse.json(
      { error: "Enter a valid phone number." },
      { status: 400 }
    );
  }

  const filtersVariants = [
    [["mobile_no", "=", fullPhone]],
    [["phone", "=", fullPhone]],
    [["mobile_no", "=", fullPhone.replace("+251", "0")]],
  ];

  for (const filters of filtersVariants) {
    const qs = new URLSearchParams({
      filters: JSON.stringify(filters),
      limit_page_length: "1",
      fields: JSON.stringify(["name"]),
    });

    const res = await erpnextFetch(
      env,
      `/api/resource/User?${qs.toString()}`
    );

    if (!res.ok) continue;

    const json = (await res.json()) as { data?: unknown[] };
    if (Array.isArray(json.data) && json.data.length > 0) {
      return NextResponse.json({
        available: false,
        error:
          "This phone number is already registered. Sign in or use a different number.",
      });
    }
  }

  return NextResponse.json({ available: true });
}
