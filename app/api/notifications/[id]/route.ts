import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionEmail } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(_req: NextRequest, context: RouteContext) {
  const sessionEmail = await getSessionEmail();
  if (!sessionEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const notification = await prisma.notification.findFirst({
    where: { id: id.trim(), userId: sessionEmail },
  });

  if (!notification) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.notification.update({
    where: { id: notification.id },
    data: { isRead: !notification.isRead },
  });

  return NextResponse.json({ ok: true, isRead: updated.isRead });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const sessionEmail = await getSessionEmail();
  if (!sessionEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const existing = await prisma.notification.findFirst({
    where: { id: id.trim(), userId: sessionEmail },
  });

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.notification.delete({
    where: { id: existing.id },
  });

  return NextResponse.json({ ok: true });
}
