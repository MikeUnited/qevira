// Requires the following ERPNext permissions for Qevira API Service role:
// - Warehouse: Read, Write, Create
// - Supplier: Read, Write (for custom_warehouse field)
// - Customer: Read, Write (for custom_warehouse field)
//
// Buyer warehouses: requires "Buyer Stock - BAMYS" (or ERPNEXT_BUYER_WAREHOUSE)
// group warehouse to exist in ERPNext under All Warehouses - BAMYS

import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import type { ErpnextEnv } from "@/lib/erpnext-auth";
import { prisma } from "@/lib/prisma";

function isDuplicateWarehouseError(err: unknown): boolean {
  const errStr = JSON.stringify(err);
  return (
    errStr.includes("DuplicateEntryError") ||
    errStr.includes("already exists") ||
    errStr.includes("Duplicate entry")
  );
}

/** Persists ERPNext Customer `name` → buyer warehouse (SQLite fallback when Customer.custom_warehouse is missing). */
export async function upsertBuyerWarehouseMapping(
  customerId: string,
  warehouseName: string
): Promise<void> {
  await prisma.buyerWarehouse.upsert({
    where: { customerId },
    create: { customerId, warehouseName },
    update: { warehouseName },
  });
}

export function deriveWarehouseName(supplierSlug: string): string {
  // Convert slug to uppercase warehouse label
  // Example: "green-cross-pharmacy" → "WH-GREEN-CROSS-PHARMACY"
  const upperSlug = supplierSlug
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9-]/g, "");
  return `WH-${upperSlug}`;
}

