import { NextRequest, NextResponse } from "next/server";

import { deleteSession } from "@/lib/session";

export async function POST() {
  await deleteSession();
  return NextResponse.json({ ok: true, message: "Logged out" });
}

export async function GET(request: NextRequest) {
  await deleteSession();
  return NextResponse.redirect(new URL("/login", request.url));
}
