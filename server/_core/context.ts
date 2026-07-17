import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

// ─── Extended context type ────────────────────────────────────────────────────
// keycloakRoles is populated from the Keycloak JWT `realm_access.roles` array
// when a Bearer token is present. This allows procedures to gate access on
// fine-grained Keycloak roles without an extra DB round-trip.
//
// Examples:
//   ctx.keycloakRoles.includes("tradegateway-admin")
//   ctx.keycloakRoles.includes("tradegateway-customs-officer")
export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /** Raw Keycloak realm + client roles from the verified JWT (empty array for session-cookie auth) */
  keycloakRoles: string[];
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let keycloakRoles: string[] = [];

  try {
    user = await sdk.authenticateRequest(opts.req);

    // ── Enrich context with Keycloak roles when a Bearer token is present ──
    // sdk.authenticateRequest already verified the token; we re-parse the
    // Authorization header here (no network call — JWKS is cached) to extract
    // the full roles array without modifying the User DB model.
    // ── Roles from oauth2-proxy forward_auth header (browser sessions) ──
    // When Caddy's forward_auth passes through oauth2-proxy, the groups/roles
    // are injected as X-Auth-Request-Groups (comma-separated Keycloak group names).
    const groupsHeader = opts.req.headers["x-auth-request-groups"] as string | undefined;
    if (groupsHeader) {
      keycloakRoles = groupsHeader.split(",").map((g: string) => g.trim()).filter(Boolean);
    }

    const authHeader = opts.req.headers.authorization as string | undefined;
    if (authHeader?.startsWith("Bearer ") && user) {
      try {
        const { verifyKeycloakToken } = await import("./keycloakVerifier");
        const payload = await verifyKeycloakToken(authHeader);
        if (payload) {
          const roles: string[] = [];
          if (payload.realm_access?.roles) roles.push(...payload.realm_access.roles);
          if (payload.resource_access) {
            for (const client of Object.values(payload.resource_access)) {
              if (client?.roles) roles.push(...client.roles);
            }
          }
          keycloakRoles = roles;
        }
      } catch {
        // Non-critical — roles enrichment failure should not block the request
      }
    }
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    keycloakRoles,
  };
}
