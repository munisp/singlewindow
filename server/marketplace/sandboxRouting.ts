/**
 * WP-8 — Sandbox toggle routing.
 *
 * Doctrine (aligned with blueeconomy-agency-sandbox `X-Sandbox: true`):
 *   - Keys marked sandbox may reach ONLY sandbox-marked upstreams and always
 *     carry the `X-Sandbox: true` header so upstreams serve synthetic data.
 *   - Production keys NEVER see sandbox data: a production key targeting a
 *     sandbox upstream is refused, and no sandbox header is ever attached.
 *   - Fail-closed: an upstream with unknown/unregistered marking is refused
 *     for sandbox keys (we cannot prove it is a sandbox).
 */

export interface UpstreamEndpoint {
  /** stable upstream id, e.g. "declarations-core" */
  id: string;
  /** true when this upstream instance serves sandbox (synthetic) data */
  sandbox: boolean;
}

export interface KeyRoutingContext {
  keyId: number;
  sandboxMode: boolean;
  status: string; // active | revoked | expired
}

export type RoutingDecision =
  | { allowed: true; upstream: UpstreamEndpoint; headers: Record<string, string> }
  | { allowed: false; reason: string };

/**
 * Resolve whether `key` may call `upstream`, and which headers must be set.
 * Pure function — fully unit-testable, used by the API gateway middleware.
 */
export function resolveUpstreamForKey(
  key: KeyRoutingContext,
  upstream: UpstreamEndpoint | undefined
): RoutingDecision {
  if (key.status !== "active") {
    return { allowed: false, reason: `API key is ${key.status}; only active keys may route` };
  }
  if (!upstream) {
    return { allowed: false, reason: "Upstream is not registered; refusing to route (fail-closed)" };
  }
  if (key.sandboxMode) {
    if (!upstream.sandbox) {
      return {
        allowed: false,
        reason: `Sandbox key ${key.keyId} cannot reach production upstream "${upstream.id}"`,
      };
    }
    // Sandbox traffic is explicitly marked so upstreams serve synthetic data.
    return { allowed: true, upstream, headers: { "X-Sandbox": "true" } };
  }
  if (upstream.sandbox) {
    return {
      allowed: false,
      reason: `Production key ${key.keyId} must never see sandbox data (upstream "${upstream.id}" is sandbox-marked)`,
    };
  }
  return { allowed: true, upstream, headers: {} };
}

/** Scope check: key scopes (comma-separated) must include the required scope. */
export function keyHasScope(scopesCsv: string, requiredScope: string): boolean {
  const scopes = scopesCsv.split(",").map((s) => s.trim());
  return scopes.includes(requiredScope) || scopes.includes("admin:all");
}
