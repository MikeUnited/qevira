import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { tryExtractFrappeMessage } from "@/lib/frappe-user-message";
import { getUserProfile } from "@/lib/server-user-profile";
import { decrypt, SESSION_COOKIE } from "@/lib/session";

const ALLOWED_ITEM_GROUPS = [
  "Prescription Drugs",
  "Over-The-Counter (OTC)",
  "Medical Devices",
  "Consumables",
] as const;

type CatalogBody = {
  itemName?: string;
  itemGroup?: string;
  uom?: string;
  efdaRegistrationNo?: string;
  description?: string;
};

/** Uppercase, non-alphanumeric → hyphens, collapse repeats, trim edges, cap length. */
function slugSegment(input: string, maxLen: number): string {
  const upper = input.toUpperCase();
  const replaced = upper
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return replaced.slice(0, maxLen);
}

function buildItemCode(supplierName: string, itemName: string): string {
  const supplierSlug = slugSegment(supplierName, 30);
  const itemSlug = slugSegment(itemName, 60);
  return `${supplierSlug}-${itemSlug}`;
}

function extractErpnextErrorMessage(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "ERPNext rejected the request.";
  }
  const o = data as Record<string, unknown>;

  const fromTry = tryExtractFrappeMessage(data);
  if (fromTry) return fromTry;

  if (typeof o.exception === "string" && o.exception.trim()) {
    return o.exception.trim().slice(0, 500);
  }

  if (typeof o._server_messages === "string" && o._server_messages.trim()) {
    try {
      const parsed = JSON.parse(o._server_messages) as unknown;
      if (Array.isArray(parsed) && typeof parsed[0] === "string") {
        return parsed[0].slice(0, 500);
      }
    } catch {
      return o._server_messages.slice(0, 500);
    }
  }

  if (Array.isArray(o._server_messages) && o._server_messages.length > 0) {
    const first = o._server_messages[0];
    if (typeof first === "string") return first.slice(0, 500);
  }

  return "ERPNext rejected the request.";
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "Must be a registered supplier to add catalog items.",
      },
      { status: 403 }
    );
  }

  const sessionPayload = await decrypt(token);
  const sessionEmail =
    typeof sessionPayload?.email === "string"
      ? sessionPayload.email.trim()
      : "";
  if (!sessionEmail) {
    return NextResponse.json(
      {
        error:
          "Must be a registered supplier to add catalog items.",
      },
      { status: 403 }
    );
  }

  const profile = await getUserProfile();
  if (!profile.ok) {
    return NextResponse.json(
      {
        error:
          "Must be a registered supplier to add catalog items.",
      },
      { status: 403 }
    );
  }

  if (profile.data.supplierGroup === null) {
    return NextResponse.json(
      {
        error:
          "Must be a registered supplier to add catalog items.",
      },
      { status: 403 }
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = raw as CatalogBody;
  const itemName = String(body.itemName ?? "").trim();
  const itemGroup = String(body.itemGroup ?? "").trim();
  const uom = String(body.uom ?? "").trim();
  const efdaRegistrationNo = String(body.efdaRegistrationNo ?? "").trim();
  const description = String(body.description ?? "").trim();

  if (!efdaRegistrationNo) {
    return NextResponse.json(
      { error: "EFDA registration number is required." },
      { status: 400 }
    );
  }

  if (
    !ALLOWED_ITEM_GROUPS.includes(
      itemGroup as (typeof ALLOWED_ITEM_GROUPS)[number]
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid item_group. Must be one of: Prescription Drugs, Over-The-Counter (OTC), Medical Devices, Consumables.",
      },
      { status: 400 }
    );
  }

  if (!itemName || !uom) {
    return NextResponse.json(
      { error: "itemName and uom are required." },
      { status: 400 }
    );
  }

  const env = readErpnextEnv();
  if ("error" in env) {
    return NextResponse.json({ error: env.error }, { status: 500 });
  }

  const supplierQs = new URLSearchParams({
    filters: JSON.stringify([["email_id", "=", sessionEmail]]),
    fields: JSON.stringify(["name", "supplier_name"]),
    limit_page_length: "1",
  });
  const supplierRes = await erpnextFetch(
    env,
    `/api/resource/Supplier?${supplierQs}`,
    { cache: "no-store" }
  );
  let supplierDisplayName = profile.data.fullName.trim() || "SUPPLIER";
  if (supplierRes.ok) {
    try {
      const sj = (await supplierRes.json()) as { data?: unknown[] };
      const row = Array.isArray(sj.data) ? sj.data[0] : undefined;
      if (
        row &&
        typeof row === "object" &&
        row !== null &&
        "supplier_name" in row &&
        typeof (row as { supplier_name?: string }).supplier_name === "string"
      ) {
        const sn = (row as { supplier_name: string }).supplier_name.trim();
        if (sn) supplierDisplayName = sn;
      }
    } catch {
      /* keep fallback */
    }
  }

  const item_code = buildItemCode(supplierDisplayName, itemName);
  if (!item_code || item_code === "-") {
    return NextResponse.json(
      { error: "Could not derive a valid item_code from supplier and item name." },
      { status: 400 }
    );
  }

  const payload = {
    item_code,
    item_name: itemName,
    item_group: itemGroup,
    stock_uom: uom,
    description,
    custom_efda_registration_no: efdaRegistrationNo,
    has_batch_no: 1,
    has_expiry_date: 1,
    is_stock_item: 1,
  };

  try {
    // TODO: Replace global API key with per-tenant API key for strict EFDA audit trailing once KYC provisioning is complete.
    const erpRes = await erpnextFetch(env, "/api/resource/Item", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const text = await erpRes.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!erpRes.ok) {
      const msg = extractErpnextErrorMessage(data);
      return NextResponse.json({ error: msg }, { status: 422 });
    }

    const dataObj =
      data &&
      typeof data === "object" &&
      "data" in data &&
      (data as { data?: unknown }).data &&
      typeof (data as { data: unknown }).data === "object" &&
      (data as { data: object }).data !== null
        ? (data as { data: Record<string, unknown> }).data
        : null;
    const itemId =
      dataObj && typeof dataObj.name === "string" ? dataObj.name : item_code;

    return NextResponse.json({
      ok: true,
      message: "Item successfully added to catalog",
      itemId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/vendor/catalog]", msg);
    return NextResponse.json(
      { error: msg || "Catalog request failed" },
      { status: 502 }
    );
  }
}
