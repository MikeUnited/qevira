import { NextRequest, NextResponse } from "next/server";

import { readErpnextEnv } from "@/lib/erpnext-auth";
import { runFullKycPipeline } from "@/lib/register-kyc";

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart body" },
      { status: 400 }
    );
  }

  try {
    const env = readErpnextEnv();
    if ("error" in env) {
      return NextResponse.json({ error: env.error }, { status: 500 });
    }

    const email = String(form.get("email") ?? "").trim();
    if (!email) {
      return NextResponse.json(
        { error: "Missing required field: email." },
        { status: 400 }
      );
    }

    const organizationType = String(form.get("organizationType") ?? "").trim();
    const companyName = String(form.get("companyName") ?? "").trim();
    const tin = String(form.get("tin") ?? "").trim();
    const businessLicenseNo = String(form.get("businessLicenseNo") ?? "").trim();
    const efdaLicenseNo = String(form.get("efdaLicenseNo") ?? "").trim();

    if (!organizationType || !companyName || !tin || !businessLicenseNo || !efdaLicenseNo) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: organizationType, companyName, tin, businessLicenseNo, efdaLicenseNo.",
        },
        { status: 400 }
      );
    }

    const bl = form.get("businessLicenseFile");
    const ef = form.get("efdaLicenseFile");
    const tx = form.get("taxpayerCertFile") ?? form.get("tinCertificateFile");

    const hasBl = bl instanceof File && bl.size > 0;
    const hasEf = ef instanceof File && ef.size > 0;
    const hasTx = tx instanceof File && tx.size > 0;

    if (!hasBl || !hasEf || !hasTx) {
      return NextResponse.json(
        {
          error:
            "All three files are required: businessLicenseFile, efdaLicenseFile, taxpayerCertFile (or tinCertificateFile).",
        },
        { status: 400 }
      );
    }

    await runFullKycPipeline(env, form, email);

    return NextResponse.json(
      {
        ok: true,
        message: "KYC completed",
        userId: email,
      },
      { status: 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/register/complete]", msg);

    const isPermission =
      msg.includes("ERPNext permission denied") ||
      msg.includes("PermissionError") ||
      msg.includes("No permission for");
    if (isPermission) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }

    if (
      msg.includes("Customer") ||
      msg.includes("Supplier") ||
      msg.includes("organizationType")
    ) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }

    return NextResponse.json(
      { error: "KYC processing failed. Try again or contact support." },
      { status: 500 }
    );
  }
}
