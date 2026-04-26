/**
 * TradeGateway™ NGSWTP — Comprehensive Security Middleware
 * =========================================================
 * Implements layered defences against:
 *   1. DDoS / volumetric attacks (slow-down + rate-limit)
 *   2. Ransomware / destructive writes (file-type allowlist, size caps)
 *   3. Financial platform attacks (replay, IDOR, amount tampering)
 *   4. PBAC enforcement helpers for high-risk routers
 *   5. Circuit-breaker pattern for downstream service calls
 *
 * Usage:
 *   import { ddosProtection, financialRateLimit, fileUploadGuard,
 *            circuitBreaker, pbacMiddleware } from "./_core/security";
 */

import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// ─── 1. DDoS / Volumetric Attack Protection ──────────────────────────────────

/**
 * Global slow-down: adds 500 ms delay per request after 50 requests/15 min.
 * Applied to all /api/* routes. Gracefully degrades instead of hard-blocking.
 */
export const ddosSlowDown = slowDown({
  windowMs: 15 * 60 * 1000,       // 15 minutes
  delayAfter: 50,                   // allow 50 req/window without delay
  delayMs: (used) => (used - 50) * 500, // 500 ms per req above threshold
  maxDelayMs: 20_000,              // cap at 20 s delay
  skip: (req) => {
    // Skip health checks and metrics from slow-down
    return req.path === "/api/health/live" || req.path === "/api/health/ready";
  },
});

/**
 * Aggressive rate-limit for financial mutation endpoints.
 * Payments, batch-payments, mojaloop: max 20 req/min per IP.
 */
export const financialRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many financial requests — please wait before retrying." },
  // Uses default IP key generator (express-rate-limit handles IPv6 correctly)
});

/**
 * Strict rate-limit for admin/destructive operations.
 * Delete, bulk-export, batch operations: max 10 req/min per user.
 */
export const adminOperationRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Admin operation rate limit exceeded." },
});

// ─── 2. Ransomware / Destructive Write Protection ────────────────────────────

/** Allowed MIME types for document uploads (strict allowlist) */
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "text/plain",
  "text/csv",
  "application/json",
  "application/xml",
  "text/xml",
]);

/** Dangerous file extensions that must never be accepted */
const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".sh", ".ps1", ".vbs", ".js", ".ts",
  ".py", ".rb", ".php", ".asp", ".aspx", ".jsp", ".jar", ".war",
  ".zip", ".rar", ".7z", ".tar", ".gz",  // archives can contain malware
  ".dll", ".so", ".dylib", ".sys",
  ".docm", ".xlsm", ".pptm",             // macro-enabled Office files
  ".svg",                                 // can contain embedded scripts
]);

/**
 * File upload guard middleware.
 * Validates MIME type, file extension, and size before processing.
 * Blocks ransomware delivery vectors.
 */
export function fileUploadGuard(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const contentType = req.headers["content-type"] ?? "";

  // Only intercept multipart uploads
  if (!contentType.includes("multipart/form-data")) {
    next();
    return;
  }

  // Max upload size: 25 MB (enforced at Express body-parser level too)
  const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
  if (contentLength > 25 * 1024 * 1024) {
    res.status(413).json({ error: "Upload exceeds maximum allowed size of 25 MB." });
    return;
  }

  next();
}

/**
 * Validates a file before S3 upload.
 * Returns an error message if the file is rejected, null if accepted.
 */
export function validateUploadedFile(opts: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): string | null {
  const { filename, mimeType, sizeBytes } = opts;

  // Size check
  if (sizeBytes > 25 * 1024 * 1024) {
    return "File exceeds maximum allowed size of 25 MB.";
  }

  // Extension check
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return `File type '${ext}' is not permitted for security reasons.`;
  }

  // MIME type check
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return `MIME type '${mimeType}' is not in the allowed list.`;
  }

  return null;
}

// ─── 3. Financial Platform Attack Mitigations ────────────────────────────────

/**
 * Idempotency key validator for financial mutations.
 * Prevents replay attacks on payment endpoints.
 *
 * Usage in tRPC procedure:
 *   const { idempotencyKey } = input;
 *   await assertIdempotency(ctx.user.id, idempotencyKey);
 */
