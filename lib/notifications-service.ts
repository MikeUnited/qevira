import { NotificationType } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export async function createNotification(
  userId: string,
  title: string,
  message: string,
  type: NotificationType,
  link?: string
): Promise<void> {
  try {
    await prisma.notification.create({
      data: { userId, title, message, type, link },
    });
  } catch (error) {
    // Never let notification creation block
    // the main operation
    console.error("[notifications] Failed to create:", error);
  }
}

export async function getNotifications(userId: string, limit = 20) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, isRead: false },
  });
}
