/**
 * errors.ts — shared error-shaping helpers (B9).
 *
 * tRPC/Zod server errors arrive in two shapes:
 * 1. `err.data.zodError.fieldErrors` — tRPC errorFormatter with zodError payload
 * 2. `err.data.zodError` / `err.message` containing a JSON-stringified ZodError
 *    array (`[{ "code": "too_small", "path": ["name"], "message": "..." }]`)
 *
 * These helpers extract per-field messages for inline form display and produce
 * a human-friendly summary for toasts, so raw Zod/JSON blobs never reach the UI.
 */

/** Extract { fieldName: message } from a tRPC error, if field errors exist. */
export function extractFieldErrors(err: unknown): Record<string, string> | null {
  if (!err || typeof err !== "object") return null;

  // Shape 1: tRPC errorFormatter zodError payload (ZodError.flatten()-style)
  const zod = (err as any)?.data?.zodError;
  if (zod?.fieldErrors && typeof zod.fieldErrors === "object") {
    const out: Record<string, string> = {};
    for (const [field, messages] of Object.entries(zod.fieldErrors)) {
      if (Array.isArray(messages) && messages.length > 0) {
        out[field] = String(messages[0]);
      }
    }
    if (Object.keys(out).length > 0) return out;
  }

  // Shape 2: JSON-stringified Zod issue array in zodError.message or err.message
  const candidates = [zod?.message, (err as any)?.message];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const issues = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.issues) ? parsed.issues : null;
      if (!issues) continue;
      const out: Record<string, string> = {};
      for (const issue of issues) {
        const path = Array.isArray(issue?.path) && issue.path.length > 0
          ? issue.path.map(String).join(".")
          : null;
        if (path && issue?.message && !out[path]) {
          out[path] = String(issue.message);
        }
      }
      if (Object.keys(out).length > 0) return out;
    } catch {
      /* not JSON — fall through */
    }
  }

  return null;
}

/** True when a message looks like raw Zod/JSON output that must not be shown. */
function looksLikeRawJson(message: string): boolean {
  const t = message.trim();
  return (
    (t.startsWith("[") && t.endsWith("]")) ||
    (t.startsWith("{") && t.endsWith("}")) ||
    t.includes('"code":') ||
    t.includes('"path":')
  );
}

/**
 * Produce a user-friendly single-line message for toasts/banners.
 * Prefers the first field error; falls back to the server message unless it
 * is raw Zod/JSON, in which case the generic fallback is used.
 */
export function friendlyErrorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const fieldErrors = extractFieldErrors(err);
  if (fieldErrors) {
    const first = Object.values(fieldErrors)[0];
    if (first) return first;
  }
  const message = (err as any)?.message;
  if (typeof message === "string" && message.trim() && !looksLikeRawJson(message)) {
    return message;
  }
  return fallback;
}
