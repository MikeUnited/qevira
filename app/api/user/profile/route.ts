import { NextResponse } from "next/server";

import { getUserProfile } from "@/lib/server-user-profile";

export async function GET() {
  const result = await getUserProfile();

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  const {
    email,
    fullName,
    isDualRole,
    customerGroup,
    supplierGroup,
    teamRole,
    organizationId,
    organizationKind,
  } = result.data;

  return NextResponse.json({
    email,
    fullName,
    isDualRole,
    customerGroup,
    supplierGroup,
    teamRole,
    organizationId,
    organizationKind,
  });
}