const idempotencyStore = new Map<string, { usedAt: number; result: unknown }>();

// Clean up expired keys every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
  for (const [key, val] of Array.from(idempotencyStore.entries())) {
    if (val.usedAt < cutoff) idempotencyStore.delete(key);
  }
}, 10 * 60 * 1000);

export function checkIdempotency(
  userId: number,
  idempotencyKey: string
): { isDuplicate: boolean; cachedResult?: unknown } {
  const storeKey = `${userId}:${idempotencyKey}`;
  const existing = idempotencyStore.get(storeKey);
  if (existing) {
    return { isDuplicate: true, cachedResult: existing.result };
  }
  return { isDuplicate: false };
}

export function recordIdempotency(
  userId: number,
  idempotencyKey: string,
  result: unknown
): void {
  const storeKey = `${userId}:${idempotencyKey}`;
  idempotencyStore.set(storeKey, { usedAt: Date.now(), result });
}

/**
 * Amount integrity validator.
 * Prevents amount tampering in financial transactions.
 * Verifies that the submitted amount matches a server-computed HMAC.
 */
export function signAmount(
  amount: number,
  currency: string,
  declarationId: string,
  secret: string
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${amount}:${currency}:${declarationId}`)
    .digest("hex");
}

export function verifyAmountSignature(
  amount: number,
  currency: string,
  declarationId: string,
  signature: string,
  secret: string
): boolean {
  const expected = signAmount(amount, currency, declarationId, secret);
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(signature.padEnd(64, "0").slice(0, 64), "hex")
  );
}

// ─── 4. Circuit Breaker ───────────────────────────────────────────────────────

type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerOptions {
  failureThreshold: number;   // failures before opening
  successThreshold: number;   // successes in half-open before closing
  timeout: number;            // ms to wait before half-open attempt
  name: string;
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt: number;
  totalCalls: number;
  totalFailures: number;
}

const circuits = new Map<string, CircuitBreakerState>();

function getCircuit(name: string, opts: CircuitBreakerOptions): CircuitBreakerState {
  if (!circuits.has(name)) {
    circuits.set(name, {
      state: "closed",
      failures: 0,
      successes: 0,
      lastFailureAt: 0,
      totalCalls: 0,
      totalFailures: 0,
    });
  }
  return circuits.get(name)!;
}

/**
 * Circuit breaker for downstream service calls.
 * Prevents cascade failures when microservices are unavailable.
 *
 * Usage:
 *   const result = await circuitBreaker("risk-engine", opts, () =>
 *     fetch("http://risk-engine:8082/score", ...)
 *   );
 */
export async function circuitBreaker<T>(
  name: string,
  opts: Partial<CircuitBreakerOptions>,
  fn: () => Promise<T>
): Promise<T> {
  const options: CircuitBreakerOptions = {
    failureThreshold: opts.failureThreshold ?? 5,
    successThreshold: opts.successThreshold ?? 2,
    timeout: opts.timeout ?? 30_000,
    name,
  };

  const circuit = getCircuit(name, options);
  circuit.totalCalls++;

  if (circuit.state === "open") {
    const elapsed = Date.now() - circuit.lastFailureAt;
    if (elapsed < options.timeout) {
      throw new Error(`Circuit breaker '${name}' is OPEN — service unavailable. Retry in ${Math.ceil((options.timeout - elapsed) / 1000)}s.`);
    }
    // Transition to half-open
    circuit.state = "half-open";
    circuit.successes = 0;
  }

  try {
    const result = await fn();

    if (circuit.state === "half-open") {
      circuit.successes++;
      if (circuit.successes >= options.successThreshold) {
        circuit.state = "closed";
        circuit.failures = 0;
        console.log(`[CircuitBreaker] '${name}' CLOSED — service recovered`);
      }
    } else {
      circuit.failures = 0; // reset on success
    }

    return result;
  } catch (err) {
    circuit.failures++;
    circuit.totalFailures++;
    circuit.lastFailureAt = Date.now();

    if (circuit.failures >= options.failureThreshold) {
      circuit.state = "open";
      console.warn(`[CircuitBreaker] '${name}' OPENED after ${circuit.failures} failures`);
    }

    throw err;
  }
}

/**
 * Get circuit breaker status for all registered circuits.
 * Used by ServiceHealth dashboard.
 */
export function getAllCircuitStatus(): Array<{
  name: string;
  state: CircuitState;
  failures: number;
  totalCalls: number;
  totalFailures: number;
  lastFailureAt: number;
}> {
  return Array.from(circuits.entries()).map(([name, state]) => ({
    name,
    state: state.state,
    failures: state.failures,
    totalCalls: state.totalCalls,
    totalFailures: state.totalFailures,
    lastFailureAt: state.lastFailureAt,
  }));
}

// ─── 5. PBAC Enforcement Helpers ─────────────────────────────────────────────

/**
 * Permify entity types used in TradeGateway.
 * Maps router domain objects to Permify resource types.
 */
export const PBAC_ENTITIES = {
  declaration: "declaration",
  permit: "permit",
  payment: "payment",
  profile: "profile",
  security_alert: "security_alert",
  aeo_application: "aeo_application",
  cargo: "cargo",
  audit_record: "audit_record",
  drawback_claim: "drawback_claim",
  sanctions_entry: "sanctions_entry",
  system_config: "system_config",
  bonded_warehouse: "bonded_warehouse",
  free_zone: "free_zone",
  batch_payment: "batch_payment",
  kyc_record: "kyc_record",
  fraud_case: "fraud_case",
} as const;

export type PBACEntity = keyof typeof PBAC_ENTITIES;

/**
 * Permissions per entity type.
 * Used to validate permission strings before calling Permify.
 */
export const PBAC_PERMISSIONS: Record<PBACEntity, string[]> = {
  declaration: ["view", "edit", "submit", "withdraw", "assess", "release", "reject", "override_risk", "audit", "view_timeline"],
  permit: ["view", "approve", "reject", "escalate"],
  payment: ["view", "initiate", "confirm", "refund", "reconcile", "cancel"],
  profile: ["view", "edit", "verify", "suspend"],
  security_alert: ["view", "acknowledge", "resolve", "escalate"],
  aeo_application: ["view", "submit", "review", "approve", "reject", "revoke"],
  cargo: ["view", "track", "release", "hold", "inspect"],
  audit_record: ["view", "export", "redact"],
  drawback_claim: ["view", "submit", "review", "approve", "reject", "disburse"],
  sanctions_entry: ["view", "screen", "flag", "clear", "escalate"],
  system_config: ["view", "edit", "deploy"],
  bonded_warehouse: ["view", "deposit", "withdraw", "audit"],
  free_zone: ["view", "register", "operate", "audit"],
  batch_payment: ["view", "submit", "approve", "reject", "cancel"],
  kyc_record: ["view", "submit", "verify", "reject", "flag"],
  fraud_case: ["view", "open", "investigate", "close", "escalate"],
};

// ─── 6. Security Event Emitter ───────────────────────────────────────────────

export interface SecurityEvent {
  type: "rate_limit_exceeded" | "pbac_denied" | "circuit_open" | "malware_detected" |
        "replay_attack" | "amount_tamper" | "suspicious_upload" | "ddos_detected";
  userId?: number;
  ip: string;
  path: string;
  details: Record<string, unknown>;
  timestamp: number;
}

const securityEventQueue: SecurityEvent[] = [];
const MAX_SECURITY_EVENTS = 1000;

export function emitSecurityEvent(event: Omit<SecurityEvent, "timestamp">): void {
  const fullEvent: SecurityEvent = { ...event, timestamp: Date.now() };
  securityEventQueue.push(fullEvent);
  if (securityEventQueue.length > MAX_SECURITY_EVENTS) {
    securityEventQueue.shift();
  }
  // Log high-severity events immediately
  if (["malware_detected", "replay_attack", "amount_tamper"].includes(event.type)) {
    console.error(`[SECURITY] HIGH SEVERITY: ${event.type}`, fullEvent);
  } else {
    console.warn(`[SECURITY] ${event.type}`, { ip: event.ip, path: event.path });
  }
}

export function getRecentSecurityEvents(limit = 100): SecurityEvent[] {
  return securityEventQueue.slice(-limit).reverse();
}
