/**
 * Shared ERPNext KYC helpers for registration /api/register/* KYC routes.
 */

import {
  erpnextFetch,
  erpnextFetchMultipart,
  type ErpnextEnv,
} from "@/lib/erpnext-auth";
import { tryExtractFrappeMessage as extractFrappeMessage } from "@/lib/frappe-user-message";

export { extractFrappeMessage };

export type KycFormFields = {
  organizationType?: string;
  companyName?: string;
  company_name?: string;
  /** Stored in Customer/Supplier remarks (Primary contact: …). */
  contactPerson?: string;
  tin?: string;
  businessLicenseNo?: string;
  efdaLicenseNo?: string;
};

type OrgPlan =
  | { kind: "customer"; customerGroup: string }
  | { kind: "supplier"; supplierGroup: string }
  | {
      kind: "both";
      customerGroup: string;
      supplierGroup: string;
    };

export function parseOrgPlan(org: string | undefined): OrgPlan | null {
  const o = (org ?? "").trim().toLowerCase();
  if (!o) return null;
  if (o === "manufacturer") {
    return { kind: "supplier", supplierGroup: "Manufacturer" };
  }
  if (o === "pharmacy") {
    return { kind: "customer", customerGroup: "Pharmacy" };
  }
  if (o === "hospital") {
    return { kind: "customer", customerGroup: "Hospital" };
  }
  if (o === "importer") {
    return {
      kind: "both",
      customerGroup: "Importer",
      supplierGroup: "Importer",
    };
  }
  if (o === "wholesaler") {
    return {
      kind: "both",
      customerGroup: "Wholesaler",
      supplierGroup: "Wholesaler",
    };
  }
  return null;
}

function entityBasePayload(fields: KycFormFields) {
  const companyName = (
    fields.companyName?.trim() ||
    fields.company_name?.trim() ||
    "Unknown"
  ).trim();
  const taxId = fields.tin?.trim() ?? "";
  const custom_business_license_no = fields.businessLicenseNo?.trim() ?? "";
  const custom_efda_license_no = fields.efdaLicenseNo?.trim() ?? "";
  return {
    companyName,
    taxId,
    custom_business_license_no,
    custom_efda_license_no,
  };
}

function remarksFromContact(fields: KycFormFields): string | undefined {
  const c = fields.contactPerson?.trim();
  if (!c) return undefined;
  return `Primary contact: ${c}`;
}

async function fetchFirstDocName(
  env: ErpnextEnv,
  doctype: "Customer" | "Supplier",
  email: string
): Promise<string | null> {
  const qs = new URLSearchParams({
    filters: JSON.stringify([["email_id", "=", email]]),
    fields: JSON.stringify(["name"]),
    limit_page_length: "1",
  });
  const res = await erpnextFetch(env, `/api/resource/${doctype}?${qs}`);
  if (!res.ok) return null;
  let j: unknown;
  try {
    j = await res.json();
  } catch {
    return null;
  }
  const rows =
    j &&
    typeof j === "object" &&
    "data" in j &&
    Array.isArray((j as { data: unknown }).data)
      ? (j as { data: unknown[] }).data
      : [];
  const row = rows[0] as { name?: string } | undefined;
  return typeof row?.name === "string" ? row.name : null;
}

async function postErpResource(
  env: ErpnextEnv,
  doctype: "Customer" | "Supplier",
  payload: Record<string, unknown>
): Promise<void> {
  const res = await erpnextFetch(env, `/api/resource/${doctype}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const frappeMsg = extractFrappeMessage(parsed) ?? text.slice(0, 500);
    if (res.status === 403) {
      throw new Error(
        `ERPNext permission denied (${doctype}): The User tied to your API key cannot create ${doctype} records. In ERPNext, open that User (e.g. nextjs_api@…), assign roles that grant Create on ${doctype} — typically "Sales User" for Customer and "Purchase User" for Supplier — or add Role Permissions for your custom roles. Details: ${frappeMsg}`
      );
    }
    throw new Error(`${doctype} ${res.status}: ${frappeMsg}`);
  }
}

async function putErpResource(
  env: ErpnextEnv,
  doctype: "Customer" | "Supplier",
  name: string,
  payload: Record<string, unknown>
): Promise<void> {
  const res = await erpnextFetch(
    env,
    `/api/resource/${doctype}/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const frappeMsg = extractFrappeMessage(parsed) ?? text.slice(0, 500);
    throw new Error(`${doctype} PUT ${res.status}: ${frappeMsg}`);
  }
}

async function upsertCustomer(
  env: ErpnextEnv,
  payload: Record<string, unknown>,
  userEmail: string
): Promise<void> {
  const withEmail = userEmail
    ? { ...payload, email_id: userEmail }
    : payload;
  const existing = userEmail
    ? await fetchFirstDocName(env, "Customer", userEmail)
    : null;
  if (existing) {
    await putErpResource(env, "Customer", existing, withEmail);
  } else {
    await postErpResource(env, "Customer", withEmail);
  }
}

