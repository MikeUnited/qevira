import { NextRequest, NextResponse } from "next/server";

import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { extractFrappeMessage } from "@/lib/register-kyc";
import { isDobAtLeast18YearsOld } from "@/lib/dob-age";
import { parseFullNameToParts } from "@/lib/parse-full-name";
import { createSession, getSessionEmail } from "@/lib/session";

type Body = {
  registerMode?: "email" | "phone";
  fullName?: string;
  dob?: string;
  email?: string;
  phone?: string;
};

export async function PATCH(req: NextRequest) {
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
    const registerMode = body.registerMode === "phone" ? "phone" : "email";
    const fullName = String(body.fullName ?? "").trim();
    const dob = String(body.dob ?? "").trim();
    const emailIn = String(body.email ?? "").trim();
    const phoneIn = String(body.phone ?? "").trim();

    if (!fullName || !dob) {
      return NextResponse.json(
        { error: "Full name and date of birth are required." },
        { status: 400 }
      );
    }

    if (!isDobAtLeast18YearsOld(dob)) {
      return NextResponse.json(
        { error: "You must be at least 18 years old to register." },
        { status: 400 }
      );
    }

    if (registerMode === "email") {
      if (phoneIn.length < 6) {
        return NextResponse.json(
          { error: "Please enter a valid phone number." },
          { status: 400 }
        );
      }
    } else {
      if (emailIn.length < 4 || !emailIn.includes("@")) {
        return NextResponse.json(
          { error: "Please enter a valid email address." },
          { status: 400 }
        );
      }
    }

    const env = readErpnextEnv();
    if ("error" in env) {
      return NextResponse.json({ error: env.error }, { status: 500 });
    }

    const { firstName, middleName, lastName } = parseFullNameToParts(fullName);

    if (registerMode === "email") {
      const putPayload = {
        first_name: firstName,
        middle_name: middleName,
        last_name: lastName,
        birth_date: dob,
        mobile_no: phoneIn,
      };

      const putRes = await erpnextFetch(
        env,
        `/api/resource/User/${encodeURIComponent(sessionEmail)}`,
        {
          method: "PUT",
          body: JSON.stringify(putPayload),
        }
      );

      const text = await putRes.text();
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }

      if (!putRes.ok) {
        const msg =
          extractFrappeMessage(data) ??
          `ERPNext returned ${putRes.status}`;
        return NextResponse.json({ error: msg }, { status: putRes.status });
      }

      return NextResponse.json({ ok: true, message: "Profile updated" });
    }

    // Phone-first: User was created with a synthetic login email; optional rename to real email.
    const putPayload = {
      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
      birth_date: dob,
    };

    const putRes = await erpnextFetch(
      env,
      `/api/resource/User/${encodeURIComponent(sessionEmail)}`,
      {
        method: "PUT",
        body: JSON.stringify(putPayload),
      }
    );

    const putText = await putRes.text();
    let putData: unknown;
    try {
      putData = putText ? JSON.parse(putText) : null;
    } catch {
      putData = { raw: putText };
    }

    if (!putRes.ok) {
      const msg =
        extractFrappeMessage(putData) ?? `ERPNext returned ${putRes.status}`;
      return NextResponse.json({ error: msg }, { status: putRes.status });
    }

    const newEmail = emailIn.toLowerCase();
    if (newEmail !== sessionEmail.toLowerCase()) {
      const renameRes = await erpnextFetch(
        env,
        "/api/method/frappe.client.rename_doc",
        {
          method: "POST",
          body: JSON.stringify({
            args: ["User", sessionEmail, newEmail],
          }),
        }
      );

      const renameText = await renameRes.text();
      let renameData: unknown;
      try {
        renameData = renameText ? JSON.parse(renameText) : null;
      } catch {
        renameData = { raw: renameText };
      }

      if (!renameRes.ok) {
        const msg =
          extractFrappeMessage(renameData) ??
          "Could not set your login email. Try a different address or contact support.";
        return NextResponse.json({ error: msg }, { status: renameRes.status });
      }

      await createSession(newEmail);
    }

    return NextResponse.json({ ok: true, message: "Profile updated" });
  } catch (e) {
    console.error("[api/register/personal-details]", e);
    return NextResponse.json(
      { error: "Profile update unavailable" },
      { status: 502 }
    );
  }
}
