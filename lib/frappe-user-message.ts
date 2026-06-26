/**
 * Turns Frappe/ERPNext REST error payloads into short, user-safe strings.
 * Avoids showing Python tracebacks or internal paths in toasts.
 */

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function looksLikePythonTraceback(s: string): boolean {
  const t = s.trim();
  return (
    t.startsWith("Traceback") ||
    (t.includes('File "') && t.includes(", line "))
  );
}

/** Last line is often `ValidationError: ...` or `KeyError: ...` */
function extractLastPythonExceptionLine(traceback: string): string | null {
  const lines = traceback.split("\n").map((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    if (/^[\w.]+Error:/.test(line) || /^[\w.]+Exception:/.test(line)) {
      return line;
    }
  }
  return null;
}

/** If the API returns a JSON string that is actually `["Traceback..."]` */
function unwrapJsonArrayString(s: string): string {
  const t = s.trim();
  if (!t.startsWith("[")) return t;
  try {
    const parsed = JSON.parse(t) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === "string") {
      return parsed[0];
    }
  } catch {
    /* ignore */
  }
  return t;
}

export function sanitizeFrappeMessageForUser(text: string): string {
  const t = unwrapJsonArrayString(text).trim();
  if (looksLikePythonTraceback(t)) {
    const lastLine = extractLastPythonExceptionLine(t);
    if (lastLine) {
      const cleaned = stripHtml(lastLine);
      return cleaned.length > 280 ? `${cleaned.slice(0, 280)}…` : cleaned;
    }
    return "The server could not complete this request. Please try again or contact support.";
  }
  const cleaned = stripHtml(t);
  return cleaned.length > 280 ? `${cleaned.slice(0, 280)}…` : cleaned;
}

/**
 * Returns a user-safe message if the payload contains any known Frappe field,
 * otherwise `null` (callers can fall back to status text or raw body).
 */
export function tryExtractFrappeMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;

  if (typeof o.message === "string" && o.message.trim()) {
    return sanitizeFrappeMessageForUser(o.message);
  }
  if (typeof o.error === "string" && o.error.trim()) {
    return sanitizeFrappeMessageForUser(o.error);
  }
  if (Array.isArray(o.error) && o.error.length > 0) {
    const first = o.error[0];
    if (typeof first === "string" && first.trim()) {
      return sanitizeFrappeMessageForUser(first);
    }
  }
  if (Array.isArray(o._server_messages)) {
    for (const raw of o._server_messages) {
      try {
        const inner = JSON.parse(String(raw)) as { message?: string };
        if (typeof inner.message === "string" && inner.message.trim()) {
          return sanitizeFrappeMessageForUser(inner.message);
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (typeof o.exc === "string" && o.exc.trim()) {
    return sanitizeFrappeMessageForUser(o.exc);
  }
  if (typeof o.exception === "string" && o.exception.trim()) {
    return sanitizeFrappeMessageForUser(o.exception);
  }
  return null;
}

/**
 * Prefer structured Frappe fields; never surface raw tracebacks to users.
 */
export function userFacingFrappeMessage(
  data: unknown,
  httpStatus: number
): string {
  const extracted = tryExtractFrappeMessage(data);
  if (extracted !== null) return extracted;
  return `Request failed (${httpStatus})`;
}
