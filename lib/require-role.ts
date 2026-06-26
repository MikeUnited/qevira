import { NextResponse } from "next/server";

import {
  type TeamRoleClaim,
  getSessionPayload,
} from "@/lib/session";

export type TeamRole = TeamRoleClaim;

/**
 * Enforces session + team role. Use `allowMissingRole` when legacy users
 * (no team claims) must still access the resource.
 */
export async function requireRole(
  _request: Request,
  allowedRoles: TeamRole[],
  options?: {
    allowMissingRole?: boolean;
    pharmacistDeniedMessage?: string;
  }
): Promise<
  | {
      email: string;
      teamRole: string;
      organizationId: string;
    }
  | Response
> {
  const session = await getSessionPayload();
  if (!session?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { email, teamRole, organizationId } = session;

  if (!teamRole) {
    if (options?.allowMissingRole) {
      return {
        email,
        teamRole: "",
        organizationId: organizationId ?? "",
      };
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (allowedRoles.includes(teamRole)) {
    return {
      email,
      teamRole,
      organizationId: organizationId ?? "",
    };
  }

  if (
    teamRole === "PHARMACIST" &&
    options?.pharmacistDeniedMessage?.trim()
  ) {
    return NextResponse.json(
      { error: options.pharmacistDeniedMessage.trim() },
      { status: 403 }
    );
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
