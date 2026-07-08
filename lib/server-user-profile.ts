import { OrganizationKind } from "@prisma/client";
import { cookies } from "next/headers";

import {
  erpnextFetch,
  readErpnextEnv,
  type ErpnextEnv,
} from "@/lib/erpnext-auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/session";

const SESSION_COOKIE = "bamys_session";

export type UserProfileData = {
  email: string;
  fullName: string;
  isDualRole: boolean;
  customerGroup: string | null;
  supplierGroup: string | null;
  /** ERPNext Supplier document name (matches Item Price `supplier`). */
  supplierDocName: string | null;
  /** From session JWT when present (team RBAC). */
  teamRole?: "OWNER" | "DIRECTOR" | "PHARMACIST";
  organizationId?: string;
  organizationKind?: "CUSTOMER" | "SUPPLIER";
};

export type UserProfileResult =
  | { ok: true; data: UserProfileData }
  | { ok: false; error: string; status: number };

async function parseResourceList(
  res: Response
): Promise<Array<Record<string, unknown>>> {
  if (!res.ok) return [];
  try {
    const j = (await res.json()) as { data?: unknown[] };
    const rows = Array.isArray(j.data) ? j.data : [];
    return rows.filter(
      (r): r is Record<string, unknown> =>
        r !== null && typeof r === "object" && !Array.isArray(r)
    );
  } catch {
    return [];
  }
}

async function fetchCustomerDocByName(
  env: ErpnextEnv,
  customerId: string
): Promise<Record<string, unknown> | null> {
  const qs = new URLSearchParams({
    fields: JSON.stringify(["name", "customer_group", "customer_name"]),
  });
  const res = await erpnextFetch(
    env,
    `/api/resource/Customer/${encodeURIComponent(customerId)}?${qs}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  try {
    const j = (await res.json()) as { data?: unknown };
    const data = j.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchSupplierDocByName(
  env: ErpnextEnv,
  supplierId: string
): Promise<Record<string, unknown> | null> {
  const qs = new URLSearchParams({
    fields: JSON.stringify(["name", "supplier_group", "supplier_name"]),
  });
  const res = await erpnextFetch(
    env,
    `/api/resource/Supplier/${encodeURIComponent(supplierId)}?${qs}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  try {
    const j = (await res.json()) as { data?: unknown };
    const data = j.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Loads the signed-in user's ERPNext profile and BAMYS roles (Customer / Supplier).
 * Direct party docs match session email; invited team members resolve via TeamMember.organizationId.
 * Used by GET /api/user/profile and the dashboard layout.
 */
export async function getUserProfile(): Promise<UserProfileResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return { ok: false, error: "Unauthorized", status: 401 };
  }

  const payload = await decrypt(token);
  const emailRaw = payload?.email;
  const email =
    typeof emailRaw === "string" && emailRaw.trim().length > 0
      ? emailRaw.trim()
      : null;
  if (!email) {
    return { ok: false, error: "Unauthorized", status: 401 };
  }

  const tr = payload?.teamRole;
  const teamRole =
    tr === "OWNER" || tr === "DIRECTOR" || tr === "PHARMACIST"
      ? tr
      : undefined;
  const oid = (payload as { organizationId?: unknown }).organizationId;
  const organizationId =
    typeof oid === "string" && oid.trim() ? oid.trim() : undefined;
  const ok = (payload as { organizationKind?: unknown }).organizationKind;
  const organizationKind =
    ok === "CUSTOMER" || ok === "SUPPLIER" ? ok : undefined;

  const env = readErpnextEnv();
  if ("error" in env) {
    return { ok: false, error: env.error, status: 500 };
  }

  const customerQs = new URLSearchParams({
    filters: JSON.stringify([["email_id", "=", email]]),
    fields: JSON.stringify(["name", "customer_group", "customer_name"]),
    limit_page_length: "1",
  });
  const supplierQs = new URLSearchParams({
    filters: JSON.stringify([["email_id", "=", email]]),
    fields: JSON.stringify(["name", "supplier_group", "supplier_name"]),
    limit_page_length: "1",
  });

  const [customerRes, supplierRes] = await Promise.all([
    erpnextFetch(env, `/api/resource/Customer?${customerQs}`, {
      cache: "no-store",
    }),
    erpnextFetch(env, `/api/resource/Supplier?${supplierQs}`, {
      cache: "no-store",
    }),
  ]);

  const [customerRows, supplierRows] = await Promise.all([
    parseResourceList(customerRes),
    parseResourceList(supplierRes),
  ]);

  let customerRow = customerRows[0];
  let supplierRow = supplierRows[0];

  if (!customerRow || !supplierRow) {
    const teamMember = await prisma.teamMember.findFirst({
      where: {
        email: email.trim().toLowerCase(),
        status: "ACCEPTED",
      },
    });

    if (teamMember) {
      const orgId = teamMember.organizationId.trim();
      if (orgId) {
        if (
          !customerRow &&
          teamMember.organizationKind === OrganizationKind.CUSTOMER
        ) {
          const orgCustomer = await fetchCustomerDocByName(env, orgId);
          if (orgCustomer) {
            customerRow = orgCustomer;
          }
        }
        if (
          !supplierRow &&
          teamMember.organizationKind === OrganizationKind.SUPPLIER
        ) {
          const orgSupplier = await fetchSupplierDocByName(env, orgId);
          if (orgSupplier) {
            supplierRow = orgSupplier;
          }
        }
      }
    }
  }

  const nameFromCustomer =
    customerRow && typeof customerRow.customer_name === "string"
      ? customerRow.customer_name.trim()
      : "";
  const nameFromSupplier =
    supplierRow && typeof supplierRow.supplier_name === "string"
      ? supplierRow.supplier_name.trim()
      : "";
  /** Display name from linked party docs; User DocType is not queried (scoped API may return 403). */
  const fullName = nameFromCustomer || nameFromSupplier || "";

  const customerGroup =
    customerRow && typeof customerRow.customer_group === "string"
      ? customerRow.customer_group
      : null;
  const supplierGroup =
    supplierRow && typeof supplierRow.supplier_group === "string"
      ? supplierRow.supplier_group
      : null;
  const supplierDocName =
    supplierRow && typeof supplierRow.name === "string"
      ? supplierRow.name.trim()
      : null;

  const hasCustomer = !!customerRow;
  const hasSupplier = !!supplierRow;
  const isDualRole = hasCustomer && hasSupplier;

  return {
    ok: true,
    data: {
      email,
      fullName,
      isDualRole,
      customerGroup,
      supplierGroup,
      supplierDocName,
      teamRole,
      organizationId,
      organizationKind,
    },
  };
}
