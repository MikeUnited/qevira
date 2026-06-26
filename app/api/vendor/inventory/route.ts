import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import redis from "@/lib/redis";
import { getSupplierCredentials } from "@/lib/supplier-credentials";
import { tryExtractFrappeMessage } from "@/lib/frappe-user-message";
import { getUserProfile } from "@/lib/server-user-profile";
import { decrypt, SESSION_COOKIE } from "@/lib/session";

type InventoryBody = {
  itemCode?: string;
  batchNo?: string;
  expiryDate?: string;
  qty?: number;
  unitPrice?: number;
};

function extractFrappeErrorMessage(data: unknown): string {
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
  return "ERPNext rejected the request.";
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function normalizeDateKey(s: string): string {
  const t = s.trim();
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return t;
}

function isItemPriceDuplicateError(data: unknown): boolean {
  if (data == null) return false;
  try {
    return JSON.stringify(data).includes("ItemPriceDuplicateItem");
  } catch {
    return false;
  }
}

/** Same slugification as catalog `slugSegment` / `buildItemCode` supplier segment (max 30). */
function supplierSlugFromName(input: string, maxLen: number): string {
  const upper = input.toUpperCase();
  const replaced = upper
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return replaced.slice(0, maxLen);
}

const FORBIDDEN_MSG =
  "Must be a registered supplier to update inventory.";

export async function POST(req: NextRequest) {
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

  const idempotencyKey = req.headers.get("x-inventory-idempotency-key")?.trim() ?? null;
  if (!idempotencyKey) {
    console.warn(
      "[inventory] No idempotency key provided - duplicate protection disabled"
    );
    // TODO: Make idempotency key required once all clients are updated to send it
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = raw as InventoryBody;
  const itemCode = typeof body.itemCode === "string" ? body.itemCode.trim() : "";
  const batchNo = typeof body.batchNo === "string" ? body.batchNo.trim() : "";
  const expiryDate =
    typeof body.expiryDate === "string" ? body.expiryDate.trim() : "";
  const qty = typeof body.qty === "number" ? body.qty : NaN;
  const unitPrice = typeof body.unitPrice === "number" ? body.unitPrice : NaN;

  if (
    !itemCode ||
    !batchNo ||
    !expiryDate ||
    Number.isNaN(qty) ||
    Number.isNaN(unitPrice)
  ) {
    return NextResponse.json(
      {
        error:
          "itemCode, batchNo, expiryDate, qty, and unitPrice are required.",
      },
      { status: 400 }
    );
  }

  if (qty <= 0 || unitPrice <= 0) {
    return NextResponse.json(
      { error: "qty and unitPrice must be greater than 0." },
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
  const supplierJson = await parseJson(supplierRes);
  const supplierRows =
    supplierJson &&
    typeof supplierJson === "object" &&
    "data" in supplierJson &&
    Array.isArray((supplierJson as { data: unknown }).data)
      ? (supplierJson as { data: unknown[] }).data
      : [];
  const supplierRow = supplierRows[0];
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

  if (idempotencyKey) {
    const redisKey = `idempotency:inventory:${supplier_id}:${idempotencyKey}`;
    const existing = await redis.get(redisKey);
    if (existing != null) {
      return NextResponse.json(
        {
          ok: true,
          message: "Inventory entry already recorded.",
          cached: true,
        },
        { status: 409 }
      );
    }
  }

  const supplierWhQs = new URLSearchParams({
    fields: JSON.stringify(["custom_warehouse"]),
  });
  const supplierDocRes = await erpnextFetch(
    env,
    `/api/resource/Supplier/${encodeURIComponent(supplier_id)}?${supplierWhQs}`,
    { cache: "no-store" }
  );
  const supplierDocJson = await parseJson(supplierDocRes);
  if (!supplierDocRes.ok) {
    return NextResponse.json(
      { error: extractFrappeErrorMessage(supplierDocJson) },
      { status: 502 }
    );
  }
  const supplierDocData =
    supplierDocJson &&
    typeof supplierDocJson === "object" &&
    "data" in supplierDocJson &&
    supplierDocJson.data &&
    typeof supplierDocJson.data === "object" &&
    supplierDocJson.data !== null
      ? (supplierDocJson as { data: Record<string, unknown> }).data
      : null;
  const cw = supplierDocData?.custom_warehouse;
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

  const tenantCreds = await getSupplierCredentials(supplier_id);
  // TODO: Require per-tenant credentials once all suppliers are provisioned.
  const tenantAuth = tenantCreds ?? undefined;

  let supplierDisplayName = profile.data.fullName.trim() || "SUPPLIER";
  if (
    supplierRow &&
    typeof supplierRow === "object" &&
    supplierRow !== null &&
    typeof (supplierRow as { supplier_name?: string }).supplier_name ===
      "string"
  ) {
    const sn = (supplierRow as { supplier_name: string }).supplier_name.trim();
    if (sn) supplierDisplayName = sn;
  }

  const supplierSlug = supplierSlugFromName(supplierDisplayName, 30);

  // Ownership assertion: itemCode must start with
  // this supplier's slug to prevent item hijacking
  if (
    !itemCode
      .toUpperCase()
      .startsWith(supplierSlug.toUpperCase() + "-")
  ) {
    return NextResponse.json(
      { error: "Unauthorized: You do not own this item." },
      { status: 403 }
    );
  }

  const itemVerifyQs = new URLSearchParams({
    fields: JSON.stringify(["name"]),
  });
  const itemVerifyRes = await erpnextFetch(
    env,
    `/api/resource/Item/${encodeURIComponent(itemCode)}?${itemVerifyQs}`,
    { cache: "no-store" }
  );
  const itemVerifyJson = await parseJson(itemVerifyRes);
  const itemVerifyData =
    itemVerifyJson &&
    typeof itemVerifyJson === "object" &&
    "data" in itemVerifyJson &&
    itemVerifyJson.data &&
    typeof itemVerifyJson.data === "object" &&
    itemVerifyJson.data !== null &&
    !Array.isArray(itemVerifyJson.data)
      ? (itemVerifyJson as { data: Record<string, unknown> }).data
      : null;
  const itemHasName =
    itemVerifyData &&
    typeof itemVerifyData.name === "string" &&
    itemVerifyData.name.trim().length > 0;
  if (!itemVerifyRes.ok || !itemHasName) {
    return NextResponse.json(
      { error: "Item not found in catalog." },
      { status: 400 }
    );
  }

  let createdBatchName: string | null = null;
  let createdPriceName: string | null = null;
  let createdStockEntryName: string | null = null;
  /** Batch document name for Stock Entry line (Link field). */
  let resolvedBatchName: string | null = null;

  try {
    const batchPayload = {
      batch_id: batchNo,
      item: itemCode,
      expiry_date: expiryDate,
    };

    const batchPost = await erpnextFetch(
      env,
      "/api/resource/Batch",
      {
        method: "POST",
        body: JSON.stringify(batchPayload),
      },
      tenantAuth
    );

    const batchPostData = await parseJson(batchPost);

    if (batchPost.status === 409) {
      const getBatch = await erpnextFetch(
        env,
        `/api/resource/Batch/${encodeURIComponent(batchNo)}`,
        { cache: "no-store" },
        tenantAuth
      );
      const getData = await parseJson(getBatch);
      if (!getBatch.ok || !getData || typeof getData !== "object") {
        throw new Error(extractFrappeErrorMessage(getData));
      }
      const batchDoc =
        "data" in getData &&
        getData.data &&
        typeof getData.data === "object" &&
        getData.data !== null
          ? (getData as { data: Record<string, unknown> }).data
          : null;
      if (!batchDoc) {
        throw new Error("Could not load existing batch for conflict check.");
      }
      const existingExpiry =
        typeof batchDoc.expiry_date === "string"
          ? batchDoc.expiry_date
          : typeof batchDoc.expiry_date === "object" &&
              batchDoc.expiry_date !== null
            ? String((batchDoc.expiry_date as { toString?: () => string }).toString?.() ?? "")
            : "";
      if (normalizeDateKey(existingExpiry) !== normalizeDateKey(expiryDate)) {
        throw new Error(
          "Batch number already exists with a different expiry date."
        );
      }
      const existingName =
        typeof batchDoc.name === "string" ? batchDoc.name.trim() : "";
      resolvedBatchName = existingName || batchNo;
    } else if (!batchPost.ok) {
      throw new Error(extractFrappeErrorMessage(batchPostData));
    } else {
      const dataObj =
        batchPostData &&
        typeof batchPostData === "object" &&
        "data" in batchPostData &&
        (batchPostData as { data?: unknown }).data &&
        typeof (batchPostData as { data: unknown }).data === "object" &&
        (batchPostData as { data: object }).data !== null
          ? (batchPostData as { data: Record<string, unknown> }).data
          : null;
      const name =
        dataObj && typeof dataObj.name === "string" ? dataObj.name.trim() : "";
      if (!name) {
        throw new Error("Batch created but response had no name.");
      }
      createdBatchName = name;
      resolvedBatchName = name;
    }

    const pricePayload = {
      item_code: itemCode,
      price_list: "Standard Buying",
      price_list_rate: unitPrice,
      supplier: supplier_id,
    };

    const pricePost = await erpnextFetch(
      env,
      "/api/resource/Item Price",
      {
        method: "POST",
        body: JSON.stringify(pricePayload),
      },
      tenantAuth
    );
    const priceData = await parseJson(pricePost);
    console.error("PRICE POST RAW RESPONSE:", JSON.stringify(priceData));

    if (pricePost.ok) {
      const priceDoc =
        priceData &&
        typeof priceData === "object" &&
        "data" in priceData &&
        (priceData as { data?: unknown }).data &&
        typeof (priceData as { data: unknown }).data === "object" &&
        (priceData as { data: object }).data !== null
          ? (priceData as { data: Record<string, unknown> }).data
          : null;
      const priceName =
        priceDoc && typeof priceDoc.name === "string"
          ? priceDoc.name.trim()
          : "";
      if (!priceName) {
        throw new Error("Item Price created but response had no name.");
      }
      createdPriceName = priceName;
    } else if (isItemPriceDuplicateError(priceData)) {
      const findQs = new URLSearchParams({
        filters: JSON.stringify([
          ["item_code", "=", itemCode],
          ["price_list", "=", "Standard Buying"],
        ]),
        fields: JSON.stringify(["name"]),
        limit_page_length: "1",
      });
      const findRes = await erpnextFetch(
        env,
        `/api/resource/Item Price?${findQs}`,
        { cache: "no-store" },
        tenantAuth
      );
      const findData = await parseJson(findRes);
      if (!findRes.ok) {
        throw new Error(extractFrappeErrorMessage(findData));
      }
      const rows =
        findData &&
        typeof findData === "object" &&
        "data" in findData &&
        Array.isArray((findData as { data: unknown }).data)
          ? (findData as { data: unknown[] }).data
          : [];
      const first = rows[0];
      const existingName =
        first &&
        typeof first === "object" &&
        first !== null &&
        typeof (first as { name?: string }).name === "string"
          ? (first as { name: string }).name.trim()
          : "";
      if (!existingName) {
        throw new Error(
          "Item Price duplicate reported but no matching record was found."
        );
      }

      const putRes = await erpnextFetch(
        env,
        `/api/resource/${encodeURIComponent("Item Price")}/${encodeURIComponent(existingName)}`,
        {
          method: "PUT",
          body: JSON.stringify({ price_list_rate: unitPrice }),
        },
        tenantAuth
      );
      const putData = await parseJson(putRes);
      if (!putRes.ok) {
        throw new Error(extractFrappeErrorMessage(putData));
      }
      /* createdPriceName left unset — pre-existing record, do not delete on rollback */
    } else {
      throw new Error(extractFrappeErrorMessage(priceData));
    }

    const stockPayload = {
      stock_entry_type: "Material Receipt",
      items: [
        {
          item_code: itemCode,
          qty,
          basic_rate: unitPrice,
          batch_no: resolvedBatchName ?? batchNo,
          t_warehouse: supplierWarehouse,
        },
      ],
    };

    const stockPost = await erpnextFetch(
      env,
      "/api/resource/Stock Entry",
      {
        method: "POST",
        body: JSON.stringify(stockPayload),
      },
      tenantAuth
    );
    const stockEntryResponse = await parseJson(stockPost);
    if (!stockPost.ok) {
      throw new Error(extractFrappeErrorMessage(stockEntryResponse));
    }

    const stockEntryData =
      stockEntryResponse &&
      typeof stockEntryResponse === "object" &&
      "data" in stockEntryResponse &&
      (stockEntryResponse as { data?: unknown }).data &&
      typeof (stockEntryResponse as { data: unknown }).data === "object" &&
      (stockEntryResponse as { data: object }).data !== null
        ? (stockEntryResponse as { data: Record<string, unknown> }).data
        : null;
    const stockEntryName =
      stockEntryData && typeof stockEntryData.name === "string"
        ? stockEntryData.name.trim()
        : "";
    if (!stockEntryName) {
      throw new Error("Stock Entry created but response had no name.");
    }
    createdStockEntryName = stockEntryName;

    const submitRes = await erpnextFetch(
      env,
      `/api/resource/${encodeURIComponent("Stock Entry")}/${encodeURIComponent(stockEntryName)}`,
      {
        method: "PUT",
        body: JSON.stringify({ docstatus: 1 }),
      },
      tenantAuth
    );
    const submitData = await parseJson(submitRes);
    if (!submitRes.ok) {
      throw new Error(extractFrappeErrorMessage(submitData));
    }

    if (idempotencyKey) {
      const redisKey = `idempotency:inventory:${supplier_id}:${idempotencyKey}`;
      // Idempotency key stored for 24 hours to prevent
      // duplicate stock entries from network retries
      await redis.set(redisKey, "completed", "EX", 86400);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (createdStockEntryName) {
      try {
        const cancelRes = await erpnextFetch(
          env,
          `/api/resource/${encodeURIComponent("Stock Entry")}/${encodeURIComponent(createdStockEntryName)}`,
          {
            method: "PUT",
            body: JSON.stringify({ docstatus: 2 }),
          },
          tenantAuth
        );
        if (!cancelRes.ok) {
          console.error(
            `ROLLBACK FAILED: Could not set Stock Entry to cancelled (docstatus 2) ${createdStockEntryName}`,
            await cancelRes.text()
          );
        }
      } catch (err) {
        console.error(
          `ROLLBACK FAILED: Could not set Stock Entry to cancelled (docstatus 2) ${createdStockEntryName}`,
          err
        );
      }

      try {
        const del = await erpnextFetch(
          env,
          `/api/resource/${encodeURIComponent("Stock Entry")}/${encodeURIComponent(createdStockEntryName)}`,
          { method: "DELETE" },
          tenantAuth
        );
        if (!del.ok) {
          console.error(
            `ROLLBACK FAILED: Could not delete Stock Entry ${createdStockEntryName}`,
            await del.text()
          );
        }
      } catch (err) {
        console.error(
          `ROLLBACK FAILED: Could not delete Stock Entry ${createdStockEntryName}`,
          err
        );
      }
    }

    if (createdPriceName) {
      try {
        const del = await erpnextFetch(
          env,
          `/api/resource/${encodeURIComponent("Item Price")}/${encodeURIComponent(createdPriceName)}`,
          { method: "DELETE" },
          tenantAuth
        );
        if (!del.ok) {
          console.error(
            `ROLLBACK FAILED: Could not delete Item Price ${createdPriceName}`,
            await del.text()
          );
        }
      } catch (err) {
        console.error(
          `ROLLBACK FAILED: Could not delete Item Price ${createdPriceName}`,
          err
        );
      }
    }

    if (createdBatchName) {
      try {
        const del = await erpnextFetch(
          env,
          `/api/resource/Batch/${encodeURIComponent(createdBatchName)}`,
          { method: "DELETE" },
          tenantAuth
        );
        if (!del.ok) {
          console.error(
            `ROLLBACK FAILED: Could not delete Batch ${createdBatchName}`,
            await del.text()
          );
        }
      } catch (err) {
        console.error(
          `ROLLBACK FAILED: Could not delete Batch ${createdBatchName}`,
          err
        );
      }
    }

    let message = "Inventory update failed.";
    if (error instanceof Error && error.message.trim()) {
      message = error.message.trim();
    }

    console.error("RAW ERROR:", error);

    return NextResponse.json({ error: message }, { status: 422 });
  }
}
