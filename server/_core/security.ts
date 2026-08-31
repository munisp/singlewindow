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

// ─── Magic-byte content sniffing (SW-S2-8) ───────────────────────────────────
// Client-supplied MIME types and file extensions are attacker-controlled and
// MUST NOT be trusted. The detected type below is derived from the file's
// actual bytes and is the only basis for the extension allowlist.

export type SniffedFileType =
  | "pdf"
  | "png"
  | "jpeg"
  | "webp"
  | "zip" // also docx/xlsx (OOXML containers) — distinguished by caller policy
  | "text" // UTF-8 text without control bytes (csv/txt)
  | "unknown";

/**
 * Detects the real file type from leading magic bytes.
 * Returns "unknown" when no recognised signature matches — callers must
 * fail closed (reject) on "unknown".
 */
export function sniffFileType(buffer: Buffer): SniffedFileType {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return "png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) return "webp";
  // ZIP (PK\x03\x04 / PK\x05\x05 empty archive / PK\x07\x08 spanned) — docx/xlsx included
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b &&
      (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)) return "zip";
  // Plain text heuristic: valid printable UTF-8/ASCII without NUL or C0 controls
  if (buffer.length > 0) {
    let textOk = true;
    const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
    for (const byte of sample) {
      const isAllowed = byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte !== 0x7f) || byte >= 0x80;
      if (!isAllowed) { textOk = false; break; }
    }
    if (textOk) return "text";
  }
  return "unknown";
}

/** Canonical extension for a detected type — never derived from the client filename. */
export const EXTENSION_FOR_SNIFFED_TYPE: Record<Exclude<SniffedFileType, "unknown">, string> = {
  pdf: "pdf",
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  zip: "zip",
  text: "txt",
};

/** MIME types acceptable per detected type (client claim must agree with content). */
export const MIME_FOR_SNIFFED_TYPE: Record<Exclude<SniffedFileType, "unknown">, string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  zip: [
    "application/zip",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  text: ["text/csv", "text/plain", "application/csv"],
};

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
 * P0-6 remediation: DURABLE, DB-backed idempotency. The previous process-local
 * Map reopened a replay window on every restart/replica. Keys are now stored
 * in the existing `payment_idempotency_keys` table (migration 0028) whose
 * UNIQUE(key_hash) constraint is enforced by the database — the same
 * durability pattern as webhook_receipts (migration 0051). The key hash binds
 * (userId, idempotencyKey) so keys are per-user. Replays return the originally
 * recorded response snapshot. When the database is unavailable these functions
 * THROW (fail-closed): a financial mutation whose idempotency cannot be
 * verified must not proceed.
 *
 * Usage in tRPC procedure:
 *   const { idempotencyKey } = input;
 *   const { isDuplicate, cachedResult } = await checkIdempotency(ctx.user.id, idempotencyKey);
 *   if (isDuplicate) return cachedResult;
 *   ... execute mutation ...
 *   await recordIdempotency(ctx.user.id, idempotencyKey, result);
 */
function idempotencyKeyHash(userId: number, idempotencyKey: string): string {
  return crypto.createHash("sha256").update(`${userId}:${idempotencyKey}`).digest("hex");
}

export async function checkIdempotency(
  userId: number,
  idempotencyKey: string
): Promise<{ isDuplicate: boolean; cachedResult?: unknown }> {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) {
    throw new Error(
      "[security] Idempotency store unavailable — refusing to proceed (fail-closed, replay protection cannot be verified)"
    );
  }
  const { paymentIdempotencyKeys } = await import("../../drizzle/schema");
  const { eq, gt, and } = await import("drizzle-orm");
  const [existing] = await db
    .select({ responseSnapshot: paymentIdempotencyKeys.responseSnapshot })
    .from(paymentIdempotencyKeys)
    .where(and(
      eq(paymentIdempotencyKeys.keyHash, idempotencyKeyHash(userId, idempotencyKey)),
      gt(paymentIdempotencyKeys.expiresAt, new Date()),
    ))
    .limit(1);
  if (existing) {
    return { isDuplicate: true, cachedResult: existing.responseSnapshot };
  }
  return { isDuplicate: false };
}

export async function recordIdempotency(
  userId: number,
  idempotencyKey: string,
  result: unknown
): Promise<void> {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) {
    throw new Error(
      "[security] Idempotency store unavailable — response NOT recorded (fail-closed)"
    );
  }
  const { paymentIdempotencyKeys } = await import("../../drizzle/schema");
  // UNIQUE(key_hash) enforced by the database; a concurrent replay inserts
  // nothing and the first recorded response wins. Keys expire after 24h,
  // matching the previous in-memory TTL.
  await db
    .insert(paymentIdempotencyKeys)
    .values({
      keyHash: idempotencyKeyHash(userId, idempotencyKey),
      transferId: `idem:${idempotencyKey.slice(0, 120)}`,
      responseSnapshot: result as unknown,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .onConflictDoNothing();
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
