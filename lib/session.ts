import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";

function resolveSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (fromEnv === undefined) {
      throw new Error(
        "FATAL: SESSION_SECRET environment variable is missing."
      );
    }
    return fromEnv;
  }
  if (fromEnv === undefined) {
    console.warn(
      "[session] WARNING: SESSION_SECRET is unset. Using an insecure default for local development only. Set SESSION_SECRET in .env.local before production."
    );
    return "__bamys_dev_session_secret_change_me__";
  }
  return fromEnv;
}

const secretKey = new TextEncoder().encode(resolveSessionSecret());

export const SESSION_COOKIE = "bamys_session";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

export type TeamRoleClaim = "OWNER" | "DIRECTOR" | "PHARMACIST";

export type SessionPayload = {
  email: string;
  teamRole?: TeamRoleClaim;
  organizationId?: string;
  organizationKind?: "CUSTOMER" | "SUPPLIER";
};

/** Signed-in user email from the session cookie, or null. */
export async function getSessionEmail(): Promise<string | null> {
  const p = await getSessionPayload();
  return p?.email ?? null;
}

function payloadToSessionPayload(payload: JWTPayload | null): SessionPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const emailRaw = (payload as { email?: unknown }).email;
  const email =
    typeof emailRaw === "string" && emailRaw.trim().length > 0
      ? emailRaw.trim()
      : null;
  if (!email) return null;
  const tr = (payload as { teamRole?: unknown }).teamRole;
  const teamRole =
    tr === "OWNER" || tr === "DIRECTOR" || tr === "PHARMACIST"
      ? tr
      : undefined;
  const oid = (payload as { organizationId?: unknown }).organizationId;
  const organizationId =
    typeof oid === "string" && oid.trim() ? oid.trim() : undefined;
  const ok = (payload as { organizationKind?: unknown }).organizationKind;
  const organizationKind =
    ok === "CUSTOMER" || ok === "SUPPLIER" ? ok : undefined;
  return {
    email,
    teamRole,
    organizationId,
    organizationKind,
  };
}

/** Decrypted session claims, or null if missing/invalid. */
export async function getSessionPayload(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await decrypt(token);
  return payloadToSessionPayload(payload);
}

export async function encrypt(payload: JWTPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey);
}

export async function decrypt(input: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(input, secretKey);
    return payload;
  } catch {
    return null;
  }
}

export async function createSession(
  email: string,
  teamRole?: string,
  organizationId?: string,
  organizationKind?: "CUSTOMER" | "SUPPLIER"
): Promise<void> {
  const payload: Record<string, unknown> = { email };
  if (teamRole) payload.teamRole = teamRole;
  if (organizationId) payload.organizationId = organizationId;
  if (organizationKind) payload.organizationKind = organizationKind;

  const token = await encrypt(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SEC,
    path: "/",
  });
  // Dynamic import keeps ioredis out of the Edge middleware bundle (middleware only needs decrypt).
  const { persistSessionEmail } = await import("@/lib/session-redis");
  await persistSessionEmail(email);
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  let emailFromToken: string | null = null;
  if (token) {
    const payload = await decrypt(token);
    const raw = payload?.email;
    emailFromToken =
      typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : null;
  }
  cookieStore.delete(SESSION_COOKIE);
  if (emailFromToken) {
    const { clearPersistedSession } = await import("@/lib/session-redis");
    await clearPersistedSession(emailFromToken);
  }
}
