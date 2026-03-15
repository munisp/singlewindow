/**
 * TradeGateway™ NGSWTP — Production tRPC Middleware
 * ===================================================
 * Provides: rate limiting, audit logging, input sanitisation,
 * structured error handling, request tracing, and Permify integration.
 */

import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getDb } from "../db";
import crypto from "crypto";

const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });

// ─── In-Memory Rate Limiter ───────────────────────────────────────────────────
// In production, replace with Redis-backed rate limiter using ioredis
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

function checkRateLimit(
  key: string,
  opts: RateLimitOptions
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const storeKey = `${opts.keyPrefix ?? "rl"}:${key}`;
  const entry = rateLimitStore.get(storeKey);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + opts.windowMs;
    rateLimitStore.set(storeKey, { count: 1, resetAt });
    return { allowed: true, remaining: opts.maxRequests - 1, resetAt };
  }

  if (entry.count >= opts.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: opts.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

// ─── Request ID Middleware ────────────────────────────────────────────────────
export const withRequestId = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  const requestId =
    (ctx.req.headers["x-request-id"] as string | undefined) ??
    crypto.randomUUID();

  return next({
    ctx: {
      ...ctx,
      requestId,
    },
  });
});

// ─── Rate Limiting Middleware ─────────────────────────────────────────────────
export const createRateLimitMiddleware = (rateLimitOpts: RateLimitOptions) =>
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    const ip =
      (ctx.req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0]
        ?.trim() ??
      ctx.req.socket?.remoteAddress ??
      "unknown";

    const key = ctx.user ? `user:${ctx.user.id}` : `ip:${ip}`;
    const result = checkRateLimit(key, rateLimitOpts);

    if (!result.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Rate limit exceeded. Try again after ${new Date(result.resetAt).toISOString()}`,
      });
    }

    return next({ ctx });
  });

// ─── Audit Logging Middleware ─────────────────────────────────────────────────
export const createAuditMiddleware = (action: string, resourceType?: string) =>
  t.middleware(async (opts) => {
    const { ctx, path, input, next } = opts;
    const requestId = (ctx as TrpcContext & { requestId?: string }).requestId;
    const ip =
      (ctx.req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0]
        ?.trim() ??
      ctx.req.socket?.remoteAddress ??
      "unknown";
    const userAgent = (ctx.req.headers["user-agent"] as string | undefined) ?? "unknown";

    const startTime = Date.now();
    let errorOccurred = false;
    let errorMessage: string | undefined;

    try {
      const result = await next({ ctx });
      return result;
    } catch (error) {
      errorOccurred = true;
      errorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      const duration = Date.now() - startTime;

      // Write audit log asynchronously — never block the response
      setImmediate(async () => {
        try {
          // Dynamic import to avoid circular deps
          const { auditEvents } = await import("../../drizzle/schema");
          const dbInstance = await getDb();
          if (!dbInstance) return;
          await dbInstance.insert(auditEvents).values({
            entityType: (resourceType ?? path.split(".")[0]) as any,
            entityId: parseInt((input as Record<string, unknown> | null)?.id as string ?? "0") || 0,
            action: action ?? path,
            actorId: ctx.user?.id ?? null,
            actorType: ctx.user ? "user" : null,
            ipAddress: ip,
            userAgent,
            metadata: {
              path,
              duration,
              success: !errorOccurred,
              error: errorMessage,
              requestId: requestId ?? null,
            },
          });
        } catch (auditError) {
          // Never let audit failures break the main flow
          console.error("[AuditLog] Failed to write audit log:", auditError);
        }
      });
    }
  });

// ─── Input Sanitisation Helper ───────────────────────────────────────────────
// Used inside procedures to sanitise inputs before processing.
// tRPC v11 does not support rawInput override in middleware; sanitise at the
// procedure level using this helper instead.
export function sanitiseInput(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\0/g, "").trim();
  }
  if (Array.isArray(value)) {
    return value.map(sanitiseInput);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        sanitiseInput(v),
      ])
    );
  }
  return value;
}

// ─── Permify Authorization Middleware ────────────────────────────────────────
interface PermifyCheckOptions {
  entity: string;
  permission: string;
  getEntityId: (input: unknown, ctx: TrpcContext) => string | undefined;
}

export const createPermifyMiddleware = (permifyOpts: PermifyCheckOptions) =>
  t.middleware(async (opts) => {
    const { ctx, input, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
    }

    const entityId = permifyOpts.getEntityId(input, ctx);
    if (!entityId) {
      return next({ ctx });
    }

    try {
      const permifyUrl = process.env.PERMIFY_URL ?? "http://permify:3476";
      const permifyKey = process.env.PERMIFY_API_KEY ?? "";

      const response = await fetch(
        `${permifyUrl}/v1/tenants/tradegateway/permissions/check`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(permifyKey ? { Authorization: `Bearer ${permifyKey}` } : {}),
          },
          body: JSON.stringify({
            metadata: { schema_version: "", snap_token: "", depth: 20 },
            entity: { type: permifyOpts.entity, id: entityId },
            permission: permifyOpts.permission,
            subject: { type: "user", id: ctx.user.id },
          }),
          signal: AbortSignal.timeout(5000),
        }
      );

      if (!response.ok) {
        console.error("[Permify] Check failed:", response.status);
        if (process.env.NODE_ENV === "production") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Authorization check failed" });
        }
      } else {
        const data = (await response.json()) as { can: string };
        if (data.can !== "CHECK_RESULT_ALLOWED") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `You do not have '${permifyOpts.permission}' permission on this ${permifyOpts.entity}`,
          });
        }
      }
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error("[Permify] Unexpected error:", error);
      if (process.env.NODE_ENV === "production") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Authorization service unavailable",
        });
      }
    }

    return next({ ctx });
  });

// ─── Structured Error Formatter ───────────────────────────────────────────────
export function formatTRPCError(error: unknown, path?: string): TRPCError {
  if (error instanceof TRPCError) return error;

  const message =
    error instanceof Error ? error.message : "An unexpected error occurred";

  if (
    message.includes("duplicate key") ||
    message.includes("unique constraint")
  ) {
    return new TRPCError({
      code: "CONFLICT",
      message: "A record with this identifier already exists",
    });
  }
  if (
    message.includes("foreign key") ||
    message.includes("violates foreign key")
  ) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "Referenced record does not exist",
    });
  }
  if (message.includes("not found") || message.includes("no rows")) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "The requested resource was not found",
    });
  }

  console.error(`[tRPC Error] ${path ?? "unknown"}:`, error);
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "An internal error occurred",
  });
}

// ─── Pre-built Rate Limit Configurations ─────────────────────────────────────
export const standardRateLimit = createRateLimitMiddleware({
  windowMs: 60_000,
  maxRequests: 300,
  keyPrefix: "std",
});

export const strictRateLimit = createRateLimitMiddleware({
  windowMs: 60_000,
  maxRequests: 10,
  keyPrefix: "strict",
});

export const publicRateLimit = createRateLimitMiddleware({
  windowMs: 60_000,
  maxRequests: 100,
  keyPrefix: "pub",
});
