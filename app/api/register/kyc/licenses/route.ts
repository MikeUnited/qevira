import { NextRequest, NextResponse } from "next/server";

import { readErpnextEnv } from "@/lib/erpnext-auth";
import {
  collectKycStringFieldsFromForm,
  upsertKycBusinessEntities,
  uploadKycFiles,
  type KycFormFields,
} from "@/lib/register-kyc";
import { getSessionEmail } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const sessionEmail = await getSessionEmail();
    if (!sessionEmail) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Invalid multipart body" },
        { status: 400 }
      );
    }

    const organizationType = String(form.get("organizationType") ?? "").trim();
    const companyName = String(form.get("companyName") ?? "").trim();
    const contactPerson = String(form.get("contactPerson") ?? "").trim();
    const businessLicenseNo = String(form.get("businessLicenseNo") ?? "").trim();
    const efdaLicenseNo = String(form.get("efdaLicenseNo") ?? "").trim();

    if (
      !organizationType ||
      !companyName ||
      !contactPerson ||
      !businessLicenseNo ||
      !efdaLicenseNo
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: organization, company, contact, and both license numbers.",
        },
        { status: 400 }
      );
    }

    const bl = form.get("businessLicenseFile");
    const ef = form.get("efdaLicenseFile");
    const hasBl = bl instanceof File && bl.size > 0;
    const hasEf = ef instanceof File && ef.size > 0;
    if (!hasBl || !hasEf) {
      return NextResponse.json(
        {
          error:
            "Both license documents are required: businessLicenseFile and efdaLicenseFile.",
        },
        { status: 400 }
      );
    }

    const env = readErpnextEnv();
    if ("error" in env) {
      return NextResponse.json({ error: env.error }, { status: 500 });
    }

    const fields: KycFormFields = {
      ...collectKycStringFieldsFromForm(form),
      organizationType,
      companyName,
      contactPerson,
      tin: String(form.get("tin") ?? "").trim(),
      businessLicenseNo,
      efdaLicenseNo,
    };

    await upsertKycBusinessEntities(env, fields, sessionEmail);
    await uploadKycFiles(env, form, sessionEmail);

    return NextResponse.json({ ok: true, message: "Licenses saved" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/register/kyc/licenses]", msg);
    return NextResponse.json(
      { error: msg || "Could not save licenses" },
      { status: 422 }
    );
  }
}
