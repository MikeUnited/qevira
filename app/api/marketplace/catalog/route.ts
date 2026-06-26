import { NextRequest, NextResponse } from "next/server";
import { EncryptJWT } from "jose";

import { generateSupplierAlias } from "@/lib/anonymization";
import { fetchEarliestBatchInfo } from "@/lib/erpnext-batch-expiry";
import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { tryExtractFrappeMessage } from "@/lib/frappe-user-message";
import { getUserProfile } from "@/lib/server-user-profile";
import { canViewSupplier } from "@/lib/tiers";

const ITEM_GROUPS = [
  "Prescription Drugs",
  "Over-The-Counter (OTC)",
  "Medical Devices",
  "Consumables",
] as const;

// Pagination implemented - limit_start maps to
// (page - 1) * pageSize per Frappe's API

function extractDataRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const o = json as { data?: unknown };
  if (!Array.isArray(o.data)) return [];
  return o.data.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && !Array.isArray(r)
  );
}

/** Total count from Frappe list (prefers numeric message when present). */
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

/** ERPNext Item Price `supplier` (document name). */
function supplierIdFromItemPriceRow(row: Record<string, unknown>): string {
  const s = row.supplier;
  if (typeof s === "string" && s.trim()) return s.trim();
  if (
    s &&
    typeof s === "object" &&
    s !== null &&
    "name" in s &&
    typeof (s as { name?: unknown }).name === "string"
  ) {
    return (s as { name: string }).name.trim();
  }
  return "";
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

type ClientOffer = {
  vendorAlias: string;
  /** ERPNext Supplier document name for this Item Price row (self-listing checks). */
  supplierId: string;
  price: number;
  stock: number;
  uom: string;
  offerToken: string;
  /** YYYY-MM-DD from earliest Batch for this Item, or null. */
  batchExpiry: string | null;
  /** Batch doc / batch_id from ERPNext (not item code). */
  batchLabel: string | null;
};

type ProductRow = {
  genericName: string;
  itemGroup: string;
  uom: string;
  efda: string;
  /** Plain-text description from Item when present. */
  description: string | null;
  lowestPrice: number;
  totalStock: number;
  supplierCount: number;
  offers: ClientOffer[];
};

function buildItemFilters(searchTrim: string): unknown[] {
  const filters: unknown[] = [["item_group", "in", [...ITEM_GROUPS]]];
  if (searchTrim) {
    filters.push(["item_name", "like", `%${searchTrim}%`]);
  }
  return filters;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(10, parseInt(searchParams.get("pageSize") ?? "50", 10) || 50)
    );
    const limitStart = (page - 1) * pageSize;
    const searchTrim = (searchParams.get("search") ?? "").trim();

    if (!process.env.OFFER_TOKEN_SECRET) {
      return NextResponse.json(
        { error: "Server configuration error." },
        { status: 500 }
      );
    }
    const secret = Buffer.from(process.env.OFFER_TOKEN_SECRET, "base64");
    if (secret.length !== 32) {
      return NextResponse.json(
        { error: "Server configuration error." },
        { status: 500 }
      );
    }

    const env = readErpnextEnv();
    if ("error" in env) {
      return NextResponse.json({ error: env.error }, { status: 500 });
    }

    const itemFilters = buildItemFilters(searchTrim);

    const countQs = new URLSearchParams({
      filters: JSON.stringify(itemFilters),
      fields: JSON.stringify(["name"]),
      limit_page_length: "0",
    });

    const itemsQs = new URLSearchParams({
      filters: JSON.stringify(itemFilters),
      fields: JSON.stringify([
        "name",
        "item_name",
        "item_group",
        "custom_efda_registration_no",
        "stock_uom",
        "description",
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
        { status: 500 }
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

    const priceMap = new Map<string, number>();
    const supplierByItemCode = new Map<string, string>();
    const stockMap = new Map<string, number>();

    if (itemCodes.length > 0) {
      const pricesQs = new URLSearchParams({
        filters: JSON.stringify([
          ["price_list", "=", "Standard Buying"],
          ["item_code", "in", itemCodes],
        ]),
        fields: JSON.stringify(["item_code", "price_list_rate", "supplier"]),
        limit_page_length: String(pageSize),
        limit_start: String(limitStart),
      });

      const stockQs = new URLSearchParams({
        filters: JSON.stringify([
          ["actual_qty", ">", 0],
          ["item_code", "in", itemCodes],
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

      const priceRows = pricesRes.ok ? extractDataRows(pricesJson) : [];
      const binRows = stockRes.ok ? extractDataRows(stockJson) : [];

      if (!pricesRes.ok) {
        console.error(
          "[catalog] Item Price fetch failed:",
          pricesRes.status,
          extractFrappeError(pricesJson)
        );
      }
      if (!stockRes.ok) {
        console.error(
          "[catalog] Bin fetch failed:",
          stockRes.status,
          extractFrappeError(stockJson)
        );
      }

      // Tier filtering: guests see all (teaser view)
      // Authenticated suppliers see upstream only
      // Authenticated buyers see all tiers
      // Requires Read permission on Supplier DocType for the Qevira API Service role in ERPNext Role Permission Manager
      let tierFilteredPrices = priceRows;
      const profileResult = await getUserProfile();
      if (profileResult.ok) {
        const viewerSupplierGroup = profileResult.data.supplierGroup ?? null;
        const viewerSupplierId = profileResult.data.supplierDocName ?? null;
        const viewerIsCustomer = !!profileResult.data.customerGroup;

        const uniqueSupplierIds = [
          ...new Set(
            priceRows
              .map((p) => supplierIdFromItemPriceRow(p))
              .filter(Boolean)
          ),
        ];

        if (uniqueSupplierIds.length > 0) {
          const supplierFilters = [["name", "in", uniqueSupplierIds]];
          const supplierBulkQs = new URLSearchParams({
            filters: JSON.stringify(supplierFilters),
            fields: JSON.stringify(["name", "supplier_group"]),
            limit_page_length: "500",
          });
          const supplierRes = await erpnextFetch(
            env,
            `/api/resource/Supplier?${supplierBulkQs}`,
            { cache: "no-store" }
          );
          const supplierJson = await supplierRes.json().catch(() => ({}));
          const supplierRows = extractDataRows(supplierJson);
          const supplierGroupMap: Record<string, string> = {};
          for (const s of supplierRows) {
            const n = typeof s.name === "string" ? s.name.trim() : "";
            if (!n) continue;
            const raw = s.supplier_group;
            const g =
              typeof raw === "string"
                ? raw.trim()
                : raw &&
                    typeof raw === "object" &&
                    raw !== null &&
                    "name" in raw &&
                    typeof (raw as { name: unknown }).name === "string"
                  ? String((raw as { name: string }).name).trim()
                  : "";
            if (g) supplierGroupMap[n] = g;
          }

          tierFilteredPrices = priceRows.filter((price) => {
            const sid = supplierIdFromItemPriceRow(price);
            if (!sid) return false;
            const targetGroup = supplierGroupMap[sid];
            if (!targetGroup) return false;
            return canViewSupplier(
              viewerSupplierGroup,
              viewerIsCustomer,
              targetGroup,
              sid,
              viewerSupplierId
            );
          });
        }
      }

      for (const row of tierFilteredPrices) {
        const code =
          typeof row.item_code === "string" ? row.item_code.trim() : "";
        if (!code || priceMap.has(code)) continue;
        const rate = row.price_list_rate;
        const n =
          typeof rate === "number"
            ? rate
            : typeof rate === "string"
              ? Number.parseFloat(rate)
              : NaN;
        if (!Number.isNaN(n)) {
          priceMap.set(code, n);
          const sid = supplierIdFromItemPriceRow(row);
          if (sid) supplierByItemCode.set(code, sid);
        }
      }

      for (const row of binRows) {
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
        stockMap.set(code, (stockMap.get(code) ?? 0) + add);
      }
    }

    const byGeneric = new Map<string, Record<string, unknown>[]>();
    for (const item of itemRows) {
      const genericName =
        typeof item.item_name === "string" ? item.item_name.trim() : "";
      if (!genericName) continue;
      const list = byGeneric.get(genericName) ?? [];
      list.push(item);
      byGeneric.set(genericName, list);
    }

    const result: ProductRow[] = [];

    for (const [genericName, groupItems] of byGeneric) {
      type PendingOffer = {
        itemCode: string;
        vendorAlias: string;
        supplierId: string;
        price: number;
        stock: number;
        uom: string;
        offerToken: string;
      };
      const pending: PendingOffer[] = [];

      for (const item of groupItems) {
        const itemCode = typeof item.name === "string" ? item.name.trim() : "";
        if (!itemCode) continue;

        const price = priceMap.get(itemCode);
        if (price === undefined) {
          continue;
        }

        const stock = stockMap.get(itemCode) ?? 0;
        const uom =
          typeof item.stock_uom === "string" ? item.stock_uom.trim() : "";

        const supplierId = supplierByItemCode.get(itemCode) ?? "";
        const vendorAlias = supplierId.trim()
          ? generateSupplierAlias(supplierId.trim())
          : generateSupplierAlias(itemCode);

        const offerToken = await new EncryptJWT({
          itemCode,
          price,
          vendorAlias,
          supplierId,
        })
          .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
          .setExpirationTime("2h")
          .encrypt(secret);

        pending.push({
          itemCode,
          vendorAlias,
          supplierId,
          price,
          stock,
          uom,
          offerToken,
        });
      }

      const batchInfos = await Promise.all(
        pending.map((p) => fetchEarliestBatchInfo(env, p.itemCode))
      );

      const offers: ClientOffer[] = pending.map((p, i) => ({
        vendorAlias: p.vendorAlias,
        supplierId: p.supplierId,
        price: p.price,
        stock: p.stock,
        uom: p.uom,
        offerToken: p.offerToken,
        batchExpiry: batchInfos[i]?.expiry ?? null,
        batchLabel: batchInfos[i]?.batchLabel ?? null,
      }));

      if (offers.length === 0) continue;

      const first = groupItems[0];
      const itemGroup =
        typeof first?.item_group === "string"
          ? String(first.item_group).trim()
          : "";

      let efda = "";
      for (const item of groupItems) {
        const raw = item.custom_efda_registration_no;
        const s =
          typeof raw === "string"
            ? raw.trim()
            : raw != null
              ? String(raw).trim()
              : "";
        if (s) {
          efda = s;
          break;
        }
      }

      let description: string | null = null;
      for (const item of groupItems) {
        const raw = item.description;
        const s =
          typeof raw === "string"
            ? raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
            : "";
        if (s) {
          description = s;
          break;
        }
      }

      const pricesOnly = offers.map((o) => o.price);
      const lowestPrice = Math.min(...pricesOnly);
      const totalStock = offers.reduce((sum, o) => sum + o.stock, 0);
      const supplierCount = offers.length;

      result.push({
        genericName,
        itemGroup,
        uom: offers[0]?.uom ?? "",
        efda,
        description,
        lowestPrice,
        totalStock,
        supplierCount,
        offers,
      });
    }

    result.sort((a, b) =>
      a.genericName.localeCompare(b.genericName, undefined, {
        sensitivity: "base",
      })
    );

    return NextResponse.json(
      {
        products: result,
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
  } catch {
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
