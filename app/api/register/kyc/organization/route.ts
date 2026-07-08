import { NextRequest, NextResponse } from "next/server";

import { readErpnextEnv } from "@/lib/erpnext-auth";
import { upsertKycBusinessEntities } from "@/lib/register-kyc";
import { getSessionEmail } from "@/lib/session";

type Body = {
  organizationType?: string;
  companyName?: string;
  contactPerson?: string;
};

export async function POST(req: NextRequest) {
  try {
    const sessionEmail = await getSessionEmail();
    if (!sessionEmail) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const body = raw as Body;
    const organizationType = String(body.organizationType ?? "").trim();
    const companyName = String(body.companyName ?? "").trim();
    const contactPerson = String(body.contactPerson ?? "").trim();

    if (!organizationType || !companyName || !contactPerson) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: organizationType, companyName, contactPerson.",
        },
        { status: 400 }
      );
    }

    const env = readErpnextEnv();
    if ("error" in env) {
      return NextResponse.json({ error: env.error }, { status: 500 });
    }

    await upsertKycBusinessEntities(
      env,
      {
        organizationType,
        companyName,
        contactPerson,
        tin: "",
        businessLicenseNo: "",
        efdaLicenseNo: "",
      },
      sessionEmail
    );

    return NextResponse.json({ ok: true, message: "Organization saved" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/register/kyc/organization]", msg);
    return NextResponse.json(
      { error: msg || "Could not save organization" },
      { status: 422 }
    );
  }
}
