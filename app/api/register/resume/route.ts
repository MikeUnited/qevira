import { NextResponse } from "next/server";

import { decryptBankAccountNumberStored } from "@/lib/bank-account-storage";
import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { parseFullNameToParts } from "@/lib/parse-full-name";
import { prisma } from "@/lib/prisma";
import { getSessionEmail } from "@/lib/session";
import type { KycBankAccountDraft } from "@/lib/validation/kyc-bank";

/** Matches minimal registration placeholder profile in `register/init`. */
const PLACEHOLDER_FIRST = "Pending";

type ResumeFormData = {
  registerMode: "email" | "phone";
  fullName: string;
  email: string;
  phone: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string;
  password: string;
  confirmPassword: string;
  agreedToTerms: boolean;
  otp: { digits: [string, string, string, string, string, string] };
  organizationType: string;
  companyName: string;
  contactPerson: string;
  businessLicenseNo: string;
  efdaLicenseNo: string;
  tin: string;
  bankAccounts: KycBankAccountDraft[];
  businessLicenseFile: null;
  efdaLicenseFile: null;
  tinCertificateFile: null;
};

function emptyFormData(email: string): ResumeFormData {
  return {
    registerMode: "email",
    fullName: "",
    email,
    phone: "",
    firstName: "",
    middleName: "",
    lastName: "",
    dob: "",
    password: "",
    confirmPassword: "",
    agreedToTerms: false,
    otp: { digits: ["", "", "", "", "", ""] },
    organizationType: "",
    companyName: "",
    contactPerson: "",
    businessLicenseNo: "",
    efdaLicenseNo: "",
    tin: "",
    bankAccounts: [],
    businessLicenseFile: null,
    efdaLicenseFile: null,
    tinCertificateFile: null,
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeDob(raw: string): string {
  if (!raw) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return m ? m[1] : raw.slice(0, 10);
}

type ErpListRow = Record<string, unknown>;

function parseListPayload(json: unknown): ErpListRow[] {
  if (!json || typeof json !== "object") return [];
  const data = (json as { data?: unknown }).data;
  return Array.isArray(data) ? (data as ErpListRow[]) : [];
}

function parseSingleDoc(json: unknown): ErpListRow | undefined {
  if (!json || typeof json !== "object") return undefined;
  const data = (json as { data?: unknown }).data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as ErpListRow;
  }
  return undefined;
}

/** `remarks` format from `register-kyc` upsert: `Primary contact: …` */
function contactPersonFromRemarks(remarks: string): string {
  const trimmed = remarks.trim();
  const prefix = "Primary contact: ";
  if (!trimmed.startsWith(prefix)) return "";
  return trimmed.slice(prefix.length).trim();
}

function deriveOrganizationType(
  supplier: ErpListRow | undefined,
  customer: ErpListRow | undefined
): string {
  const sg = str(supplier?.supplier_group);
  const cg = str(customer?.customer_group);
  if (sg === "Manufacturer") return "manufacturer";
  if (sg === "Importer" || cg === "Importer") return "importer";
  if (sg === "Wholesaler" || cg === "Wholesaler") return "wholesaler";
  if (cg === "Pharmacy") return "pharmacy";
  if (cg === "Hospital") return "hospital";
  return "";
}

function computeSuggestedStep(args: {
  firstNameRaw: string;
  companyName: string;
  efdaLicenseNo: string;
  tin: string;
}): number {
  const hasRealFirstName =
    Boolean(args.firstNameRaw) && args.firstNameRaw !== PLACEHOLDER_FIRST;
  if (!hasRealFirstName) return 3;
  if (!args.companyName) return 4;
  const hasEfda = Boolean(args.efdaLicenseNo);
  const hasTin = Boolean(args.tin);
  if (!hasEfda && !hasTin) return 5;
  if (!hasTin) return 6;
  return 7;
}

export async function GET() {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionEmail = email.toLowerCase();
  const teamMember = await prisma.teamMember.findFirst({
    where: {
      email: sessionEmail,
      status: "ACCEPTED",
    },
  });

  // Invited team members inherit organization KYC status
  // They do not need to complete individual KYC wizard
  if (teamMember) {
    return NextResponse.json({
      formData: emptyFormData(email),
      suggestedStep: 6,
    });
  }

  const env = readErpnextEnv();
  if ("error" in env) {
    return NextResponse.json({
      formData: emptyFormData(email),
      suggestedStep: 3,
    });
  }

  const userFields = ["first_name", "last_name", "mobile_no", "birth_date"];
  const userPath = `/api/resource/User/${encodeURIComponent(email)}?fields=${encodeURIComponent(JSON.stringify(userFields))}`;

  const supplierListQs = new URLSearchParams({
    filters: JSON.stringify([["email_id", "=", email]]),
    fields: JSON.stringify(["name", "supplier_name"]),
    limit_page_length: "1",
  });

  const customerListQs = new URLSearchParams({
    filters: JSON.stringify([["email_id", "=", email]]),
    fields: JSON.stringify(["name", "customer_name"]),
    limit_page_length: "1",
  });

  const supplierDocQs = new URLSearchParams({
    fields: JSON.stringify([
      "supplier_name",
      "tax_id",
      "custom_efda_license_no",
      "custom_business_license_no",
      "supplier_group",
      "remarks",
    ]),
  });

  const customerDocQs = new URLSearchParams({
    fields: JSON.stringify([
      "customer_name",
      "tax_id",
      "custom_efda_license_no",
      "custom_business_license_no",
      "customer_group",
      "remarks",
    ]),
  });

  try {
    const [userRes, supplierListRes, customerListRes] = await Promise.all([
      erpnextFetch(env, userPath, { cache: "no-store" }),
      erpnextFetch(env, `/api/resource/Supplier?${supplierListQs}`, {
        cache: "no-store",
      }),
      erpnextFetch(env, `/api/resource/Customer?${customerListQs}`, {
        cache: "no-store",
      }),
    ]);

    if (!userRes.ok) {
      return NextResponse.json({
        formData: emptyFormData(email),
        suggestedStep: 3,
      });
    }

    const userJson = (await userRes.json()) as unknown;

    const userDoc =
      userJson &&
      typeof userJson === "object" &&
      "data" in userJson &&
      (userJson as { data: unknown }).data &&
      typeof (userJson as { data: unknown }).data === "object"
        ? ((userJson as { data: Record<string, unknown> }).data as Record<
            string,
            unknown
          >)
        : null;

    if (!userDoc) {
      return NextResponse.json({
        formData: emptyFormData(email),
        suggestedStep: 3,
      });
    }

    let supplierId = "";
    if (supplierListRes.ok) {
      try {
        const listJson = await supplierListRes.json();
        const row = parseListPayload(listJson)[0];
        const name = row?.name;
        if (typeof name === "string" && name.trim()) {
          supplierId = name.trim();
        }
      } catch {
        /* ignore */
      }
    }

    let customerId = "";
    if (customerListRes.ok) {
      try {
        const listJson = await customerListRes.json();
        const row = parseListPayload(listJson)[0];
        const name = row?.name;
        if (typeof name === "string" && name.trim()) {
          customerId = name.trim();
        }
      } catch {
        /* ignore */
      }
    }

    let supplier: ErpListRow | undefined;
    let customer: ErpListRow | undefined;

    await Promise.all([
      (async () => {
        if (!supplierId) return;
        const supplierDocRes = await erpnextFetch(
          env,
          `/api/resource/Supplier/${encodeURIComponent(supplierId)}?${supplierDocQs}`,
          { cache: "no-store" }
        );
        if (!supplierDocRes.ok) return;
        try {
          const j = await supplierDocRes.json();
          supplier = parseSingleDoc(j);
        } catch {
          /* ignore */
        }
      })(),
      (async () => {
        if (!customerId) return;
        const customerDocRes = await erpnextFetch(
          env,
          `/api/resource/Customer/${encodeURIComponent(customerId)}?${customerDocQs}`,
          { cache: "no-store" }
        );
        if (!customerDocRes.ok) return;
        try {
          const j = await customerDocRes.json();
          customer = parseSingleDoc(j);
        } catch {
          /* ignore */
        }
      })(),
    ]);

    const firstNameRaw = str(userDoc.first_name);
    const lastNameRaw = str(userDoc.last_name);
    const fullName = [firstNameRaw, lastNameRaw].filter(Boolean).join(" ");
    const { firstName, middleName, lastName } =
      parseFullNameToParts(fullName);

    const companyName =
      str(supplier?.supplier_name) || str(customer?.customer_name) || "";

    const efdaLicenseNo =
      str(supplier?.custom_efda_license_no) ||
      str(customer?.custom_efda_license_no) ||
      "";

    const businessLicenseNo =
      str(supplier?.custom_business_license_no) ||
      str(customer?.custom_business_license_no) ||
      "";

    const tin = str(supplier?.tax_id) || str(customer?.tax_id) || "";

    const remarksRaw =
      str(supplier?.remarks) || str(customer?.remarks);
    const contactPerson = contactPersonFromRemarks(remarksRaw);

    const organizationType = deriveOrganizationType(supplier, customer);

    let bankRows: KycBankAccountDraft[] = [];
    try {
      const stored = await prisma.bankAccount.findMany({
        where: { profileId: email },
        orderBy: [{ isPrimary: "desc" }, { accountNumber: "asc" }],
      });
      bankRows = (stored ?? []).map((r) => ({
        id: r.id,
        bankName: r.bankName,
        branchName: r.branchName,
        accountName: r.accountName,
        accountNumber: decryptBankAccountNumberStored(r.accountNumber),
        isPrimary: r.isPrimary,
      }));
    } catch (e) {
      console.error("[api/register/resume] bankAccount load", e);
      bankRows = [];
    }

    const formData: ResumeFormData = {
      ...emptyFormData(email),
      registerMode: "email",
      fullName,
      firstName: firstName || firstNameRaw,
      middleName,
      lastName: lastName || lastNameRaw,
      phone: str(userDoc.mobile_no),
      dob: normalizeDob(str(userDoc.birth_date)),
      organizationType,
      contactPerson,
      companyName,
      businessLicenseNo,
      efdaLicenseNo,
      tin,
      bankAccounts: bankRows,
    };

    const suggestedStep = computeSuggestedStep({
      firstNameRaw,
      companyName,
      efdaLicenseNo,
      tin,
    });

    return NextResponse.json({ formData, suggestedStep });
  } catch (e) {
    console.error("[api/register/resume]", e);
    return NextResponse.json({
      formData: emptyFormData(email),
      suggestedStep: 3,
    });
  }
}
