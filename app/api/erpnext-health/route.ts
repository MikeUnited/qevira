import { NextResponse } from "next/server";

import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";

/**
 * GET /api/erpnext-health
 * Verifies .env.local can authenticate to ERPNext (same logic as registration).
 */
export async function GET() {
  const env = readErpnextEnv();
  if ("error" in env) {
    return NextResponse.json({ ok: false, message: env.error }, { status: 500 });
  }

  try {
    const res = await erpnextFetch(
      env,
      "/api/method/frappe.auth.get_logged_user"
    );
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    return NextResponse.json(
      {
        ok: res.ok,
        status: res.status,
        site: env.siteName,
        baseUrl: env.baseUrl,
        data: res.ok ? data : data,
      },
      { status: res.ok ? 200 : res.status }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { ok: false, message: `Fetch failed: ${message}` },
      { status: 502 }
    );
  }
}
