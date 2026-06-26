import { NextRequest, NextResponse } from "next/server";
import { NotificationType, Prisma } from "@prisma/client";

import {
  encryptBankAccountNumberAtRest,
  hashBankAccountNumberForStorage,
} from "@/lib/bank-account-storage";

import { erpnextFetch, readErpnextEnv, type ErpnextEnv } from "@/lib/erpnext-auth";
import { syncPartyBankAccountsToErpnext } from "@/lib/erpnext-party-bank";
import {
  deriveSupplierSlugFromCompanyOrDoc,
  ensureBuyerWarehouse,
  ensureSupplierWarehouse,
  fetchCustomerDisplayName,
  fetchSupplierCompanyName,
  linkWarehouseToCustomer,
  linkWarehouseToSupplier,
} from "@/lib/erpnext-warehouse";
import { createNotification } from "@/lib/notifications-service";
import { prisma } from "@/lib/prisma";
import { createSession, getSessionEmail } from "@/lib/session";
import { kycBankSubmitBodySchema } from "@/lib/validation/kyc-bank";

function extractDataRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const o = json as { data?: unknown };
  if (!Array.isArray(o.data)) return [];
  return o.data.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && !Array.isArray(r)
  );
}

async function fetchDocNameByEmail(
  env: ErpnextEnv,
  doctype: "Supplier" | "Customer",
  email: string
): Promise<string | null> {
  const qs = new URLSearchParams({
    filters: JSON.stringify([["email_id", "=", email]]),
    fields: JSON.stringify(["name"]),
    limit_page_length: "1",
  });
  const res = await erpnextFetch(env, `/api/resource/${doctype}?${qs}`, {
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const rows = extractDataRows(json);
  const n = rows[0]?.name;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

function isErpDuplicateBankError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /DuplicateEntryError/i.test(msg) || /Duplicate entry/i.test(msg)
  );
}

function isPrismaUniqueConstraintError(
  err: unknown
): err is Prisma.PrismaClientKnownRequestError {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

export async function POST(req: NextRequest) {
  const sessionEmail = await getSessionEmail();
  if (!sessionEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = kycBankSubmitBodySchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid bank payload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { accounts } = parsed.data;

  const env = readErpnextEnv();
  if ("error" in env) {
    return NextResponse.json({ error: env.error }, { status: 500 });
  }

  const supplierName = await fetchDocNameByEmail(
    env,
    "Supplier",
    sessionEmail
  );
  const customerName = await fetchDocNameByEmail(
    env,
    "Customer",
    sessionEmail
  );

  if (!supplierName && !customerName) {
    return NextResponse.json(
      {
        error:
          "No Customer or Supplier record found for this account. Complete prior KYC steps first.",
      },
      { status: 400 }
    );
  }

  const parties: { type: "Supplier" | "Customer"; name: string }[] = [];
  if (supplierName) parties.push({ type: "Supplier", name: supplierName });
  if (customerName) parties.push({ type: "Customer", name: customerName });

  try {
    await syncPartyBankAccountsToErpnext(env, parties, accounts);
  } catch (e) {
    if (isErpDuplicateBankError(e)) {
      const bankNames = [...new Set(accounts.map((a) => a.bankName))].join(
        ", "
      );
      console.warn(
        "Bank account already exists in ERPNext, treating as success:",
        bankNames
      );
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[api/register/kyc/bank] ERPNext", msg);
      return NextResponse.json(
        { error: msg || "Could not sync bank accounts to ERPNext." },
        { status: 502 }
      );
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.bankAccount.deleteMany({
        where: { profileId: sessionEmail },
      });
      await tx.bankAccount.createMany({
        data: accounts.map((a) => ({
          profileId: sessionEmail,
          bankName: a.bankName,
          branchName: a.branchName,
          accountName: a.accountName,
          accountNumber: encryptBankAccountNumberAtRest(a.accountNumber),
          accountNumberHash: hashBankAccountNumberForStorage(a.accountNumber),
          isPrimary: a.isPrimary,
          verificationStatus: "PENDING",
        })),
      });
    });
  } catch (e) {
    if (isPrismaUniqueConstraintError(e)) {
      console.warn(
        "Bank account already exists locally, treating as success"
      );
    } else {
      console.error("[api/register/kyc/bank] Prisma", e);
      return NextResponse.json(
        {
          error:
            "Bank accounts were saved in ERPNext but could not be stored locally.",
        },
        { status: 500 }
      );
    }
  }

  if (supplierName) {
    try {
      const companyName = await fetchSupplierCompanyName(env, supplierName);
      const supplierSlug = deriveSupplierSlugFromCompanyOrDoc(
        companyName,
        supplierName
      );
      const warehouseName = await ensureSupplierWarehouse(
        supplierName,
        supplierSlug
      );
      await linkWarehouseToSupplier(supplierName, warehouseName);
      await createNotification(
        sessionEmail,
        "Account Verified",
        "Your account has been verified and is ready to use. You can now list products and manage your inventory.",
        NotificationType.KYC_STATUS,
        "/dashboard/sales"
      );
    } catch (warehouseError) {
      console.error(
        "[kyc/bank] Warehouse automation failed:",
        warehouseError
      );
    }
  }

  if (customerName) {
    try {
      const displayName =
        (await fetchCustomerDisplayName(env, customerName)) ??
        customerName;
      const customerSlug = displayName
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      const slug =
        customerSlug.trim() ||
        customerName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const warehouseName = await ensureBuyerWarehouse(customerName, slug);
      await linkWarehouseToCustomer(customerName, warehouseName);
    } catch (warehouseError) {
      console.error(
        "[kyc/bank] Buyer warehouse automation failed:",
        warehouseError
      );
    }
  }

  let sessionCreated = false;
  try {
    await createSession(sessionEmail);
    sessionCreated = true;
  } catch (e) {
    console.error("[api/register/kyc/bank] createSession", e);
  }

  return NextResponse.json({
    ok: true,
    message: "Bank details saved",
    sessionCreated,
  });
}
