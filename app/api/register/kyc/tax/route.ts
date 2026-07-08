import { NextRequest, NextResponse } from "next/server";

import { readErpnextEnv } from "@/lib/erpnext-auth";
import { runFullKycPipeline } from "@/lib/register-kyc";
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
    const tin = String(form.get("tin") ?? "").trim();
    const businessLicenseNo = String(form.get("businessLicenseNo") ?? "").trim();
    const efdaLicenseNo = String(form.get("efdaLicenseNo") ?? "").trim();

    if (
      !organizationType ||
      !companyName ||
      !tin ||
      !businessLicenseNo ||
      !efdaLicenseNo
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: organization, company, TIN, and license numbers.",
        },
        { status: 400 }
      );
    }

    const tx = form.get("taxpayerCertFile") ?? form.get("tinCertificateFile");
    const hasTx = tx instanceof File && tx.size > 0;
    if (!hasTx) {
      return NextResponse.json(
        {
          error:
            "Taxpayer certificate is required (taxpayerCertFile or tinCertificateFile).",
        },
        { status: 400 }
      );
    }

    const env = readErpnextEnv();
    if ("error" in env) {
      return NextResponse.json({ error: env.error }, { status: 500 });
    }

    await runFullKycPipeline(env, form, sessionEmail);

    return NextResponse.json({ ok: true, message: "KYC completed" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/register/kyc/tax]", msg);

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