/** Prefer company display name; fall back to ERPNext Supplier document name. */
export function deriveSupplierSlugFromCompanyOrDoc(
  companyName: string | null | undefined,
  supplierDocName: string
): string {
  const raw =
    (typeof companyName === "string" && companyName.trim()
      ? companyName.trim()
      : supplierDocName) || supplierDocName;
  return raw
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export async function fetchSupplierCompanyName(
  env: ErpnextEnv,
  supplierDocName: string
): Promise<string | null> {
  const qs = new URLSearchParams({
    fields: JSON.stringify(["supplier_name"]),
  });
  const res = await erpnextFetch(
    env,
    `/api/resource/Supplier/${encodeURIComponent(supplierDocName)}?${qs}`,
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
  const sn =
    data && typeof data.supplier_name === "string"
      ? data.supplier_name.trim()
      : "";
  return sn || null;
}

export async function ensureSupplierWarehouse(
  supplierDocName: string,
  supplierSlug: string
): Promise<string> {
  const env = readErpnextEnv();
  if ("error" in env) {
    throw new Error(`[warehouse] ${env.error}`);
  }

  const slug =
    supplierSlug.trim() ||
    deriveSupplierSlugFromCompanyOrDoc(null, supplierDocName);
  const warehouseName = deriveWarehouseName(slug);

  // Step 1: Check if warehouse already exists
  const checkRes = await erpnextFetch(
    env,
    `/api/resource/Warehouse/${encodeURIComponent(warehouseName)}`,
    { cache: "no-store" }
  );

  if (checkRes.ok) {
    console.log(`[warehouse] Already exists: ${warehouseName}`);
    return warehouseName;
  }

  if (checkRes.status !== 404) {
    const err = await checkRes.json().catch(() => ({}));
    throw new Error(`[warehouse] Check failed: ${JSON.stringify(err)}`);
  }

  // Step 2: Create the warehouse
  const createRes = await erpnextFetch(env, "/api/resource/Warehouse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      warehouse_name: warehouseName,
      parent_warehouse:
        process.env.ERPNEXT_PARENT_WAREHOUSE ||
        "Marketplace Participants - BAMYS",
      company: process.env.ERPNEXT_COMPANY_NAME || "BAMYS",
      is_group: 0,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    if (isDuplicateWarehouseError(err)) {
      console.log(
        "[warehouse] Supplier warehouse already exists, treating as success:",
        warehouseName
      );
      return warehouseName;
    }
    throw new Error(`[warehouse] Creation failed: ${JSON.stringify(err)}`);
  }

  const created = (await createRes.json().catch(() => ({}))) as {
    data?: { name?: string };
  };
  const createdName =
    (typeof created.data?.name === "string" && created.data.name.trim()
      ? created.data.name.trim()
      : null) ?? warehouseName;

  return createdName;
}

export async function linkWarehouseToSupplier(
  supplierName: string,
  warehouseName: string
): Promise<void> {
  const env = readErpnextEnv();
  if ("error" in env) {
    console.error(`[warehouse] link skipped: ${env.error}`);
    return;
  }

  const res = await erpnextFetch(
    env,
    `/api/resource/Supplier/${encodeURIComponent(supplierName)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        custom_warehouse: warehouseName,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(
      `[warehouse] Failed to link to supplier: ${JSON.stringify(err)}`
    );
  } else {
    console.log(`[warehouse] Linked ${warehouseName} to ${supplierName}`);
  }
}

export async function fetchCustomerDisplayName(
  env: ErpnextEnv,
  customerDocName: string
): Promise<string | null> {
  const qs = new URLSearchParams({
    fields: JSON.stringify(["customer_name"]),
  });
  const res = await erpnextFetch(
    env,
    `/api/resource/Customer/${encodeURIComponent(customerDocName)}?${qs}`,
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
  const cn =
    data && typeof data.customer_name === "string"
      ? data.customer_name.trim()
      : "";
  return cn || null;
}

export async function ensureBuyerWarehouse(
  customerDocName: string,
  customerSlug: string
): Promise<string> {
  const env = readErpnextEnv();
  if ("error" in env) {
    throw new Error(`[warehouse] ${env.error}`);
  }

  const upperSlug = customerSlug
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9-]/g, "");
  const warehouseName = `WH-BUYER-${upperSlug}`;

  const checkRes = await erpnextFetch(
    env,
    `/api/resource/Warehouse/${encodeURIComponent(warehouseName)}`,
    { cache: "no-store" }
  );

  if (checkRes.ok) {
    console.log(`[warehouse] Buyer warehouse exists: ${warehouseName}`);
    await upsertBuyerWarehouseMapping(customerDocName, warehouseName);
    return warehouseName;
  }

  if (checkRes.status !== 404) {
    const err = await checkRes.json().catch(() => ({}));
    throw new Error(`[warehouse] Buyer check failed: ${JSON.stringify(err)}`);
  }

  const parentWarehouse =
    process.env.ERPNEXT_BUYER_WAREHOUSE || "Buyer Stock - BAMYS";
  const companyName =
    process.env.ERPNEXT_COMPANY_NAME || "BAMYS Trading PLC";

  const createRes = await erpnextFetch(env, "/api/resource/Warehouse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      warehouse_name: warehouseName,
      parent_warehouse: parentWarehouse,
      company: companyName,
      is_group: 0,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    if (isDuplicateWarehouseError(err)) {
      console.log(
        "[buyer-warehouse] already exists, treating as success:",
        warehouseName
      );
      await upsertBuyerWarehouseMapping(
        customerDocName,
        warehouseName
      ).catch((e) =>
        console.error("[buyer-warehouse] Prisma upsert failed:", e)
      );
      return warehouseName;
    }
    console.error(
      "[buyer-warehouse] creation error:",
      JSON.stringify(err, null, 2)
    );
    throw new Error(
      `[warehouse] Buyer creation failed: ${JSON.stringify(err)}`
    );
  }

  const created = (await createRes.json().catch(() => ({}))) as {
    data?: { name?: string };
  };
  const createdName =
    (typeof created.data?.name === "string" && created.data.name.trim()
      ? created.data.name.trim()
      : null) ?? warehouseName;

  await upsertBuyerWarehouseMapping(customerDocName, createdName);
  return createdName;
}

export async function linkWarehouseToCustomer(
  customerName: string,
  warehouseName: string
): Promise<void> {
  const env = readErpnextEnv();
  if ("error" in env) {
    console.error(`[warehouse] link buyer skipped: ${env.error}`);
    return;
  }

  const res = await erpnextFetch(
    env,
    `/api/resource/Customer/${encodeURIComponent(customerName)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        custom_warehouse: warehouseName,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(
      `[warehouse] Failed to link buyer warehouse: ${JSON.stringify(err)}`
    );
  } else {
    console.log(`[warehouse] Linked ${warehouseName} to ${customerName}`);
  }

  await upsertBuyerWarehouseMapping(customerName, warehouseName);
}
