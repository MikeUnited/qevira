import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { tryExtractFrappeMessage } from "@/lib/frappe-user-message";
import { getUserProfile } from "@/lib/server-user-profile";
import { decrypt, SESSION_COOKIE } from "@/lib/session";

// Pagination implemented - limit_start maps to
// (page - 1) * pageSize per Frappe's API

const FORBIDDEN_MSG =
  "Must be a registered supplier to view catalog.";

/** Uppercase, non-alphanumeric → hyphens, collapse repeats, trim edges, cap length. */
function supplierSlugFromName(input: string, maxLen: number): string {
  const upper = input.toUpperCase();
  const replaced = upper
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return replaced.slice(0, maxLen);
}

function extractDataRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const o = json as { data?: unknown };
  if (!Array.isArray(o.data)) return [];
  return o.data.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && !Array.isArray(r)
  );
}

function extractFrappeError(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "ERPNext request failed.";
  }
  const fromTry = tryExtractFrappeMessage(data);
  if (fromTry) return fromTry;
  const o = data as Record<string, unknown>;
  if (typeof o.exception === "string" && o.exception.trim()) {
    return o.exception.trim().slice(0, 500);
  }
  return "ERPNext request failed.";
}

function extractFrappeTotalCount(json: unknown): number {
  if (!json || typeof json !== "object") return 0;
  const o = json as Record<string, unknown>;
  if (typeof o.message === "number" && Number.isFinite(o.message)) {
    return o.message;
  }
  if (typeof o.message === "string") {
    const n = Number.parseInt(o.message, 10);
    if (!Number.isNaN(n)) return n;
  }
  return extractDataRows(json).length;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(10, parseInt(searchParams.get("pageSize") ?? "50", 10) || 50)
  );
  const limitStart = (page - 1) * pageSize;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: FORBIDDEN_MSG }, { status: 403 });
  }

  const sessionPayload = await decrypt(token);
  const sessionEmail =
    typeof sessionPayload?.email === "string"
      ? sessionPayload.email.trim()
      : "";
  if (!sessionEmail) {
    return NextResponse.json({ error: FORBIDDEN_MSG }, { status: 403 });
  }

  const profile = await getUserProfile();
  if (!profile.ok) {
    return NextResponse.json({ error: FORBIDDEN_MSG }, { status: 403 });
  }
  if (profile.data.supplierGroup === null) {
    return NextResponse.json({ error: FORBIDDEN_MSG }, { status: 403 });
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
  const supplierJson = (await supplierRes.json().catch(() => ({}))) as {
    data?: unknown[];
  };
  const supplierRow = Array.isArray(supplierJson.data)
    ? supplierJson.data[0]
    : undefined;
  const supplier_id =
    supplierRow &&
    typeof supplierRow === "object" &&
    supplierRow !== null &&
    typeof (supplierRow as { name?: string }).name === "string"
      ? (supplierRow as { name: string }).name.trim()
      : "";
  if (!supplier_id) {
    return NextResponse.json(
      { error: "Could not resolve supplier record for this account." },
      { status: 403 }
    );
  }

  const supplierWhQs = new URLSearchParams({
    fields: JSON.stringify(["custom_warehouse"]),
  });
  const supplierDocRes = await erpnextFetch(
    env,
    `/api/resource/Supplier/${encodeURIComponent(supplier_id)}?${supplierWhQs}`,
    { cache: "no-store" }
  );
  const supplierDocJson = (await supplierDocRes.json().catch(() => ({}))) as {
    data?: Record<string, unknown>;
  };
  if (!supplierDocRes.ok) {
    return NextResponse.json(
      { error: extractFrappeError(supplierDocJson) },
      { status: 502 }
    );
  }
  const doc = supplierDocJson.data;
  const cw = doc?.custom_warehouse;
  const supplierWarehouse =
    typeof cw === "string" ? cw.trim() : cw != null ? String(cw).trim() : "";
  if (!supplierWarehouse) {
    return NextResponse.json(
      {
        error:
          "Supplier warehouse not provisioned. Please contact support.",
      },
      { status: 400 }
    );
  }

  let supplierDisplayName = profile.data.fullName.trim() || "SUPPLIER";
  if (
    supplierRow &&
    typeof supplierRow === "object" &&
    supplierRow !== null &&
    "supplier_name" in supplierRow &&
    typeof (supplierRow as { supplier_name?: string }).supplier_name ===
      "string"
  ) {
    const sn = (supplierRow as { supplier_name: string }).supplier_name.trim();
    if (sn) supplierDisplayName = sn;
  }

  const supplierSlug = supplierSlugFromName(supplierDisplayName, 30);

  const itemNameFilter = ["name", "like", `${supplierSlug}-%`] as const;

  const countQs = new URLSearchParams({
    filters: JSON.stringify([itemNameFilter]),
    fields: JSON.stringify(["name"]),
    limit_page_length: "0",
  });

  const itemsQs = new URLSearchParams({
    filters: JSON.stringify([itemNameFilter]),
    fields: JSON.stringify([
      "name",
      "item_name",
      "item_group",
      "custom_efda_registration_no",
    ]),
    limit_page_length: String(pageSize),
    limit_start: String(limitStart),
    order_by: "item_name asc",
  });

  const [countRes, itemsRes] = await Promise.all([
    erpnextFetch(env, `/api/resource/Item?${countQs}`, { cache: "no-store" }),
    erpnextFetch(env, `/api/resource/Item?${itemsQs}`, { cache: "no-store" }),
  ]);

  const [countJson, itemsJson] = await Promise.all([
    countRes.json().catch(() => ({})),
    itemsRes.json().catch(() => ({})),
  ]);

  if (!itemsRes.ok) {
    return NextResponse.json(
      { error: extractFrappeError(itemsJson) },
      { status: 502 }
    );
  }

  if (!countRes.ok) {
    return NextResponse.json(
      { error: extractFrappeError(countJson) },
      { status: 502 }
    );
  }

  const total = extractFrappeTotalCount(countJson);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  const itemRows = extractDataRows(itemsJson);
  const itemCodes = itemRows
    .map((row) =>
      typeof row.name === "string" ? row.name.trim() : ""
    )
    .filter(Boolean);

  const priceByCode = new Map<string, number>();
  const stockByCode = new Map<string, number>();

  if (itemCodes.length > 0) {
    const pricesQs = new URLSearchParams({
      filters: JSON.stringify([
        ["supplier", "=", supplier_id],
        ["price_list", "=", "Standard Buying"],
        ["item_code", "in", itemCodes],
      ]),
      fields: JSON.stringify(["item_code", "price_list_rate"]),
      limit_page_length: String(pageSize),
      limit_start: String(limitStart),
    });

    const stockQs = new URLSearchParams({
      filters: JSON.stringify([
        ["item_code", "in", itemCodes],
        ["warehouse", "=", supplierWarehouse],
      ]),
      fields: JSON.stringify(["item_code", "actual_qty"]),
      limit_page_length: String(pageSize),
      limit_start: String(limitStart),
    });

    const [pricesRes, stockRes] = await Promise.all([
      erpnextFetch(env, `/api/resource/Item Price?${pricesQs}`, {
        cache: "no-store",
      }),
      erpnextFetch(env, `/api/resource/Bin?${stockQs}`, { cache: "no-store" }),
    ]);

    const [pricesJson, stockJson] = await Promise.all([
      pricesRes.json().catch(() => ({})),
      stockRes.json().catch(() => ({})),
    ]);

    if (!pricesRes.ok) {
      console.error(
        "[catalog/list] Item Price fetch failed:",
        pricesRes.status,
        pricesJson
      );
    }
    if (!stockRes.ok) {
      console.error(
        "[catalog/list] Bin fetch failed:",
        stockRes.status,
        stockJson
      );
    }

    const priceRows = pricesRes.ok ? extractDataRows(pricesJson) : [];
    const stockRows = stockRes.ok ? extractDataRows(stockJson) : [];

    for (const row of priceRows) {
      const code =
        typeof row.item_code === "string" ? row.item_code.trim() : "";
      if (!code || priceByCode.has(code)) continue;
      const rate = row.price_list_rate;
      const n =
        typeof rate === "number"
          ? rate
          : typeof rate === "string"
            ? Number.parseFloat(rate)
            : NaN;
      if (!Number.isNaN(n)) priceByCode.set(code, n);
    }

    for (const row of stockRows) {
      const code =
        typeof row.item_code === "string" ? row.item_code.trim() : "";
      if (!code) continue;
      const qty = row.actual_qty;
      const n =
        typeof qty === "number"
          ? qty
          : typeof qty === "string"
            ? Number.parseFloat(qty)
            : 0;
      const add = Number.isNaN(n) ? 0 : n;
      stockByCode.set(code, (stockByCode.get(code) ?? 0) + add);
    }
  }

  const merged = itemRows.map((item) => {
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const itemName =
      typeof item.item_name === "string" ? item.item_name.trim() : "";
    const group =
      typeof item.item_group === "string" ? item.item_group.trim() : "";
    const efdaRaw = item.custom_efda_registration_no;
    const efda =
      typeof efdaRaw === "string"
        ? efdaRaw.trim()
        : efdaRaw != null
          ? String(efdaRaw)
          : "";

    return {
      itemCode: name,
      itemName,
      group,
      efda,
      price: priceByCode.get(name) ?? 0,
      stock: stockByCode.get(name) ?? 0,
    };
  });

  return NextResponse.json(
    {
      items: merged,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    },
    { status: 200 }
  );
}
