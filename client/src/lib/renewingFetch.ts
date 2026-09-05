/**
 * renewingFetch.ts — fetch wrapper for the tRPC httpBatchLink that performs
 * ONE silent session renewal + ONE retry when the server answers 401.
 *
 * Wave 3: previously any UNAUTHORIZED response immediately flipped the portal
 * to "Sign in to continue" even when the Keycloak SSO session was still alive
 * (the ~20 min session-drop symptom). Now the first 401 triggers
 * renewSessionOnce() (refresh_token grant when tokens are stored, otherwise a
 * silent oauth2-proxy iframe round-trip) and the original request is retried
 * exactly once. If renewal fails or the retry is still 401, the response is
 * returned untouched and the existing unauthenticated UI handling applies.
 *
 * Safety:
 * - Only retries idempotent-ish single 401s; bodies are strings/URLSearchParams
 *   in the batch link and are safely replayable.
 * - Never retries the renewal endpoints themselves (no renewal loops).
 */
import { renewSessionOnce } from "./sessionRefresh";

const RENEWAL_PATHS = ["/api/trpc/keycloak.refreshSession", "/api/trpc/auth.sessionInfo"];

function isRenewalRequest(input: RequestInfo | URL): boolean {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return RENEWAL_PATHS.some((p) => url.includes(p));
}

export function createRenewingFetch(
  baseFetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.status !== 401 || isRenewalRequest(input)) {
      return response;
    }
    const renewed = await renewSessionOnce().catch(() => false);
    if (!renewed) return response;
    // Retry the original request exactly once with the same body.
    return baseFetch(input, init);
  };
}
