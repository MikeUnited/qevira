import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { decrypt, SESSION_COOKIE } from "@/lib/session";

/**
 * Server-side suggested KYC step from GET /api/register/resume (same session cookies).
 * Deduplicated per request via React cache() so layout + page guards share one fetch.
 */
export const getResumeSuggestedStep = cache(async (): Promise<number> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const payload = await decrypt(token);
    const emailRaw = payload?.email;
    const email =
      typeof emailRaw === "string" && emailRaw.trim().length > 0
        ? emailRaw.trim().toLowerCase()
        : null;
    if (email) {
      const teamMember = await prisma.teamMember.findFirst({
        where: { email, status: "ACCEPTED" },
      });
      if (teamMember) return 6;
    }
  }

  const h = await headers();
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base = `${proto}://${host}`;
  const cookie = h.get("cookie") ?? "";

  const res = await fetch(`${base}/api/register/resume`, {
    headers: { cookie },
    cache: "no-store",
  });

  if (!res.ok) return 3;

  const data = (await res.json().catch(() => null)) as {
    suggestedStep?: unknown;
  } | null;
  const step =
    typeof data?.suggestedStep === "number" ? data.suggestedStep : 3;
  return step;
});

/** Route guard: direct URL access to KYC-gated pages. */
export async function requireKycStep6OrRedirect() {
  const step = await getResumeSuggestedStep();
  if (step < 6) redirect("/complete-kyc");
}
