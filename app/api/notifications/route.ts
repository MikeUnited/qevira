import { NextRequest, NextResponse } from "next/server";

import {
  getNotifications,
  getUnreadCount,
} from "@/lib/notifications-service";
import { prisma } from "@/lib/prisma";
import { getSessionEmail } from "@/lib/session";

export async function GET() {
  const sessionEmail = await getSessionEmail();
  if (!sessionEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [notifications, unreadCount] = await Promise.all([
    getNotifications(sessionEmail),
    getUnreadCount(sessionEmail),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}

export async function PATCH(req: NextRequest) {
  const sessionEmail = await getSessionEmail();
  if (!sessionEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const markAllRead =
    body &&
    typeof body === "object" &&
    "markAllRead" in body &&
    (body as { markAllRead?: unknown }).markAllRead === true;

  if (!markAllRead) {
    return NextResponse.json(
      { error: "Expected { markAllRead: true }." },
      { status: 400 }
    );
  }

  const result = await prisma.notification.updateMany({
    where: { userId: sessionEmail, isRead: false },
    data: { isRead: true },
  });

  return NextResponse.json({ ok: true, count: result.count });
}
