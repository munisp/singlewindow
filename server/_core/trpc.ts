import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { redisRateLimit } from './redis';
import crypto from 'crypto';

// ─── CSRF Token Utilities (B3 FIX) ────────────────────────────────────────────
// Implements the Double Submit Cookie pattern:
//   1. On first request (or when cookie absent), server sets a random CSRF token
//      in a readable (non-httpOnly) cookie named 'csrf-token'.
//   2. Client reads the cookie and sends it in the 'X-CSRF-Token' request header.
//   3. Server middleware compares header vs cookie. Mismatch → 403.
//
// This stops CSRF because cross-origin requests cannot read cookies to echo them.

const CSRF_COOKIE_NAME = 'csrf-token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_TOKEN_BYTES = 32;

/**
 * Generates and sets a CSRF token cookie if not already present.
 * Called during OAuth callback and on the first authenticated request.
 */
export function ensureCsrfCookie(req: any, res: any): string {
  const existing = req.cookies?.[CSRF_COOKIE_NAME];
  if (existing && existing.length >= CSRF_TOKEN_BYTES * 2) return existing;

  const token = crypto.randomBytes(CSRF_TOKEN_BYTES).toString('hex');
  // Guard: res.cookie may not exist in test contexts or non-Express environments
  if (typeof res?.cookie !== 'function') return token;

  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,   // MUST be readable by JS so the client can echo it
    secure: isProduction,
    sameSite: 'none' as const,
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  });
  return token;
}

/**
 * Validates that the CSRF token in the request header matches the cookie.
 * Skips validation for GET/HEAD/OPTIONS (safe methods).
 * Skips in development unless CSRF_ENFORCE_DEV=1 is set.
 */
function validateCsrf(ctx: TrpcContext): void {
  const method = ctx.req.method?.toUpperCase();
  // Safe HTTP methods do not need CSRF protection
  if (!method || ['GET', 'HEAD', 'OPTIONS'].includes(method)) return;

  // In development, only enforce if explicitly opted in
  if (process.env.NODE_ENV !== 'production' && process.env.CSRF_ENFORCE_DEV !== '1') return;

  const cookieToken = ctx.req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = ctx.req.headers?.[CSRF_HEADER_NAME] as string | undefined;

  if (!cookieToken || !headerToken) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'CSRF token missing. Ensure X-CSRF-Token header is set from the csrf-token cookie.',
    });
  }

  // Constant-time comparison to prevent timing attacks
  const cookieBuf = Buffer.from(cookieToken, 'utf8');
  const headerBuf = Buffer.from(headerToken, 'utf8');
  if (cookieBuf.length !== headerBuf.length || !crypto.timingSafeEqual(cookieBuf, headerBuf)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'CSRF token mismatch. Request rejected.',
    });
  }
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  // B3 FIX: Validate CSRF token on all authenticated mutations
  validateCsrf(ctx);

  // Ensure CSRF cookie is set/refreshed for the current session
  if (ctx.res) ensureCsrfCookie(ctx.req, ctx.res);

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    // B3 FIX: Validate CSRF token on all admin mutations
    validateCsrf(ctx);

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

// ─── Keycloak Role-Gated Procedures ─────────────────────────────────────────
//
// These procedures validate against ctx.keycloakRoles (populated from the
// verified JWT in context.ts) rather than the DB role column. This means:
//   - Zero extra DB round-trips for role checks
//   - Roles are always fresh (from the current token, not a cached DB row)
//   - Works for both Keycloak-issued Bearer tokens AND Manus session cookies
//     (session-cookie auth falls back to ctx.user.role for compatibility)

/**
 * keycloakRoleProcedure(requiredRole) — factory that creates a procedure
 * requiring the caller to hold a specific Keycloak realm role.
 *
 * Falls back to ctx.user.role for Manus session-cookie auth so existing
 * admin accounts continue to work without a Keycloak token.
 *
 * @example
 *   export const customsOfficerProcedure = keycloakRoleProcedure("tradegateway-customs-officer");
 */
