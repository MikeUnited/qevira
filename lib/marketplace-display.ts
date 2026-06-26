/**
 * Compact JWE tokens begin with "eyJ" (base64url of {"alg":...}). Never render raw
 * token prefixes in the marketplace UI (defense in depth if a field is mis-wired).
 */
export function maskJweLikePublicString(value: string): string {
  const t = value.trim();
  if (t.startsWith("eyJ")) return "—";
  return t;
}
