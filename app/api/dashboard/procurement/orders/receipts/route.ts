import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionEmail } from "@/lib/session";

export async function GET() {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.procurementReceiptConfirmation.findMany({
    where: { userId: email },
    select: { orderId: true },
  });

  return NextResponse.json({
    orderIds: rows.map((r: { orderId: string }) => r.orderId),
  });
}
