import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME } from "../../shared/const";
import * as db from "../db";
import { getPool } from "../db";
import { ENV } from "./env";
// Static import (Phase 21 perf): the per-request dynamic import() put a
// module-resolution microtask on every authenticated call. This module only
// depends on ./env and ./roleClaimMap — no cycle.
import {
  extractRoleMappingFromPayload,
  verifyKeycloakToken,
  type KeycloakTokenPayload,
} from "./keycloakVerifier";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
// The session cookie is written with shared/const COOKIE_NAME everywhere
// (demoAuth, e2eTestAuth, OAuth callback, logout); verification must read the
// same name — single source of truth. SESSION_COOKIE_NAME remains as an
// escape hatch for deployments that rename the cookie.
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? COOKIE_NAME;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export type SessionPayload = {
  openId: string;
  name: string;
};

export type AuthenticatedUser = User & {
  isCron?: boolean;
  taskUid?: string;
};

// ─── Cron / scheduled-task identity ──────────────────────────────────────────
// Scheduled tasks (heartbeat crons) authenticate with a signed session whose
// openId is `${CRON_OPEN_ID_PREFIX}${taskUid}`. They have no users-table row;
// buildCronUser materialises the synthetic identity for the request context.
// Fail-closed: cron sessions still require a VALID signed session cookie —
// this prefix grants nothing by itself.
export const CRON_OPEN_ID_PREFIX = "cron_";

// ─── Phase 21 (perf): request auth hot-path caches ─────────────────────────
// Verified Keycloak payloads, keyed by the Express request object, so
// createContext can read roles without verifying the same RS256 JWT twice.
const verifiedBearerPayloads = new WeakMap<Request, KeycloakTokenPayload>();

// last_signed_in write throttle: at most one write per user per
// LAST_SIGNED_IN_WRITE_INTERVAL_MS PER PROCESS. last_signed_in is an
// analytics/audit convenience column (not a security control), so a ≤60 s
// staleness is acceptable; in multi-instance deployments each instance may
// write once per interval (still a >60× reduction vs. every request).
export const LAST_SIGNED_IN_WRITE_INTERVAL_MS = 60_000;
const lastSignedInWriteAt = new Map<string, number>();
const LAST_SIGNED_IN_THROTTLE_MAX = 50_000;

/** Test hook: reset the last_signed_in write throttle. */
export function __resetLastSignedInThrottle(): void {
  lastSignedInWriteAt.clear();
}

function lastSignedInWriteDue(openId: string, nowMs: number): boolean {
  const last = lastSignedInWriteAt.get(openId);
  return last === undefined || nowMs - last >= LAST_SIGNED_IN_WRITE_INTERVAL_MS;
}

function markLastSignedInWritten(openId: string, nowMs: number): void {
  if (lastSignedInWriteAt.size >= LAST_SIGNED_IN_THROTTLE_MAX && !lastSignedInWriteAt.has(openId)) {
    const oldest = lastSignedInWriteAt.keys().next().value;
    if (oldest !== undefined) lastSignedInWriteAt.delete(oldest);
  }
  lastSignedInWriteAt.set(openId, nowMs);
}