export function keycloakRoleProcedure(requiredRole: string) {
  return t.procedure.use(
    t.middleware(async opts => {
      const { ctx, next } = opts;
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
      }
      validateCsrf(ctx);

      // Primary check: Keycloak JWT roles (zero DB round-trip)
      const hasKeycloakRole = (ctx.keycloakRoles ?? []).includes(requiredRole);

      // Fallback: DB role for Manus session-cookie auth
      // Map Keycloak role names to DB role values for backward compatibility
      const KEYCLOAK_TO_DB_ROLE: Record<string, string> = {
        "tradegateway-admin": "admin",
        "tradegateway-customs-officer": "customs_officer",
        "tradegateway-oga-officer": "oga_officer",
        "tradegateway-inspector": "inspector",
        "tradegateway-finance": "finance",
        "tradegateway-trader": "user",
        admin: "admin",
        customs_officer: "customs_officer",
        oga_officer: "oga_officer",
        inspector: "inspector",
        finance: "finance",
        trader: "user",
      };
      const dbEquivalent = KEYCLOAK_TO_DB_ROLE[requiredRole];
      const hasDbRole = dbEquivalent ? ctx.user.role === dbEquivalent : false;

      if (!hasKeycloakRole && !hasDbRole) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Keycloak role '${requiredRole}' is required`,
        });
      }

      return next({ ctx: { ...ctx, user: ctx.user } });
    })
  );
}

/**
 * keycloakAdminProcedure — shorthand for keycloakRoleProcedure("tradegateway-admin").
 * Validates against both the Keycloak JWT role AND the DB admin role.
 */
export const keycloakAdminProcedure = keycloakRoleProcedure("tradegateway-admin");

/**
 * keycloakCustomsOfficerProcedure — requires customs_officer or higher.
 */
export const keycloakCustomsOfficerProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
    validateCsrf(ctx);
    const ALLOWED_KC_ROLES = ["tradegateway-admin", "tradegateway-customs-officer", "tradegateway-inspector"];
    const ALLOWED_DB_ROLES = ["admin", "customs_officer", "inspector"];
    const hasRole =
      ctx.keycloakRoles.some(r => ALLOWED_KC_ROLES.includes(r)) ||
      ALLOWED_DB_ROLES.includes(ctx.user.role);
    if (!hasRole) throw new TRPCError({ code: "FORBIDDEN", message: "Customs officer role required" });
    return next({ ctx: { ...ctx, user: ctx.user } });
  })
);

// ─── Rate Limiting (Redis-backed sliding window, in-memory fallback) ──────────

// In-memory fallback store for when Redis is unavailable
const _rateLimitStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Returns a snapshot of the in-memory rate limit store for admin monitoring.
 * In production with Redis, the authoritative counters are in Redis;
 * this reflects only the local in-memory fallback.
 */
export function getRateLimitStats() {
  const now = Date.now();
  let active = 0; let expired = 0;
  Array.from(_rateLimitStore.values()).forEach((entry) => {
    if (now > entry.resetAt) { expired++; } else { active++; }
  });
  return { active, expired, total: _rateLimitStore.size };
}

function _inMemoryRateLimit(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  const e = _rateLimitStore.get(key);
  if (!e || now > e.resetAt) { _rateLimitStore.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (e.count >= max) return false;
  e.count++; return true;
}

/**
 * Checks rate limit using Redis INCR+EXPIRE sliding window.
 * Falls back to in-memory Map when Redis is unavailable.
 */
async function _checkRateLimit(
  namespace: string,
  identifier: string,
  windowMs: number,
  max: number
): Promise<boolean> {
  try {
    return await redisRateLimit(namespace, identifier, windowMs, max);
  } catch {
    return _inMemoryRateLimit(`${namespace}:${identifier}`, windowMs, max);
  }
}

export const rateLimitedProcedure = protectedProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    const ip = (ctx.req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      ?? (ctx.req.socket as any)?.remoteAddress ?? "unknown";
    const identifier = ctx.user ? `user:${ctx.user.id}` : `ip:${ip}`;
    const allowed = await _checkRateLimit("std", identifier, 60_000, 300);
    if (!allowed) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Rate limit exceeded. Try again in 60 seconds." });
    }
    return next({ ctx });
  })
);

// ─── Async audit log writer ───────────────────────────────────────────────────
async function _writeAuditLog(p: {
  userId?: number | null; action: string; resourceType: string; entityId?: number;
  ipAddress: string; userAgent: string; path: string; duration: number; success: boolean;
  error?: string; requestId?: string;
}) {
  try {
    const { auditEvents } = await import("../../drizzle/schema");
    const db = await (await import("../db")).getDb();
    if (!db) return;
    const [inserted] = await db.insert(auditEvents).values({
      entityType: p.resourceType as any, entityId: p.entityId ?? 0, action: p.action,
      actorId: p.userId ?? null, actorType: p.userId ? "user" : null,
      ipAddress: p.ipAddress, userAgent: p.userAgent,
      metadata: { path: p.path, duration: p.duration, success: p.success, error: p.error, requestId: p.requestId ?? null },
    }).returning();
    // Async dual-write to OpenSearch (non-blocking, fail-safe)
    if (inserted) {
      setImmediate(async () => {
        try {
          const { indexAuditEvent } = await import("./opensearch");
          await indexAuditEvent({
            id: inserted.id,
            entityType: inserted.entityType ?? p.resourceType,
            entityId: inserted.entityId ?? p.entityId ?? 0,
            action: inserted.action,
            actorId: inserted.actorId,
            actorType: inserted.actorType,
            ipAddress: inserted.ipAddress,
            userAgent: inserted.userAgent,
            entryHash: null,
            prevHash: null,
            createdAt: inserted.createdAt ?? new Date(),
          });
        } catch { /* OpenSearch unavailable — DB write already succeeded */ }
      });
    }
  } catch (e) { console.error("[AuditLog] Write failed:", e); }
}

function _makeAudit(action: string, resourceType: string) {
  return t.middleware(async opts => {
    const { ctx, path, input, next } = opts;
    const start = Date.now(); let errorMsg: string | undefined;
    try { return await next({ ctx }); }
    catch (err) { errorMsg = err instanceof Error ? err.message : String(err); throw err; }
    finally {
      const ip = (ctx.req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
        ?? (ctx.req.socket as any)?.remoteAddress ?? "unknown";
      setImmediate(() => _writeAuditLog({
        userId: ctx.user?.id, action, resourceType,
        entityId: parseInt((input as any)?.id ?? "0") || 0,
        ipAddress: ip, userAgent: (ctx.req.headers["user-agent"] as string) ?? "unknown",
        path, duration: Date.now() - start, success: !errorMsg, error: errorMsg,
      }));
    }
  });
}

// ─── Audited domain procedures ────────────────────────────────────────────────
export const declarationProcedure = protectedProcedure.use(_makeAudit("declaration.mutation", "declaration"));
export const paymentProcedure = protectedProcedure.use(_makeAudit("payment.mutation", "payment"));
export const ogaPermitProcedure = protectedProcedure.use(_makeAudit("oga_permit.mutation", "permit"));
export const aeoProcedure = protectedProcedure.use(_makeAudit("aeo.mutation", "aeo_application"));
export const kycProcedure = protectedProcedure.use(_makeAudit("kyc.mutation", "kyc_verification"));
export const documentProcedure = protectedProcedure.use(_makeAudit("document.mutation", "document"));
export const securityProcedure = protectedProcedure.use(_makeAudit("security.mutation", "user"));
export const adminAuditedProcedure = adminProcedure.use(_makeAudit("admin.mutation", "user"));
