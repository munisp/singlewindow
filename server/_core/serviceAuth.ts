/**
 * serviceAuth.ts — service-to-service authentication for money-rail HTTP hops
 * (PRA-012, Phase 9).
 *
 * The TigerBeetle bridge (and any other in-repo service hop on a money path)
 * previously accepted UNAUTHENTICATED HTTP calls. This module issues caller
 * credentials following the tariffClient pattern:
 *
 *   PRIMARY (required in production): Keycloak client-credentials grant.
 *     TB_BRIDGE_CLIENT_ID / TB_BRIDGE_CLIENT_SECRET against KEYCLOAK_TOKEN_URL
 *     (or KEYCLOAK_URL/realms/KEYCLOAK_REALM). Tokens are cached with
 *     single-flight refresh and proactively renewed 30s before expiry.
 *     Production BOOT REFUSES to start without them (env.ts
 *     validateProductionConfig).
 *
 *   FALLBACK (non-production ONLY): static shared secret
 *     TB_BRIDGE_SHARED_SECRET sent as a Bearer token; the bridge compares it
 *     in constant time. The bridge REJECTS this mode when APP_ENV=production.
 *     Documented dev convenience — never a production path.
 *
 * Fail-closed: when neither is configured, getServiceAuthHeaders() throws
 * ServiceAuthConfigError — the money-rail call is never made unauthenticated.
 */

import { ENV } from "./env";

export class ServiceAuthConfigError extends Error {
  readonly code = "SERVICE_AUTH_CONFIG" as const;
  constructor(message: string) {
    super(message);
    this.name = "ServiceAuthConfigError";
  }
}

interface CachedToken {
  accessToken: string;
  /** epoch ms after which the token must be refreshed (exp - skew). */
  refreshAt: number;
}

let _cached: CachedToken | null = null;
let _inFlight: Promise<string> | null = null;

const REFRESH_SKEW_MS = 30_000;

function tokenEndpoint(): string {
  if (ENV.keycloakTokenUrl) return ENV.keycloakTokenUrl;
  if (ENV.keycloakUrl) {
    return `${ENV.keycloakUrl}/realms/${ENV.keycloakRealm}/protocol/openid-connect/token`;
  }
  return "";
}

/**
 * Acquires a client-credentials access token: cached, single-flight,
 * proactively refreshed (mirrors server/_core/tariffClient.ts).
 */
async function acquireClientCredentialsToken(): Promise<string> {
  const now = Date.now();
  if (_cached && now < _cached.refreshAt) return _cached.accessToken;
  if (_inFlight) return _inFlight;

  const clientId = process.env.TB_BRIDGE_CLIENT_ID ?? "";
  const clientSecret = process.env.TB_BRIDGE_CLIENT_SECRET ?? "";
  const endpoint = tokenEndpoint();
  if (!clientId || !clientSecret || !endpoint) {
    throw new ServiceAuthConfigError(
      "Keycloak client-credentials for the TigerBeetle bridge are not configured " +
        "(need TB_BRIDGE_CLIENT_ID + TB_BRIDGE_CLIENT_SECRET + KEYCLOAK_TOKEN_URL or KEYCLOAK_URL). " +
        "Production refuses to boot without them; this call fails closed."
    );
  }

  _inFlight = (async () => {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ServiceAuthConfigError(
          `Keycloak token endpoint answered HTTP ${res.status} for TB bridge client-credentials: ${body.slice(0, 200)}`
        );
      }
      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) {
        throw new ServiceAuthConfigError("Keycloak token response missing access_token");
      }
      const expiresInMs = Math.max(5, Number(data.expires_in ?? 60)) * 1000;
      _cached = {
        accessToken: data.access_token,
        refreshAt: Date.now() + expiresInMs - REFRESH_SKEW_MS,
      };
      return data.access_token;
    } finally {
      _inFlight = null;
    }
  })();

  return _inFlight;
}

/**
 * Returns the Authorization header for a service-to-service money-rail call.
 * Throws ServiceAuthConfigError (fail closed) when no credential mode is
 * usable in this environment.
 */
export async function getServiceAuthHeaders(): Promise<Record<string, string>> {
  // Non-production static shared-secret fallback (documented, dev-only).
  const sharedSecret = process.env.TB_BRIDGE_SHARED_SECRET ?? "";
  const clientCredsConfigured =
    Boolean(process.env.TB_BRIDGE_CLIENT_ID) && Boolean(process.env.TB_BRIDGE_CLIENT_SECRET);

  if (clientCredsConfigured) {
    const token = await acquireClientCredentialsToken();
    return { Authorization: `Bearer ${token}` };
  }
  if (!ENV.isProduction && sharedSecret) {
    return { Authorization: `Bearer ${sharedSecret}` };
  }
  throw new ServiceAuthConfigError(
    ENV.isProduction
      ? "TB bridge service auth: client-credentials are REQUIRED in production (TB_BRIDGE_CLIENT_ID/TB_BRIDGE_CLIENT_SECRET); the static shared-secret fallback is non-production only. Failing closed."
      : "TB bridge service auth: configure TB_BRIDGE_CLIENT_ID/TB_BRIDGE_CLIENT_SECRET (or TB_BRIDGE_SHARED_SECRET for local dev). Failing closed."
  );
}

/** Test hook: reset the token cache between tests. */
export function _resetServiceAuthForTests(): void {
  _cached = null;
  _inFlight = null;
}
