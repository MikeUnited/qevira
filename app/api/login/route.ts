// Rate limiting migrated to Redis for persistence
// across server restarts and multi-instance deployments

import { NextRequest, NextResponse } from "next/server";
import { OrganizationKind } from "@prisma/client";

import { getClientIp } from "@/lib/client-ip";
import {
  checkRateLimit,
  getRateLimitCount,
  incrementRateLimitWithWindow,
  resetRateLimit,
} from "@/lib/rate-limit";
import { erpnextFetch, readErpnextEnv } from "@/lib/erpnext-auth";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";

type LoginBody = {
  email?: string;
  password?: string;
};

const WINDOW_SEC = 15 * 60;
const MAX_EMAIL_FAILS = 5;
const MAX_IP_ATTEMPTS = 10;

async function parseResourceList(
  res: Response
): Promise<Array<Record<string, unknown>>> {
  if (!res.ok) return [];
  try {
    const j = (await res.json()) as { data?: unknown[] };
    const rows = Array.isArray(j.data) ? j.data : [];
    return rows.filter(
      (r): r is Record<string, unknown> =>
        r !== null && typeof r === "object" && !Array.isArray(r)
    );
  } catch {
    return [];
  }
}

/**
 * Original registrant: ERPNext Customer or Supplier for this email.
 * Prefers Customer when both exist (marketplace buyer org).
 */
async function resolveOwnerOrganization(
  email: string
): Promise<{ id: string; kind: OrganizationKind } | null> {
  const env = readErpnextEnv();
  if ("error" in env) {
    return null;
  }
  const customerQs = new URLSearchParams({
    filters: JSON.stringify([["email_id", "=", email]]),
    fields: JSON.stringify(["name"]),
    limit_page_length: "1",
  });
  const supplierQs = new URLSearchParams({
    filters: JSON.stringify([["email_id", "=", email]]),
    fields: JSON.stringify(["name"]),
    limit_page_length: "1",
  });
  const [customerRes, supplierRes] = await Promise.all([
    erpnextFetch(env, `/api/resource/Customer?${customerQs}`, {
      cache: "no-store",
    }),
    erpnextFetch(env, `/api/resource/Supplier?${supplierQs}`, {
      cache: "no-store",
    }),
  ]);
  const [customerRows, supplierRows] = await Promise.all([
    parseResourceList(customerRes),
    parseResourceList(supplierRes),
  ]);
  const custName =
    customerRows[0] && typeof customerRows[0].name === "string"
      ? customerRows[0].name.trim()
      : "";
  if (custName) {
    return { id: custName, kind: OrganizationKind.CUSTOMER };
  }
  const supName =
    supplierRows[0] && typeof supplierRows[0].name === "string"
      ? supplierRows[0].name.trim()
      : "";
  if (supName) {
    return { id: supName, kind: OrganizationKind.SUPPLIER };
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: LoginBody;
  try {
    body = (await req.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  const emailKey = email.toLowerCase();
  const ip = getClientIp(req);

  const emailKeyFull = `ratelimit:login:email:${emailKey}`;
  if ((await getRateLimitCount(emailKeyFull)) >= MAX_EMAIL_FAILS) {
    return NextResponse.json(
      {
        error:
          "Too many failed attempts. Your account has been temporarily locked. Please try again in 15 minutes or reset your password.",
        retryAfter: 900,
      },
      { status: 429 }
    );
  }

  const ipLimit = await checkRateLimit(
    `ratelimit:login:ip:${ip}`,
    MAX_IP_ATTEMPTS,
    WINDOW_SEC
  );
  if (!ipLimit.allowed) {
    return NextResponse.json(
      {
        error:
          "Too many login attempts from this network. Please try again in 15 minutes.",
        retryAfter: ipLimit.resetIn,
      },
      { status: 429 }
    );
  }

  const baseUrl = process.env.ERPNEXT_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  const siteName =
    process.env.ERPNEXT_SITE_NAME?.trim() ||
    process.env.FRAPPE_SITE?.trim() ||
    "";

  const loginUrl = `${baseUrl}/api/method/login`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (siteName) {
    headers["X-Frappe-Site-Name"] = siteName;
  }

  const erpRes = await fetch(loginUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ usr: email, pwd: password }),
  });

  if (!erpRes.ok) {
    const failCount = await incrementRateLimitWithWindow(emailKeyFull, WINDOW_SEC);
    const remainingAttempts = Math.max(0, MAX_EMAIL_FAILS - failCount);
    const payload: Record<string, unknown> = {
      error: "Invalid email or password.",
      attemptsRemaining: remainingAttempts,
    };
    if (remainingAttempts === 1) {
      payload.warning =
        "Warning: 1 attempt remaining before your account is temporarily locked.";
    }
    return NextResponse.json(payload, { status: 401 });
  }

  let data: unknown;
  try {
    data = await erpRes.json();
  } catch {
    data = null;
  }

  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (o.exc || o.exception) {
      const failCount = await incrementRateLimitWithWindow(emailKeyFull, WINDOW_SEC);
      const remainingAttempts = Math.max(0, MAX_EMAIL_FAILS - failCount);
      const payload: Record<string, unknown> = {
        error: "Invalid email or password.",
        attemptsRemaining: remainingAttempts,
      };
      if (remainingAttempts === 1) {
        payload.warning =
          "Warning: 1 attempt remaining before your account is temporarily locked.";
      }
      return NextResponse.json(payload, { status: 401 });
    }
  }

  await resetRateLimit(emailKeyFull);

  const normalizedEmail = email.toLowerCase();

  const teamMember = await prisma.teamMember.findFirst({
    where: {
      email: normalizedEmail,
      status: "ACCEPTED",
    },
  });

  if (teamMember) {
    await createSession(
      email,
      teamMember.role,
      teamMember.organizationId,
      teamMember.organizationKind === OrganizationKind.SUPPLIER
        ? "SUPPLIER"
        : "CUSTOMER"
    );
  } else {
    const ownerOrg = await resolveOwnerOrganization(email);
    if (ownerOrg) {
      await createSession(
        email,
        "OWNER",
        ownerOrg.id,
        ownerOrg.kind === OrganizationKind.SUPPLIER ? "SUPPLIER" : "CUSTOMER"
      );
    } else {
      await createSession(email);
    }
  }

  return NextResponse.json({ ok: true, message: "Logged in" });
}
