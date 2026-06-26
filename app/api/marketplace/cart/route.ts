// TODO: Cart deduplication uses vendorAlias as identity key.
// Weekly alias rotation means cart items added across a 
// week boundary may not deduplicate correctly.
// Fix before beta: use supplierId + itemCode as the 
// deduplication key in prisma.cartItem, not vendorAlias.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtDecrypt } from "jose";

import { fetchEarliestBatchInfo } from "@/lib/erpnext-batch-expiry";
import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { getOfferStockMeta } from "@/lib/marketplace-offer-stock";
import { getBuyerContext } from "@/lib/get-buyer-profile";
import { prisma } from "@/lib/prisma";
import { getUserProfile } from "@/lib/server-user-profile";
import { decrypt, SESSION_COOKIE } from "@/lib/session";
import { canViewSupplier } from "@/lib/tiers";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/** Resolve catalog display fields for Prisma; token carries itemCode only. */
async function fetchItemNameAndUomFromErpnext(
  itemCode: string
): Promise<{ genericName: string; uom: string } | null> {
  const env = readErpnextEnv();
  if ("error" in env) return null;
  const qs = new URLSearchParams({
    fields: JSON.stringify(["item_name", "stock_uom"]),
  });
  const res = await erpnextFetch(
    env,
    `/api/resource/Item/${encodeURIComponent(itemCode)}?${qs}`,
    { cache: "no-store" }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const data =
    json &&
    typeof json === "object" &&
    "data" in json &&
    json.data &&
    typeof json.data === "object" &&
    json.data !== null &&
    !Array.isArray(json.data)
      ? (json.data as Record<string, unknown>)
      : null;
  const genericName =
    data && typeof data.item_name === "string"
      ? data.item_name.trim()
      : "";
  const uom =
    data && typeof data.stock_uom === "string"
      ? data.stock_uom.trim()
      : "";
  if (!genericName) return null;
  return { genericName, uom: uom || "—" };
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const sessionPayload = await decrypt(sessionToken);
  const sessionEmail =
    typeof sessionPayload?.email === "string"
      ? sessionPayload.email.trim()
      : "";
  if (!sessionEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!(await getBuyerContext(sessionEmail))) {
    const profile = await getUserProfile();
    if (!profile.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Must be a registered buyer to add items to cart." },
      { status: 403 }
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = raw as {
    offerToken?: string;
    qty?: unknown;
  };
  const offerToken =
    typeof body.offerToken === "string" ? body.offerToken.trim() : "";
  const qty = typeof body.qty === "number" ? body.qty : NaN;

  if (!offerToken || Number.isNaN(qty) || qty <= 0) {
    return NextResponse.json(
      { error: "offerToken and a positive qty are required." },
      { status: 400 }
    );
  }

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

  let payload: Record<string, unknown>;
  try {
    const { payload: p } = await jwtDecrypt(offerToken, secret);
    payload = p as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Offer has expired. Please refresh the catalog." },
      { status: 400 }
    );
  }

  const itemCode =
    typeof payload.itemCode === "string" ? payload.itemCode.trim() : "";
  const priceRaw = payload.price;
  const vendorAlias =
    typeof payload.vendorAlias === "string" ? payload.vendorAlias.trim() : "";

  const price =
    typeof priceRaw === "number"
      ? priceRaw
      : typeof priceRaw === "string"
        ? Number.parseFloat(priceRaw)
        : NaN;

  if (!itemCode || !vendorAlias || Number.isNaN(price)) {
    return NextResponse.json(
      { error: "Missing product metadata." },
      { status: 400 }
    );
  }

  const itemMeta = await fetchItemNameAndUomFromErpnext(itemCode);
  if (!itemMeta) {
    return NextResponse.json(
      {
        error:
          "Could not load product details for this offer. Try again shortly.",
      },
      { status: 502 }
    );
  }
  const { genericName, uom } = itemMeta;

  const supplierIdFromToken =
    typeof payload.supplierId === "string" ? payload.supplierId.trim() : "";
  if (supplierIdFromToken) {
    const profile = await getUserProfile();
    if (!profile.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const { supplierGroup, supplierDocName, customerGroup } = profile.data;
    if (
      supplierGroup &&
      supplierDocName &&
      supplierDocName === supplierIdFromToken
    ) {
      return NextResponse.json(
        { error: "You cannot add your own listings to cart." },
        { status: 403 }
      );
    }

    // Cart tier guard: enforces vertical access control at the API level. UI filtering alone is insufficient — direct API calls must also be blocked.
    // Requires Read permission on Supplier DocType for the Qevira API Service role in ERPNext Role Permission Manager
    const env = readErpnextEnv();
    if ("error" in env) {
      return NextResponse.json({ error: env.error }, { status: 500 });
    }
    const supplierQs = new URLSearchParams({
      fields: JSON.stringify(["name", "supplier_group"]),
    });
    const supplierRes = await erpnextFetch(
      env,
      `/api/resource/Supplier/${encodeURIComponent(supplierIdFromToken)}?${supplierQs}`,
      { cache: "no-store" }
    );
    const supplierJson = await supplierRes.json().catch(() => ({}));
    if (!supplierRes.ok) {
      return NextResponse.json(
        { error: "Could not verify supplier." },
        { status: 403 }
      );
    }
    const supplierDoc =
      supplierJson &&
      typeof supplierJson === "object" &&
      "data" in supplierJson &&
      supplierJson.data &&
      typeof supplierJson.data === "object" &&
      supplierJson.data !== null &&
      !Array.isArray(supplierJson.data)
        ? (supplierJson.data as Record<string, unknown>)
        : null;
    const rawGroup = supplierDoc?.supplier_group;
    const targetSupplierGroup =
      typeof rawGroup === "string"
        ? rawGroup.trim()
        : rawGroup &&
            typeof rawGroup === "object" &&
            rawGroup !== null &&
            "name" in rawGroup &&
            typeof (rawGroup as { name: unknown }).name === "string"
          ? String((rawGroup as { name: string }).name).trim()
          : "";
    if (!targetSupplierGroup) {
      return NextResponse.json(
        { error: "Could not verify supplier tier." },
        { status: 403 }
      );
    }
    if (
      !canViewSupplier(
        supplierGroup,
        !!customerGroup,
        targetSupplierGroup,
        supplierIdFromToken,
        supplierDocName
      )
    ) {
      return NextResponse.json(
        {
          error:
            "You do not have access to purchase from this supplier tier.",
        },
        { status: 403 }
      );
    }
  }

  const existing = await prisma.cartItem.findFirst({
    where: {
      userId: sessionEmail,
      vendorAlias,
      orderId: null,
    },
  });

  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: { increment: qty } },
    });
  } else {
    await prisma.cartItem.create({
      data: {
        userId: sessionEmail,
        offerToken,
        genericName,
        vendorAlias,
        price,
        uom,
        quantity: qty,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    message: "Item added to cart",
    details: {
      genericName,
      price,
      qty,
      vendorAlias,
    },
  });
}

export async function GET() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const sessionPayload = await decrypt(sessionToken);
  const sessionEmail =
    typeof sessionPayload?.email === "string"
      ? sessionPayload.email.trim()
      : "";
  if (!sessionEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!(await getBuyerContext(sessionEmail))) {
    const profile = await getUserProfile();
    if (!profile.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await prisma.cartItem.findMany({
    where: { userId: sessionEmail, orderId: null },
    orderBy: { createdAt: "desc" },
  });

  const now = Date.now();

  let secret: Uint8Array | null = null;
  const env = readErpnextEnv();
  if (!("error" in env) && process.env.OFFER_TOKEN_SECRET) {
    const secretBuf = Buffer.from(process.env.OFFER_TOKEN_SECRET, "base64");
    if (secretBuf.length === 32) {
      secret = new Uint8Array(secretBuf);
    }
  }

  const items = await Promise.all(
    rows.map(async (row) => {
      const isExpired = now - row.createdAt.getTime() > TWO_HOURS_MS;
      let maxQuantity = row.quantity;
      let batchNumber: string | null = null;

      if (secret && !("error" in env)) {
        try {
          const meta = await getOfferStockMeta(env, secret, row.offerToken);
          maxQuantity = meta.availableQty;
          if (meta.itemCode) {
            const batchInfo = await fetchEarliestBatchInfo(env, meta.itemCode);
            batchNumber = batchInfo.batchLabel;
          }
        } catch {
          maxQuantity = row.quantity;
        }
      }

      return {
        id: row.id,
        genericName: row.genericName,
        vendorAlias: row.vendorAlias,
        price: row.price,
        uom: row.uom,
        quantity: row.quantity,
        createdAt: row.createdAt,
        isExpired,
        maxQuantity,
        batchNumber,
      };
    })
  );

  return NextResponse.json(items);
}

export async function PATCH(req: NextRequest) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const sessionPayload = await decrypt(sessionToken);
  const sessionEmail =
    typeof sessionPayload?.email === "string"
      ? sessionPayload.email.trim()
      : "";
  if (!sessionEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!(await getBuyerContext(sessionEmail))) {
    const profile = await getUserProfile();
    if (!profile.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = raw as { id?: unknown; quantity?: unknown };
  const id =
    typeof body.id === "string" ? body.id.trim() : "";
  const quantity =
    typeof body.quantity === "number" && Number.isFinite(body.quantity)
      ? Math.floor(body.quantity)
      : NaN;

  if (!id || Number.isNaN(quantity)) {
    return NextResponse.json(
      { error: "id and quantity are required." },
      { status: 400 }
    );
  }

  if (quantity < 1) {
    return NextResponse.json(
      { error: "quantity must be at least 1." },
      { status: 400 }
    );
  }

  const row = await prisma.cartItem.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json(
      { error: "Cart item not found." },
      { status: 404 }
    );
  }
  if (row.userId !== sessionEmail) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 403 });
  }

  const now = Date.now();
  if (now - row.createdAt.getTime() > TWO_HOURS_MS) {
    return NextResponse.json(
      { error: "Offer has expired. Refresh the catalog and re-add this item." },
      { status: 400 }
    );
  }

  if (!process.env.OFFER_TOKEN_SECRET) {
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 500 }
    );
  }
  const secretBuf = Buffer.from(process.env.OFFER_TOKEN_SECRET, "base64");
  if (secretBuf.length !== 32) {
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 500 }
    );
  }
  const secret = new Uint8Array(secretBuf);

  const erpEnv = readErpnextEnv();
  if ("error" in erpEnv) {
    return NextResponse.json({ error: erpEnv.error }, { status: 500 });
  }

  const { availableQty } = await getOfferStockMeta(
    erpEnv,
    secret,
    row.offerToken
  );
  if (quantity > availableQty) {
    return NextResponse.json(
      {
        error:
          availableQty <= 0
            ? "No stock available for this item."
            : `Only ${availableQty} units available.`,
      },
      { status: 400 }
    );
  }

  await prisma.cartItem.update({
    where: { id },
    data: { quantity },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const sessionPayload = await decrypt(sessionToken);
  const sessionEmail =
    typeof sessionPayload?.email === "string"
      ? sessionPayload.email.trim()
      : "";
  if (!sessionEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id =
    typeof raw === "object" &&
    raw !== null &&
    "id" in raw &&
    typeof (raw as { id: unknown }).id === "string"
      ? (raw as { id: string }).id.trim()
      : "";

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const item = await prisma.cartItem.findUnique({ where: { id } });
  if (!item) {
    return NextResponse.json(
      { error: "Cart item not found." },
      { status: 404 }
    );
  }
  if (item.userId !== sessionEmail) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 403 });
  }

  await prisma.cartItem.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
