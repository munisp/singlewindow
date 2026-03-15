/**
 * TradeGateway™ NGSWTP — Production Middleware Utilities
 * =======================================================
 * Pure utility functions used by trpc.ts to build middleware.
 * No tRPC instance is created here — all middleware is built in trpc.ts
 * using the single shared `t` instance to preserve TypeScript type narrowing.
 */

import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import crypto from "crypto";

// ─── In-Memory Rate Limiter ───────────────────────────────────────────────────
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

export function checkRateLimit(
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

// ─── Audit Log Writer ─────────────────────────────────────────────────────────
export async function writeAuditLog(opts: {
  userId?: number | null;
  action: string;
  resourceType: string;
  entityId?: number;
  ipAddress: string;
  userAgent: string;
  path: string;
  duration: number;
  success: boolean;
  error?: string;
  requestId?: string;
}): Promise<void> {
  try {
    const { auditEvents } = await import("../../drizzle/schema");
    const dbInstance = await getDb();
    if (!dbInstance) return;
    await dbInstance.insert(auditEvents).values({
      entityType: opts.resourceType as any,
      entityId: opts.entityId ?? 0,
      action: opts.action,
      actorId: opts.userId ?? null,
      actorType: opts.userId ? "user" : null,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent,
      metadata: {
        path: opts.path,
        duration: opts.duration,
        success: opts.success,
        error: opts.error,
        requestId: opts.requestId ?? null,
      },
    });
  } catch (auditError) {
    console.error("[AuditLog] Failed to write audit log:", auditError);
  }
}

// ─── Permify Check ────────────────────────────────────────────────────────────
export async function checkPermify(opts: {
  userId: number;
  entity: string;
  entityId: string;
  permission: string;
}): Promise<boolean> {
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
          entity: { type: opts.entity, id: opts.entityId },
          permission: opts.permission,
          subject: { type: "user", id: String(opts.userId) },
        }),
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) {
      console.error("[Permify] Check failed:", response.status);
      return process.env.NODE_ENV !== "production"; // fail open in dev
    }

    const data = (await response.json()) as { can: string };
    return data.can === "CHECK_RESULT_ALLOWED";
  } catch (error) {
    console.error("[Permify] Unexpected error:", error);
    return process.env.NODE_ENV !== "production"; // fail open in dev
  }
}

// ─── Structured Error Formatter ───────────────────────────────────────────────
export function formatTRPCError(error: unknown, path?: string): TRPCError {
  if (error instanceof TRPCError) return error;

  const message =
    error instanceof Error ? error.message : "An unexpected error occurred";

  if (message.includes("duplicate key") || message.includes("unique constraint")) {
    return new TRPCError({ code: "CONFLICT", message: "A record with this identifier already exists" });
  }
  if (message.includes("foreign key") || message.includes("violates foreign key")) {
    return new TRPCError({ code: "BAD_REQUEST", message: "Referenced record does not exist" });
  }
  if (message.includes("not found") || message.includes("no rows")) {
    return new TRPCError({ code: "NOT_FOUND", message: "The requested resource was not found" });
  }

  console.error(`[tRPC Error] ${path ?? "unknown"}:`, error);
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "An internal error occurred" });
}

// ─── Input Sanitisation Helper ────────────────────────────────────────────────
export function sanitiseInput(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\0/g, "").trim();
  if (Array.isArray(value)) return value.map(sanitiseInput);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitiseInput(v)])
    );
  }
  return value;
}

// ─── Request ID Generator ─────────────────────────────────────────────────────
export function generateRequestId(req: { headers: Record<string, string | string[] | undefined> }): string {
  return (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID();
}