export function buildCronUser(openId: string): AuthenticatedUser {
  const taskUid = openId.slice(CRON_OPEN_ID_PREFIX.length);
  const now = new Date();
  return {
    id: 0,
    openId,
    name: "Manus Scheduled Task",
    email: null,
    loginMethod: "cron",
    role: "admin",
    status: "active",
    isCron: true,
    taskUid,
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

class LocalSessionService {
  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) return new Map<string, string>();
    return new Map(Object.entries(parseCookieHeader(cookieHeader)));
  }

  private getSessionSecret() {
    if (!ENV.cookieSecret) {
      throw new Error("JWT_SECRET is required for local session verification.");
    }
    return new TextEncoder().encode(ENV.cookieSecret);
  }

  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {},
  ): Promise<string> {
    return this.signSession(
      { openId, name: options.name || "" },
      options,
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {},
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const jti = crypto.randomUUID();

    return new SignJWT({
      openId: payload.openId,
      name: payload.name,
      jti,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(this.getSessionSecret());
  }

  async verifySession(
    cookieValue: string | undefined | null,
  ): Promise<{ openId: string; name: string; jti?: string } | null> {
    if (!cookieValue) return null;

    try {
      const { payload } = await jwtVerify(cookieValue, this.getSessionSecret(), {
        algorithms: ["HS256"],
      });
      const { openId, name, jti } = payload as Record<string, unknown>;
      if (!isNonEmptyString(openId) || !isNonEmptyString(name)) return null;

      if (typeof jti === "string" && jti) {
        try {
          const { isSessionRevoked } = await import("./redisRateLimiter");
          if (await isSessionRevoked(jti)) return null;
        } catch {
          // Session revocation depends on Redis; production payment routes independently
          // fail closed where Redis is a required integrity control.
        }
      }
      return { openId, name, jti: typeof jti === "string" ? jti : undefined };
    } catch (error) {
      console.warn("[Auth] Local session verification failed", String(error));
      return null;
    }
  }

  /**
   * Returns the Keycloak payload verified during authenticateRequest for this
   * exact request (Bearer path only), or undefined. Lets createContext read
   * realm/client roles without verifying the same token a second time.
   */
  getVerifiedBearerPayload(req: Request): KeycloakTokenPayload | undefined {
    return verifiedBearerPayloads.get(req);
  }

  async authenticateRequest(req: Request): Promise<AuthenticatedUser> {
    const authHeader = req.headers.authorization as string | undefined;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const payload = await verifyKeycloakToken(authHeader);
        if (!payload?.sub) throw new Error("Keycloak token subject is missing.");
        // Single verification per request: createContext reads this payload
        // (roles enrichment) instead of re-verifying the same RS256 token.
        verifiedBearerPayloads.set(req, payload);

        const signedInAt = new Date();
        // Phase 20 (GAP 5): fail-closed claim mapping. Only a mapped claim can
        // change a role; an EXISTING user with no mapped claim keeps their DB
        // role (no silent downgrade of admins), while a NEW user is provisioned
        // at the lowest-privilege role. Every auto-provision is audit-logged.
        const mapping = extractRoleMappingFromPayload(payload);
        const existing = await db.getUserByOpenId(payload.sub);

        // Phase 21 (perf): previously every Bearer request ran SELECT →
        // UPSERT (write) → SELECT. Now the common case is a single SELECT;
        // the write only happens when something actually changed:
        //   - new user (auto-provision), or
        //   - a mapped role/profile claim differs from the stored row
        //     (fail-closed role sync is NOT delayed by the throttle), or
        //   - last_signed_in is older than the throttle interval.
        // The write itself is one UPSERT ... RETURNING round-trip.
        const claimName = payload.preferred_username ?? payload.sub;
        const claimEmail = typeof payload.email === "string" ? payload.email : null;
        const roleChanged = mapping.mapped && existing != null && existing.role !== mapping.role;
        const profileChanged =
          existing != null &&
          (existing.name !== claimName ||
            existing.email !== claimEmail ||
            existing.loginMethod !== "keycloak");
        const touchDue = lastSignedInWriteDue(payload.sub, signedInAt.getTime());

        let user = existing;
        if (!existing || roleChanged || profileChanged || touchDue) {
          user = await db.upsertUserReturning({
            openId: payload.sub,
            name: claimName,
            email: claimEmail,
            loginMethod: "keycloak",
            lastSignedIn: signedInAt,
            ...(mapping.mapped ? { role: mapping.role } : {}),
          });
          if (user) markLastSignedInWritten(payload.sub, signedInAt.getTime());
        }
        if (!user) throw new Error("Keycloak user could not be provisioned.");
        if (!existing) {
          try {
            await db.logAuditEvent({
              entityType: "user",
              entityId: user.id,
              action: "keycloak_auto_provision",
              actorId: null,
              actorType: "keycloak_bearer",
              previousState: null,
              newState: { openId: user.openId, role: user.role, loginMethod: "keycloak" },
              metadata: { mappedClaims: mapping.mapped, unmappedPrivilegedClaims: mapping.unmappedPrivilegedClaims },
            });
          } catch (e) {
            console.warn("[Auth] Failed to audit-log auto-provision:", e);
          }
        }
        // Fail-closed: suspended/offboarded accounts cannot authenticate.
        if (user.status !== "active") {
          throw ForbiddenError(`Account is ${user.status}; contact an administrator.`);
        }
        return user;
      } catch (error) {
        console.warn("[Auth] Keycloak bearer-token authentication failed", String(error));
        throw ForbiddenError("Invalid Keycloak bearer token");
      }
    }

    const session = await this.verifySession(this.parseCookies(req.headers.cookie).get(SESSION_COOKIE_NAME));
    if (!session) throw ForbiddenError("Invalid session cookie");

    const signedInAt = new Date();
    if (session.openId.startsWith("demo-")) {
      const pool = getPool();
      if (!pool) throw ForbiddenError("Demo authentication requires a database connection");
      const client = await pool.connect();
      try {
        await client.query("SELECT set_config('app.current_user_id', $1, false)", [session.openId]);
        await client.query("SELECT set_config('app.current_user_role', $1, false)", ["admin"]);
        const result = await client.query<{
          id: number; open_id: string; name: string | null; email: string | null;
          login_method: string | null; role: string; status: string; created_at: Date; updated_at: Date; last_signed_in: Date;
        }>("SELECT * FROM users WHERE open_id = $1 LIMIT 1", [session.openId]);
        if (!result.rows[0]) throw ForbiddenError("Demo user not found — run the demo seed script");
        const row = result.rows[0];
        // Fail-closed: suspended/offboarded accounts cannot authenticate (demo path included).
        if (row.status && row.status !== "active") {
          throw ForbiddenError(`Account is ${row.status}; contact an administrator.`);
        }
        // Phase 21 (perf): throttled last_signed_in write (see Bearer path).
        if (lastSignedInWriteDue(session.openId, signedInAt.getTime())) {
          await client.query("UPDATE users SET last_signed_in = $1 WHERE open_id = $2", [signedInAt, session.openId]);
          markLastSignedInWritten(session.openId, signedInAt.getTime());
        }
        return {
          id: row.id,
          openId: row.open_id,
          name: row.name,
          email: row.email,
          loginMethod: row.login_method,
          role: row.role as User["role"],
          status: (row.status ?? "active") as User["status"],
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          lastSignedIn: row.last_signed_in,
        };
      } finally {
        client.release();
      }
    }

    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      return buildCronUser(session.openId);
    }

    const user = await db.getUserByOpenId(session.openId);
    if (!user) throw ForbiddenError("Session user is not provisioned");
    // Fail-closed: suspended/offboarded accounts cannot authenticate.
    if (user.status !== "active") {
      throw ForbiddenError(`Account is ${user.status}; contact an administrator.`);
    }
    // Phase 21 (perf): last_signed_in is throttled (≤1 write/user/60 s/process)
    // instead of a write on every cookie-authenticated request.
    if (lastSignedInWriteDue(user.openId, signedInAt.getTime())) {
      await db.upsertUser({ openId: user.openId, lastSignedIn: signedInAt });
      markLastSignedInWritten(user.openId, signedInAt.getTime());
    }
    return user;
  }
}

export const sdk = new LocalSessionService();