async function upsertSupplier(
  env: ErpnextEnv,
  payload: Record<string, unknown>,
  userEmail: string
): Promise<void> {
  const withEmail = userEmail
    ? { ...payload, email_id: userEmail }
    : payload;
  const existing = userEmail
    ? await fetchFirstDocName(env, "Supplier", userEmail)
    : null;
  if (existing) {
    await putErpResource(env, "Supplier", existing, withEmail);
  } else {
    await postErpResource(env, "Supplier", withEmail);
  }
}

/**
 * Create or update Customer / Supplier (matched by `email_id` when `userEmail` is set).
 */
export async function upsertKycBusinessEntities(
  env: ErpnextEnv,
  fields: KycFormFields,
  userEmail: string
): Promise<void> {
  const plan = parseOrgPlan(fields.organizationType);
  if (!plan) {
    throw new Error(
      "Invalid or missing organizationType. Expected manufacturer, pharmacy, hospital, importer, or wholesaler."
    );
  }

  const {
    companyName,
    taxId,
    custom_business_license_no,
    custom_efda_license_no,
  } = entityBasePayload(fields);

  const remarks = remarksFromContact(fields);
  const baseCustomer = {
    customer_name: companyName,
    tax_id: taxId,
    custom_business_license_no,
    custom_efda_license_no,
    ...(remarks ? { remarks } : {}),
  };
  const baseSupplier = {
    supplier_name: companyName,
    tax_id: taxId,
    custom_business_license_no,
    custom_efda_license_no,
    ...(remarks ? { remarks } : {}),
  };

  if (plan.kind === "customer") {
    await upsertCustomer(env, {
      ...baseCustomer,
      customer_group: plan.customerGroup,
    }, userEmail);
  } else if (plan.kind === "supplier") {
    await upsertSupplier(env, {
      ...baseSupplier,
      supplier_group: plan.supplierGroup,
    }, userEmail);
  } else {
    await upsertCustomer(env, {
      ...baseCustomer,
      customer_group: plan.customerGroup,
    }, userEmail);
    await upsertSupplier(env, {
      ...baseSupplier,
      supplier_group: plan.supplierGroup,
    }, userEmail);
  }
}

/** @deprecated Use upsertKycBusinessEntities(env, fields, userEmail) */
export async function createBusinessEntities(
  env: ErpnextEnv,
  fields: KycFormFields,
  userEmail?: string
): Promise<void> {
  await upsertKycBusinessEntities(env, fields, userEmail ?? "");
}

export async function uploadSingleKycFile(
  env: ErpnextEnv,
  file: File,
  userDocName: string
): Promise<void> {
  const res = await erpnextFetchMultipart(
    env,
    "/api/method/upload_file",
    () => {
      const fd = new FormData();
      fd.append("file", file, file.name);
      fd.append("is_private", "1");
      fd.append("doctype", "User");
      fd.append("docname", userDocName);
      return fd;
    }
  );
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const msg = extractFrappeMessage(parsed) ?? text.slice(0, 400);
    throw new Error(`upload_file: HTTP ${res.status} ${msg}`);
  }
}

export async function uploadKycFiles(
  env: ErpnextEnv,
  form: FormData,
  userDocName: string
): Promise<void> {
  const files: { label: string; file: File }[] = [];
  const bl = form.get("businessLicenseFile");
  const ef = form.get("efdaLicenseFile");
  const tx = form.get("taxpayerCertFile") ?? form.get("tinCertificateFile");

  if (bl instanceof File && bl.size > 0) {
    files.push({ label: "businessLicenseFile", file: bl });
  }
  if (ef instanceof File && ef.size > 0) {
    files.push({ label: "efdaLicenseFile", file: ef });
  }
  if (tx instanceof File && tx.size > 0) {
    files.push({ label: "taxpayerCertFile", file: tx });
  }

  if (files.length === 0) {
    throw new Error("No KYC files provided.");
  }

  const errors: string[] = [];

  for (const { label, file } of files) {
    try {
      await uploadSingleKycFile(env, file, userDocName);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${label}: ${msg}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join(" | "));
  }
}

/** String fields from multipart KYC forms (excludes file inputs). */
export function collectKycStringFieldsFromForm(form: FormData): KycFormFields {
  const out: KycFormFields = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") continue;
    if (
      key === "businessLicenseFile" ||
      key === "efdaLicenseFile" ||
      key === "taxpayerCertFile" ||
      key === "tinCertificateFile"
    ) {
      continue;
    }
    (out as Record<string, string>)[key] = value;
  }
  return out;
}

/** Upsert Customer/Supplier and upload all attached KYC files (full submission). */
export async function runFullKycPipeline(
  env: ErpnextEnv,
  form: FormData,
  userDocName: string
): Promise<void> {
  const organizationType = String(form.get("organizationType") ?? "").trim();
  const companyName = String(form.get("companyName") ?? "").trim();
  const tin = String(form.get("tin") ?? "").trim();
  const businessLicenseNo = String(form.get("businessLicenseNo") ?? "").trim();
  const efdaLicenseNo = String(form.get("efdaLicenseNo") ?? "").trim();

  const fields: KycFormFields = {
    ...collectKycStringFieldsFromForm(form),
    organizationType,
    companyName,
    tin,
    businessLicenseNo,
    efdaLicenseNo,
  };

  await upsertKycBusinessEntities(env, fields, userDocName);
  await uploadKycFiles(env, form, userDocName);
}
