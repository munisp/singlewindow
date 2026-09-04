/**
 * sessionRefresh.ts — silent Keycloak session renewal (B7).
 *
 * Access tokens expire with the realm's "Access Token Lifespan" while the
 * Keycloak SSO session (refresh token) remains valid. This module stores the
 * Keycloak token set in sessionStorage and schedules a silent refresh via the
 * public `keycloak.refreshSession` tRPC mutation shortly before expiry.
 *
 * Security notes:
 * - Tokens live in sessionStorage only (key "tg-kc-tokens") — never persisted
 *   to localStorage, never logged.
 * - Refresh-token rotation is handled: the newest refreshToken returned by
 *   the server always replaces the stored one.
 * - If no token flow has populated the store (the current deployment's auth
 *   is cookie-based), every entry point is a safe no-op and the existing
 *   marker-based silent SSO redirect remains the active fallback.
 */

const STORAGE_KEY = "tg-kc-tokens";

/** Refresh this many milliseconds before the access token expires. */
const REFRESH_LEEWAY_MS = 60_000;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
  /** Epoch milliseconds at which the access token expires. */
  expiresAt: number;
  tokenType: string;
}

/** Persist a Keycloak token set. `expiresIn` is in seconds (OIDC convention). */
export function storeSessionTokens(tokens: {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresIn: number;
  tokenType: string;
}): SessionTokens | null {
  if (!tokens.refreshToken) return null;
  const stored: SessionTokens = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    expiresAt: Date.now() + Math.max(0, tokens.expiresIn) * 1000,
    tokenType: tokens.tokenType,
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // sessionStorage unavailable (private mode etc.) — refresh becomes a no-op
  }
  return stored;
}

export function loadSessionTokens(): SessionTokens | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionTokens;
    if (!parsed || typeof parsed.refreshToken !== "string" || typeof parsed.expiresAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSessionTokens(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* no-op */
  }
}

/** True when a stored session exists and its access token is still valid. */
export function hasValidSessionTokens(): boolean {
  const t = loadSessionTokens();
  return !!t && t.expiresAt - REFRESH_LEEWAY_MS > Date.now();
}

interface RefreshResponse {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresIn: number;
  tokenType: string;
}

/** Call the public keycloak.refreshSession mutation (superjson wire format). */
async function callRefreshSession(refreshToken: string): Promise<RefreshResponse> {
  const res = await fetch("/api/trpc/keycloak.refreshSession?batch=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ "0": { json: { refreshToken } } }),
  });
  if (!res.ok) {
    throw new Error(`Session refresh failed (HTTP ${res.status})`);
  }
  const payload = await res.json();
  const first = Array.isArray(payload) ? payload[0] : payload;
  const data = first?.result?.data;
  // superjson wraps scalars under { json }; plain responses expose fields directly
  const json = data?.json ?? data;
  if (first?.error || !json?.accessToken) {
    throw new Error(first?.error?.json?.message ?? first?.error?.message ?? "Session refresh rejected");
  }
  return json as RefreshResponse;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<boolean> | null = null;

/**
 * Attempt one silent refresh. Returns true when the session was renewed.
 * Deduplicates concurrent calls.
 */
export function attemptSessionRefresh(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const stored = loadSessionTokens();
    if (!stored) return false;
    try {
      const rotated = await callRefreshSession(stored.refreshToken);
      storeSessionTokens({
        ...rotated,
        // Server falls back to the caller's refresh token when IdP omits one.
        refreshToken: rotated.refreshToken ?? stored.refreshToken,
      });
      scheduleSessionRefresh();
      return true;
    } catch {
      // Refresh token invalid/revoked/expired — drop it so we don't retry forever.
      clearSessionTokens();
      return false;
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Stop any scheduled refresh (e.g. on logout). */
export function cancelScheduledRefresh(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Schedule a silent refresh at expiresAt − 60s based on the stored token set.
 * Safe to call repeatedly; the latest call wins. No-op without stored tokens.
 */
export function scheduleSessionRefresh(): void {
  cancelScheduledRefresh();
  const stored = loadSessionTokens();
  if (!stored) return;
  const delay = Math.max(0, stored.expiresAt - REFRESH_LEEWAY_MS - Date.now());
  refreshTimer = setTimeout(() => {
    void attemptSessionRefresh();
  }, delay);
}

/**
 * Imperative refresh hook for session-drop handling: call before falling back
 * to an SSO redirect. Returns true if the session was renewed silently.
 */
export async function refreshBeforeSsoRedirect(): Promise<boolean> {
  return attemptSessionRefresh();
}

/** Clear tokens and cancel timers — call from the logout flow. */
export function teardownSessionRefresh(): void {
  cancelScheduledRefresh();
  clearSessionTokens();
}
