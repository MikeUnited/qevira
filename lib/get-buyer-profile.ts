import { OrganizationKind } from "@prisma/client";

import { erpnextFetch, readErpnextEnv, type ErpnextEnv } from "@/lib/erpnext-auth";
import { prisma } from "@/lib/prisma";

function extractDataRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const o = json as { data?: unknown };
  if (!Array.isArray(o.data)) return [];
  return o.data.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && !Array.isArray(r)
  );
}

async function fetchCustomerNameByEmail(
  env: ErpnextEnv,
  email: string
): Promise<string | null> {
  const qs = new URLSearchParams({
    filters: JSON.stringify([["email_id", "=", email]]),
    fields: JSON.stringify(["name"]),
    limit_page_length: "1",
  });
  const res = await erpnextFetch(env, `/api/resource/Customer?${qs}`, {
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const rows = extractDataRows(json);
  const name =
    rows[0] && typeof rows[0].name === "string" ? rows[0].name.trim() : "";
  return name || null;
}

async function customerDocExists(
  env: ErpnextEnv,
  customerName: string
): Promise<boolean> {
  const qs = new URLSearchParams({
    fields: JSON.stringify(["name"]),
  });
  const res = await erpnextFetch(
    env,
    `/api/resource/Customer/${encodeURIComponent(customerName)}?${qs}`,
    { cache: "no-store" }
  );
  return res.ok;
}

/**
 * Resolves the ERPNext Customer document name used for marketplace buying.
 * Direct buyers: Customer linked to their email. Invited team: org Customer when
 * `organizationKind` is CUSTOMER and the document exists.
 */
export async function getBuyerContext(
  email: string
): Promise<{ customerId: string; via: "direct" | "team" } | null> {
  const env = readErpnextEnv();
  if ("error" in env) {
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();

  const directCustomerId = await fetchCustomerNameByEmail(
    env,
    normalizedEmail
  );
  if (directCustomerId) {
    return { customerId: directCustomerId, via: "direct" };
  }

  const teamMember = await prisma.teamMember.findFirst({
    where: {
      email: normalizedEmail,
      status: "ACCEPTED",
    },
  });

  if (
    !teamMember ||
    teamMember.organizationKind !== OrganizationKind.CUSTOMER
  ) {
    return null;
  }

  const customerId = teamMember.organizationId.trim();
  if (!customerId) {
    return null;
  }

  const exists = await customerDocExists(env, customerId);
  if (!exists) {
    return null;
  }

  return { customerId, via: "team" };
}

/**
 * Resolves buyer ERPNext Customer id for `email` without using the current session's profile.
 * Used when a Director places an order on behalf of another team member (e.g. cart approval).
 */
export async function getBuyerContextForEmail(
  email: string
): Promise<{ customerId: string; via: "direct" | "team" } | null> {
  const env = readErpnextEnv();
  if ("error" in env) {
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();

  const directCustomerId = await fetchCustomerNameByEmail(
    env,
    normalizedEmail
  );
  if (directCustomerId) {
    return { customerId: directCustomerId, via: "direct" };
  }

  const teamMember = await prisma.teamMember.findFirst({
    where: {
      email: normalizedEmail,
      status: "ACCEPTED",
    },
  });

  if (
    !teamMember ||
    teamMember.organizationKind !== OrganizationKind.CUSTOMER
  ) {
    return null;
  }

  const customerId = teamMember.organizationId.trim();
  if (!customerId) {
    return null;
  }

  const exists = await customerDocExists(env, customerId);
  if (!exists) {
    return null;
  }

  return { customerId, via: "team" };
}
