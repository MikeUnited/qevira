import type { NextRequest } from "next/server";

export function getClientIp(req: NextRequest | Request): string {
  if ("headers" in req && typeof req.headers.get === "function") {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  return "unknown";
}
