/**
 * Phase 17 (G1) — env-driven CSP origin whitelist parsing.
 *
 * Production CSP stays fail-closed (same-origin only) unless operators
 * explicitly whitelist tile/style/glyph origins via:
 *   CSP_SCRIPT_SRC_EXTRA / CSP_CONNECT_SRC_EXTRA / CSP_IMG_SRC_EXTRA
 * (comma-separated https origins). Malformed entries are dropped so a typo
 * can never widen the policy to a wildcard.
 */

export function parseCspOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(s => /^https:\/\/[a-z0-9.-]+(?::\d+)?(\/[^\s,]*)?$/i.test(s) || s === "data:" || s === "blob:");
}
