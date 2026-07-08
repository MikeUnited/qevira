import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { OrganizationKind } from "@prisma/client";

import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    let body: { token?: string; password?: string };
    try {
      body = (await req.json()) as { token?: string; password?: string };
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const token = String(body.token ?? "").trim();
    const password = String(body.password ?? "");

    if (!token || !password) {
      return NextResponse.json(
        { error: "Token and password are required." },
        { status: 400 }
      );
    }

    const secretRaw = process.env.RESET_TOKEN_SECRET;
    if (!secretRaw) {
      console.error("[team/accept] RESET_TOKEN_SECRET is not set.");
      return NextResponse.json(
        { error: "Server configuration error." },
        { status: 500 }
      );
    }
    const secret = new TextEncoder().encode(secretRaw);

    let payload: {
      email?: string;
      organizationId?: string;
      role?: string;
      type?: string;
      organizationKind?: string;
    };
    try {
      const { payload: p } = await jwtVerify(token, secret);
      payload = p as typeof payload;
    } catch {
      return NextResponse.json(
        {
          error:
            "Invitation has expired. Please request a new one.",
        },
        { status: 400 }
      );
    }

    if (payload.type !== "team-invite") {
      return NextResponse.json(
        {
          error:
            "Invitation has expired. Please request a new one.",
        },
        { status: 400 }
      );
    }

    const email = String(payload.email ?? "").trim().toLowerCase();
    const organizationId = String(payload.organizationId ?? "").trim();
    const roleRaw = String(payload.role ?? "").trim();

    if (!email || !organizationId || !roleRaw) {
      return NextResponse.json(
        {
          error:
            "Invitation has expired. Please request a new one.",
        },
        { status: 400 }
      );
    }

    if (roleRaw !== "OWNER" && roleRaw !== "DIRECTOR" && roleRaw !== "PHARMACIST") {
      return NextResponse.json(
        {
          error:
            "Invitation has expired. Please request a new one.",
        },
        { status: 400 }
      );
    }

    const updated = await prisma.teamMember.update({
      where: {
        email_organizationId: {
          email,
          organizationId,
        },
      },
      data: { status: "ACCEPTED" },
    });

    const env = readErpnextEnv();
    if ("error" in env) {
      return NextResponse.json({ error: env.error }, { status: 500 });
    }

    const userRes = await erpnextFetch(
      env,
      `/api/resource/User/${encodeURIComponent(email)}`,
      {
        method: "PUT",
        body: JSON.stringify({ new_password: password }),
      }
    );
    if (!userRes.ok) {
      const errText = await userRes.text().catch(() => "");
      console.error("[team/accept] User password update failed:", errText.slice(0, 500));
    }

    await createSession(
      email,
      updated.role,
      updated.organizationId,
      updated.organizationKind === OrganizationKind.SUPPLIER
        ? "SUPPLIER"
        : "CUSTOMER"
    );

    return NextResponse.json({ ok: true, redirect: "/dashboard" });
  } catch (e) {
    console.error("[team/accept]", e);
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code?: string }).code === "P2025"
    ) {
      return NextResponse.json(
        {
          error:
            "Invitation has expired. Please request a new one.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Something went wrong." },
      { status: 500 }
    );
  }
}
