import { NextRequest, NextResponse } from "next/server";
import { TeamRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getSessionPayload } from "@/lib/session";

export async function GET() {
  const session = await getSessionPayload();
  if (!session?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const organizationId = session.organizationId?.trim();
  if (!organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await prisma.teamMember.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      status: r.status,
      invitedBy: r.invitedBy,
      createdAt: r.createdAt.toISOString(),
    }))
  );
}

export async function DELETE(req: NextRequest) {
  const session = await getSessionPayload();
  if (!session?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teamRole = session.teamRole;
  const organizationId = session.organizationId?.trim();
  if (!organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { memberId?: string };
  try {
    body = (await req.json()) as { memberId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const memberId = String(body.memberId ?? "").trim();
  if (!memberId) {
    return NextResponse.json({ error: "memberId is required." }, { status: 400 });
  }

  const target = await prisma.teamMember.findFirst({
    where: { id: memberId },
  });

  if (!target || target.organizationId !== organizationId) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  if (target.role === TeamRole.OWNER) {
    return NextResponse.json(
      { error: "Cannot revoke the organization owner." },
      { status: 403 }
    );
  }

  if (teamRole === "DIRECTOR") {
    if (target.role !== TeamRole.PHARMACIST) {
      return NextResponse.json(
        { error: "Directors can only revoke Pharmacists." },
        { status: 403 }
      );
    }
  } else if (teamRole === "OWNER") {
    // Owner may revoke non-owner members (already excluded OWNER above).
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.teamMember.update({
    where: { id: memberId },
    data: { status: "REVOKED" },
  });

  return NextResponse.json({ ok: true });
}
