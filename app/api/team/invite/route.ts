import { randomBytes } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { NotificationType, OrganizationKind, TeamRole } from "@prisma/client";
import { Resend } from "resend";

import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { createNotification } from "@/lib/notifications-service";
import { prisma } from "@/lib/prisma";
import { getSessionPayload } from "@/lib/session";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionPayload();
    if (!session?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const teamRole = session.teamRole;
    if (teamRole !== "OWNER" && teamRole !== "DIRECTOR") {
      return NextResponse.json(
        { error: "Only Owners and Directors can invite team members." },
        { status: 403 }
      );
    }

    const organizationId = session.organizationId?.trim();
    const organizationKind = session.organizationKind;
    if (!organizationId || !organizationKind) {
      return NextResponse.json(
        { error: "Organization context missing from session." },
        { status: 403 }
      );
    }

    let body: {
      email?: string;
      firstName?: string;
      lastName?: string;
      role?: string;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const email = String(body.email ?? "").trim().toLowerCase();
    const firstName = String(body.firstName ?? "").trim();
    const lastName = String(body.lastName ?? "").trim();
    const roleRaw = String(body.role ?? "").trim();

    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
    }
    if (!firstName || !lastName) {
      return NextResponse.json(
        { error: "First name and last name are required." },
        { status: 400 }
      );
    }

    if (roleRaw !== "DIRECTOR" && roleRaw !== "PHARMACIST") {
      return NextResponse.json(
        { error: "Role must be DIRECTOR or PHARMACIST." },
        { status: 400 }
      );
    }

    const role = roleRaw as "DIRECTOR" | "PHARMACIST";

    if (teamRole === "DIRECTOR" && role === "DIRECTOR") {
      return NextResponse.json(
        { error: "Only Owners can invite Directors." },
        { status: 403 }
      );
    }

    const existing = await prisma.teamMember.findFirst({
      where: { email, organizationId },
    });
    if (existing) {
      return NextResponse.json(
        { error: "This person is already part of the organization." },
        { status: 400 }
      );
    }

    const env = readErpnextEnv();
    if ("error" in env) {
      return NextResponse.json({ error: env.error }, { status: 500 });
    }

    const tempPassword = randomBytes(6).toString("hex");

    const userPayload = {
      email,
      first_name: firstName,
      last_name: lastName,
      send_welcome_email: 0,
      new_password: tempPassword,
    };

    const userRes = await erpnextFetch(env, "/api/resource/User", {
      method: "POST",
      body: JSON.stringify(userPayload),
    });
    const userJson = await userRes.json().catch(() => ({}));
    if (!userRes.ok) {
      const msg = JSON.stringify(userJson);
      const duplicate =
        userRes.status === 409 ||
        /duplicate|already exists|UniqueViolation/i.test(msg);
      if (!duplicate) {
        return NextResponse.json(
          {
            error:
              typeof userJson === "object" &&
              userJson !== null &&
              "exception" in userJson &&
              typeof (userJson as { exception?: string }).exception === "string"
                ? (userJson as { exception: string }).exception.slice(0, 500)
                : "Could not create user in ERPNext.",
          },
          { status: 502 }
        );
      }
    }

    const linkDoctype =
      organizationKind === "SUPPLIER" ? "Supplier" : "Customer";

    const contactPayload = {
      first_name: firstName,
      last_name: lastName,
      email_id: email,
      links: [
        {
          link_doctype: linkDoctype,
          link_name: organizationId,
        },
      ],
    };

    const contactRes = await erpnextFetch(env, "/api/resource/Contact", {
      method: "POST",
      body: JSON.stringify(contactPayload),
    });
    if (!contactRes.ok) {
      const contactErr = await contactRes.json().catch(() => ({}));
      console.error("[team/invite] Contact create failed:", contactErr);
      return NextResponse.json(
        { error: "Could not create contact in ERPNext." },
        { status: 502 }
      );
    }

    await prisma.teamMember.create({
      data: {
        email,
        organizationId,
        organizationKind:
          organizationKind === "SUPPLIER"
            ? OrganizationKind.SUPPLIER
            : OrganizationKind.CUSTOMER,
        role: role === "DIRECTOR" ? TeamRole.DIRECTOR : TeamRole.PHARMACIST,
        invitedBy: session.email,
        status: "PENDING",
      },
    });

    const secretRaw = process.env.RESET_TOKEN_SECRET;
    if (!secretRaw) {
      console.error("[team/invite] RESET_TOKEN_SECRET is not set.");
      return NextResponse.json(
        { error: "Server configuration error." },
        { status: 500 }
      );
    }
    const secret = new TextEncoder().encode(secretRaw);

    const inviteToken = await new SignJWT({
      email,
      organizationId,
      role,
      type: "team-invite",
      organizationKind,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("48h")
      .sign(secret);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
    if (!baseUrl) {
      console.error("[team/invite] NEXT_PUBLIC_APP_URL is not set.");
      return NextResponse.json(
        { error: "Server configuration error." },
        { status: 500 }
      );
    }

    const acceptLink = `${baseUrl}/invite/accept?token=${encodeURIComponent(inviteToken)}`;
    const safeOrg = escapeHtml(organizationId);
    const safeRole = escapeHtml(role);

    const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#18181b;">
  <p>You have been invited to join <strong>${safeOrg}</strong> on the BAMYS Pharmaceutical Marketplace.</p>
  <p>Your role: <strong>${safeRole}</strong></p>
  <p><a href="${acceptLink}" style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">Accept invitation</a></p>
  <p style="font-size:12px;color:#71717a;">Automated message from BAMYS. Do not reply.</p>
</body></html>`;

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("[team/invite] RESEND_API_KEY is not set.");
      return NextResponse.json(
        { error: "Server configuration error." },
        { status: 500 }
      );
    }

    const to =
      process.env.NODE_ENV === "development" && process.env.DEV_EMAIL_OVERRIDE
        ? process.env.DEV_EMAIL_OVERRIDE
        : email;

    const resend = new Resend(apiKey);
    const { error: sendErr } = await resend.emails.send({
      from: "noreply@qevira.michaelalene.com",
      to,
      subject: "You have been invited to join BAMYS",
      html,
    });

    if (sendErr) {
      console.error("[team/invite] Resend error:", sendErr);
      return NextResponse.json(
        { error: "Invitation saved but email could not be sent." },
        { status: 502 }
      );
    }

    await createNotification(
      email,
      "You have been invited to join Qevira",
      `You have been invited to join as ${role}. Check your email to accept the invitation.`,
      NotificationType.TEAM_INVITE,
      "/invite/accept"
    );

    return NextResponse.json({ ok: true, message: "Invitation sent." });
  } catch (e) {
    console.error("[team/invite]", e);
    return NextResponse.json(
      { error: "Something went wrong." },
      { status: 500 }
    );
  }
}
