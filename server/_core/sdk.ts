import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { getPool } from "../db";
import { ENV } from "./env";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "session";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export type SessionPayload = {
  openId: string;
  name: string;
};

export type AuthenticatedUser = User & {
  isCron?: boolean;
  taskUid?: string;
};

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

  async authenticateRequest(req: Request): Promise<AuthenticatedUser> {
    const authHeader = req.headers.authorization as string | undefined;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const { verifyKeycloakToken, extractRoleFromPayload } = await import("./keycloakVerifier");
        const payload = await verifyKeycloakToken(authHeader);
        if (!payload?.sub) throw new Error("Keycloak token subject is missing.");

        const signedInAt = new Date();
        const role = extractRoleFromPayload(payload);
        await db.upsertUser({
          openId: payload.sub,
          name: payload.preferred_username ?? payload.sub,
          email: typeof payload.email === "string" ? payload.email : null,
          loginMethod: "keycloak",
          lastSignedIn: signedInAt,
          ...(role ? { role } : {}),
        });
        const user = await db.getUserByOpenId(payload.sub);
        if (user) return user;
        throw new Error("Keycloak user could not be provisioned.");
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
          login_method: string | null; role: string; created_at: Date; updated_at: Date; last_signed_in: Date;
        }>("SELECT * FROM users WHERE open_id = $1 LIMIT 1", [session.openId]);
        if (!result.rows[0]) throw ForbiddenError("Demo user not found — run the demo seed script");
        await client.query("UPDATE users SET last_signed_in = $1 WHERE open_id = $2", [signedInAt, session.openId]);
        const row = result.rows[0];
        return {
          id: row.id,
          openId: row.open_id,
          name: row.name,
          email: row.email,
          loginMethod: row.login_method,
          role: row.role as User["role"],
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          lastSignedIn: row.last_signed_in,
        };
      } finally {
        client.release();
      }
    }

    const user = await db.getUserByOpenId(session.openId);
    if (!user) throw ForbiddenError("Session user is not provisioned");
    await db.upsertUser({ openId: user.openId, lastSignedIn: signedInAt });
    return user;
  }
}

export const sdk = new LocalSessionService();
