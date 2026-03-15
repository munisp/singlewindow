import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { redisRateLimit } from './redis';

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

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

// ─── Rate Limiting (Redis-backed sliding window, in-memory fallback) ──────────

// In-memory fallback store for when Redis is unavailable
const _rateLimitStore = new Map<string, { count: number; resetAt: number }>();
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
    await db.insert(auditEvents).values({
      entityType: p.resourceType as any, entityId: p.entityId ?? 0, action: p.action,
      actorId: p.userId ?? null, actorType: p.userId ? "user" : null,
      ipAddress: p.ipAddress, userAgent: p.userAgent,
      metadata: { path: p.path, duration: p.duration, success: p.success, error: p.error, requestId: p.requestId ?? null },
    });
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
