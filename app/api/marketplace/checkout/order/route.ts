import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { cookies } from "next/headers";

import { executeMarketplaceCheckoutOrder } from "@/lib/marketplace-checkout-execute";
import { getBuyerContext } from "@/lib/get-buyer-profile";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { getUserProfile } from "@/lib/server-user-profile";
import { decrypt, SESSION_COOKIE } from "@/lib/session";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const sessionPayload = await decrypt(sessionToken);
  const sessionEmail =
    typeof sessionPayload?.email === "string"
      ? sessionPayload.email.trim()
      : "";
  if (!sessionEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const buyerCtx = await getBuyerContext(sessionEmail);
  if (!buyerCtx) {
    const profile = await getUserProfile();
    if (!profile.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Must be a registered buyer to place an order." },
      { status: 403 }
    );
  }

  const roleGate = await requireRole(request, ["OWNER", "DIRECTOR"], {
    allowMissingRole: true,
    pharmacistDeniedMessage:
      "Pharmacists cannot place orders. Please ask a Director or Owner to confirm this purchase.",
  });
  if (roleGate instanceof Response) {
    return roleGate;
  }

  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim();
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "Missing idempotency key." },
      { status: 400 }
    );
  }

  let idempotencyLockHeld = false;
  const releaseIdempotencyLockIfHeld = async () => {
    if (!idempotencyLockHeld) return;
    try {
      await prisma.idempotencyRecord.delete({ where: { key: idempotencyKey } });
    } catch {
      // ignore
    }
  };

  try {
    await prisma.idempotencyRecord.create({
      data: {
        key: idempotencyKey,
        userId: sessionEmail,
        response: "STARTED",
      },
    });
    idempotencyLockHeld = true;
  } catch (e) {
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
    ) {
      return NextResponse.json(
        { error: "Idempotency check failed." },
        { status: 500 }
      );
    }
    const existing = await prisma.idempotencyRecord.findUnique({
      where: { key: idempotencyKey },
    });
    if (!existing) {
      console.error(
        "[checkout/order] Idempotency duplicate-key race without persisted row."
      );
      return NextResponse.json(
        { error: "Idempotency check failed." },
        { status: 500 }
      );
    }
    if (existing.userId !== sessionEmail) {
      return NextResponse.json(
        { error: "Idempotency key mismatch." },
        { status: 403 }
      );
    }
    if (existing.response === "STARTED") {
      const ageMs = Date.now() - existing.createdAt.getTime();
      if (ageMs > 5 * 60 * 1000) {
        await prisma.idempotencyRecord.delete({
          where: { key: idempotencyKey },
        });
        return NextResponse.json(
          { error: "Previous request timed out. Please retry." },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Request already in progress. Please wait." },
        { status: 409 }
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing.response);
    } catch {
      return NextResponse.json(
        { error: "Idempotency check failed." },
        { status: 500 }
      );
    }
    return NextResponse.json(parsed, { status: 200 });
  }

  return executeMarketplaceCheckoutOrder({
    cartOwnerUserId: sessionEmail,
    buyerCustomerName: buyerCtx.customerId,
    buyerNotificationEmail: sessionEmail,
    idempotencyKey,
    releaseIdempotencyLockIfHeld,
  });
}
