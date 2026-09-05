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
  teardownEdgeSessionRenewal();
}

/* ────────────────────────────────────────────────────────────────────────────
 * Wave 3: edge (oauth2-proxy / session-cookie) proactive renewal.
 *
 * Evidence from the deployment topology (infra/caddy/Caddyfile.prod,
 * server/_core/context.ts, server/_core/sdk.ts): browser portals authenticate
 * at the edge via Caddy forward_auth → oauth2-proxy → Keycloak. Keycloak
 * tokens NEVER reach the SPA, so the refresh_token path above stays inert for
 * browser sessions (it remains the active path for API clients that DO hold
 * tokens). For browser sessions we instead:
 *   1. Ask the server (auth.sessionInfo) when the current credential expires.
 *   2. Schedule a renewal at exp − 60s.
 *   3. Renew silently via a hidden iframe through /oauth2/start: with a live
 *      Keycloak SSO session the oauth2-proxy → Keycloak → callback round-trip
 *      completes without user interaction and refreshes the session cookie.
 *   4. Verify success by re-reading auth.sessionInfo (fail-closed).
 * ──────────────────────────────────────────────────────────────────────────── */

/** sessionStorage marker: epoch ms at which the edge session expires. */
const EDGE_EXPIRY_KEY = "tg-edge-session-expiry";

/** Renew this many milliseconds before the edge credential expires. */
const EDGE_RENEW_LEEWAY_MS = 60_000;

/** Upper bound for one silent iframe round-trip before we declare failure. */
const EDGE_RENEW_TIMEOUT_MS = 15_000;

interface SessionInfoResponse {
  expiresAt: number;
  source: "keycloak-bearer" | "edge-proxy" | "session-cookie";
}

/** Fetch the current session's expiry from the server (superjson wire format). */
export async function fetchSessionExpiry(): Promise<SessionInfoResponse | null> {
  try {
    const res = await fetch("/api/trpc/auth.sessionInfo?batch=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ "0": { json: null } }),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const first = Array.isArray(payload) ? payload[0] : payload;
    const data = first?.result?.data;
    const json = data?.json ?? data;
    if (!json || typeof json.expiresAt !== "number") return null;
    return json as SessionInfoResponse;
  } catch {
    return null;
  }
}

export function storeEdgeSessionExpiry(expiresAt: number): void {
  try {
    sessionStorage.setItem(EDGE_EXPIRY_KEY, String(expiresAt));
  } catch {
    /* sessionStorage unavailable — renewal becomes a no-op */
  }
}

export function loadEdgeSessionExpiry(): number | null {
  try {
    const raw = sessionStorage.getItem(EDGE_EXPIRY_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function clearEdgeSessionExpiry(): void {
  try {
    sessionStorage.removeItem(EDGE_EXPIRY_KEY);
  } catch {
    /* no-op */
  }
}

/**
 * Attempt one silent edge-session renewal via a hidden iframe round-trip
 * through oauth2-proxy (/oauth2/start). With a live Keycloak SSO session this
 * completes without user interaction and refreshes the session cookie.
 *
 * Success criterion (fail-closed): after the iframe settles, the server must
 * report a session expiry LATER than the one we knew about. A Keycloak login
 * page inside the iframe (SSO session dead) never advances the expiry, so we
 * correctly report failure and let the caller fall back to interactive login.
 */
export function attemptSilentEdgeRenewal(
  timeoutMs: number = EDGE_RENEW_TIMEOUT_MS,
): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  const knownExpiry = loadEdgeSessionExpiry();

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        iframe.remove();
      } catch {
        /* already removed */
      }
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;

    iframe.addEventListener("load", () => {
      // The iframe completed a navigation. It may still be mid-flow (Keycloak
      // hop), so verify with the server after a short settle delay.
      setTimeout(() => {
        void fetchSessionExpiry().then((info) => {
          if (!info) return finish(false);
          const previous = knownExpiry ?? 0;
          if (info.expiresAt > previous || info.expiresAt - EDGE_RENEW_LEEWAY_MS > Date.now()) {
            storeEdgeSessionExpiry(info.expiresAt);
            finish(true);
          } else {
            finish(false);
          }
        });
      }, 500);
    });
    iframe.addEventListener("error", () => finish(false));

    // rd points at a lightweight same-origin asset; the proxy sets the fresh
    // cookie on /oauth2/callback BEFORE redirecting to rd.
    iframe.src = `/oauth2/start?rd=${encodeURIComponent("/favicon.ico")}`;
    document.body.appendChild(iframe);
  });
}

let edgeRenewTimer: ReturnType<typeof setTimeout> | null = null;
let edgeRenewInFlight: Promise<boolean> | null = null;

/** Stop any scheduled edge renewal (e.g. on logout). */
export function cancelEdgeSessionRenewal(): void {
  if (edgeRenewTimer !== null) {
    clearTimeout(edgeRenewTimer);
    edgeRenewTimer = null;
  }
}

/**
 * One silent renewal attempt regardless of flow: refresh_token grant when
 * tokens are stored, otherwise the edge iframe round-trip. Deduplicates
 * concurrent callers.
 */
export function renewSessionOnce(): Promise<boolean> {
  if (hasValidSessionTokens()) return attemptSessionRefresh();
  if (edgeRenewInFlight) return edgeRenewInFlight;
  edgeRenewInFlight = attemptSilentEdgeRenewal().finally(() => {
    edgeRenewInFlight = null;
  });
  return edgeRenewInFlight;
}

/**
 * Schedule a proactive silent renewal of the edge session at expiresAt − 60s.
 * Safe to call repeatedly; the latest call wins. No-op without a known expiry.
 */
export function scheduleEdgeSessionRenewal(expiresAt?: number): void {
  cancelEdgeSessionRenewal();
  const expiry = expiresAt ?? loadEdgeSessionExpiry();
  if (!expiry) return;
  storeEdgeSessionExpiry(expiry);
  const delay = Math.max(0, expiry - EDGE_RENEW_LEEWAY_MS - Date.now());
  edgeRenewTimer = setTimeout(() => {
    void renewSessionOnce().then((renewed) => {
      if (renewed) {
        // Reschedule against the freshly reported expiry.
        scheduleEdgeSessionRenewal();
      } else {
        // Renewal failed (SSO session gone) — stop; the UNAUTHORIZED
        // handling in useAuth/main.tsx owns the interactive fallback.
        clearEdgeSessionExpiry();
      }
    });
  }, delay);
}

/**
 * Sync scheduling state from the server: fetch the current session expiry and
 * (re)schedule the proactive renewal. Called after a successful auth.me.
 */
export async function syncEdgeSessionRenewal(): Promise<void> {
  const info = await fetchSessionExpiry();
  if (!info) return;
  scheduleEdgeSessionRenewal(info.expiresAt);
}

/** Clear edge markers and cancel timers — folded into teardownSessionRefresh. */
export function teardownEdgeSessionRenewal(): void {
  cancelEdgeSessionRenewal();
  clearEdgeSessionExpiry();
}
