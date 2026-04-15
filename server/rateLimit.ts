/**
 * TradeGateway™ NGSWTP — In-Memory Rate Limiter
 *
 * Provides rate limiting using an in-memory store as a Redis fallback.
 * In production with Redis available, this can be swapped for ioredis-based
 * rate limiting. For demo/dev mode, the in-memory store is sufficient.
 *
 * Uses a sliding window algorithm with automatic cleanup of expired entries.
 */

import type { Request, Response, NextFunction } from "express";
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, RATE_LIMIT_API_MAX } from "@shared/config";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store — replaced by Redis in production
const store = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  const keys = Array.from(store.keys());
  for (const key of keys) {
    const entry = store.get(key);
    if (entry && entry.resetAt < now) store.delete(key);
  }
}, 5 * 60 * 1000);

function getClientKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = forwarded
    ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0]).trim()
    : req.socket.remoteAddress ?? "unknown";
  return ip;
}

function checkRateLimit(key: string, windowMs: number, maxRequests: number): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

/**
 * General rate limiter middleware — applies to all routes.
 * Default: 100 requests per minute per IP.
 */
export function generalRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/api/health/live" || req.path === "/api/health/ready") {
    next();
    return;
  }

  const key = `general:${getClientKey(req)}`;
  const { allowed, remaining, resetAt } = checkRateLimit(key, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX);

  res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", Math.ceil(resetAt / 1000));

  if (!allowed) {
    res.status(429).json({
      error: "Too Many Requests",
      message: "Rate limit exceeded. Please wait before making more requests.",
      retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
    });
    return;
  }

  next();
}

/**
 * API-specific rate limiter — more permissive for authenticated API calls.
 * Default: 300 requests per minute per IP.
 */
export function apiRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = `api:${getClientKey(req)}`;
  const { allowed, remaining, resetAt } = checkRateLimit(key, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_API_MAX);

  res.setHeader("X-RateLimit-Limit", RATE_LIMIT_API_MAX);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", Math.ceil(resetAt / 1000));

  if (!allowed) {
    res.status(429).json({
      error: "Too Many Requests",
      message: "API rate limit exceeded.",
      retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
    });
    return;
  }

  next();
}

/**
 * Strict rate limiter for auth endpoints — 10 attempts per 15 minutes per IP.
 */
export function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = `auth:${getClientKey(req)}`;
  const { allowed, remaining, resetAt } = checkRateLimit(key, 15 * 60 * 1000, 10);

  res.setHeader("X-RateLimit-Limit", 10);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", Math.ceil(resetAt / 1000));

  if (!allowed) {
    res.status(429).json({
      error: "Too Many Requests",
      message: "Too many authentication attempts. Please wait 15 minutes.",
      retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
    });
    return;
  }

  next();
}
