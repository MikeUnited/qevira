/**
 * Returns a safe in-app path for post-login redirect, or null if untrusted.
 * Rejects protocol-relative URLs and non-root-relative paths (open-redirect guard).
 */
export function getSafeCallbackUrl(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//")) return null;
  return trimmed;
}
