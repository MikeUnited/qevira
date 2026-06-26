import { NextRequest, NextResponse } from "next/server";

import { saveSupplierCredentials } from "@/lib/supplier-credentials";

export async function POST(req: NextRequest) {
  const adminKey = req.headers.get("x-admin-key");
  const expected = process.env.ADMIN_API_KEY?.trim();
  if (!expected || adminKey !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = raw as {
    supplierId?: unknown;
    apiKey?: unknown;
    apiSecret?: unknown;
  };
  const supplierId =
    typeof body.supplierId === "string" ? body.supplierId.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const apiSecret =
    typeof body.apiSecret === "string" ? body.apiSecret.trim() : "";

  if (!supplierId || !apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "supplierId, apiKey, and apiSecret are required." },
      { status: 400 }
    );
  }

  await saveSupplierCredentials(supplierId, apiKey, apiSecret);

  return NextResponse.json({ ok: true }, { status: 200 });
}
