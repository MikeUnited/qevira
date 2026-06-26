import { NextResponse } from "next/server";

import { getSessionPayload } from "@/lib/session";
import { getUserProfile } from "@/lib/server-user-profile";

/**
 * Lightweight session probe for client UIs (e.g. marketplace nav, checkout role).
 * Always returns 200 so guests do not trigger noisy 401 lines in the browser console;
 * use `authenticated` in the JSON body to tell signed-in vs signed-out.
 */
export async function GET() {
  const session = await getSessionPayload();
  if (!session?.email) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }

  const profile = await getUserProfile();
  const supplierGroup = profile.ok ? profile.data.supplierGroup : null;
  const supplierDocName = profile.ok ? profile.data.supplierDocName : null;

  return NextResponse.json(
    {
      authenticated: true,
      email: session.email,
      teamRole: session.teamRole ?? null,
      organizationId: session.organizationId ?? null,
      supplierGroup,
      supplierDocName,
    },
    { status: 200 }
  );
}
