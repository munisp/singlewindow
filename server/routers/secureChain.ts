/**
 * Secure Chain Router (WP-7) — fail-closed tRPC proxy to the
 * blueeconomy-port-interoperability Secure Chain API (Portbase-style
 * PIN-free, verified-chain digital container release).
 *
 * Design rules (mirrors the Go service):
 *  - No PINs or shared secrets: the caller's organisation identity is the
 *    verified session user; the gateway token minted here carries it as the
 *    subject — body-supplied org fields are never trusted.
 *  - Fail-closed: when PORT_INTEROP_URL, the gateway signing key or the
 *    tenant id are missing, every procedure refuses; upstream non-2xx is
 *    surfaced as an error, never silently degraded.
 *  - Env-only secrets: the gateway HMAC key comes from
 *    SECURE_CHAIN_GATEWAY_KEY and is never logged or persisted.
 */
import { createHmac } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";

const PORT_INTEROP_URL = process.env.PORT_INTEROP_URL ?? "";
const GATEWAY_KEY = process.env.SECURE_CHAIN_GATEWAY_KEY ?? "";
const GATEWAY_ISS = process.env.SECURE_CHAIN_GATEWAY_ISS ?? "singlewindow-gateway";
const GATEWAY_AUD = process.env.SECURE_CHAIN_GATEWAY_AUD ?? "s1-port-interoperability";
const TENANT_ID = process.env.PORT_INTEROP_TENANT_ID ?? "";

const containerIdSchema = z.string().regex(/^[A-Z]{4}[0-9]{7}$/, "container_id must be an ISO 6346 number");
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/, "digest must be a SHA-256 hex string");

/** Map the verified singlewindow role onto secure-chain platform roles. */
function chainRoles(role: string): string[] {
  const roles = ["chain-party"];
  if (role === "admin") roles.push("shipping-line");
  if (role === "customs_officer" || role === "inspector") roles.push("gate-officer", "terminal-operator");
  return roles;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Mint the HS256 tenant-gateway token the port-interop API verifies. */
function gatewayToken(subject: string, roles: string[]): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: GATEWAY_ISS,
    aud: GATEWAY_AUD,
    tenant_id: TENANT_ID,
    sub: subject,
    roles,
    exp: Math.floor(Date.now() / 1000) + 300,
  }));
  const signature = createHmac("sha256", GATEWAY_KEY).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function failClosedConfig(): void {
  if (!PORT_INTEROP_URL || !GATEWAY_KEY || GATEWAY_KEY.length < 32 || !TENANT_ID) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Secure Chain is not configured (PORT_INTEROP_URL / SECURE_CHAIN_GATEWAY_KEY / PORT_INTEROP_TENANT_ID); refusing fail-closed",
    });
  }
}

type CtxUser = { id: number; openId: string; role: string };

async function portInterop<T>(user: CtxUser, method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  failClosedConfig();
  const token = gatewayToken(user.openId || `sw-user-${user.id}`, chainRoles(user.role));
  let response: Response;
  try {
    response = await fetch(`${PORT_INTEROP_URL}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-trusted-proxy": "loopback",
        "x-authenticated-principal": user.openId || `sw-user-${user.id}`,
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Secure Chain upstream unreachable: ${(error as Error).message}` });
  }
  const text = await response.text();
  if (!response.ok) {
    // Fail-closed propagation: upstream denials (403/404/422) are surfaced,
    // never retried into a weaker path.
    throw new TRPCError({
      code: response.status === 403 ? "FORBIDDEN" : response.status === 404 ? "NOT_FOUND" : "BAD_REQUEST",
      message: `Secure Chain refused (${response.status}): ${text.slice(0, 300)}`,
    });
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export const secureChainRouter = router({
  /** Register the calling shipping line's B/L release authority. */
  registerBLAuthority: protectedProcedure
    .input(z.object({ containerId: containerIdSchema, blDigest: digestSchema }))
    .mutation(({ ctx, input }) =>
      portInterop(ctx.user, "POST", "/v1/secure-chain/bl-registry", {
        container_id: input.containerId, bl_digest: input.blDigest,
      })),

  /** Open a release chain (idempotent on idempotencyKey). */
  createChain: protectedProcedure
    .input(z.object({
      containerId: containerIdSchema,
      blDigest: digestSchema,
      expiresAt: z.string().datetime(),
      idempotencyKey: z.string().min(8).max(128),
    }))
    .mutation(({ ctx, input }) =>
      portInterop(ctx.user, "POST", "/v1/secure-chains", {
        container_id: input.containerId, bl_digest: input.blDigest, expires_at: input.expiresAt,
      }, input.idempotencyKey)),

  /** Chain status with hash-chained links (terminal release status view). */
  getChain: protectedProcedure
    .input(z.object({ containerId: containerIdSchema }))
    .query(({ ctx, input }) => portInterop(ctx.user, "GET", `/v1/secure-chains/${input.containerId}`)),

  /** Hash-chained append-only audit trail (digest evidence view). */
  auditTrail: protectedProcedure
    .input(z.object({ chainId: z.string().uuid() }))
    .query(({ ctx, input }) => portInterop(ctx.user, "GET", `/v1/secure-chains/audit/${input.chainId}`)),

  /** Nominate the next organisation (caller must hold the verified tail). */
  nominate: protectedProcedure
    .input(z.object({ chainId: z.string().uuid(), toOrg: z.string().min(2).max(128) }))
    .mutation(({ ctx, input }) =>
      portInterop(ctx.user, "POST", `/v1/secure-chains/${input.chainId}/nominations`, { to_org: input.toOrg })),

  accept: protectedProcedure
    .input(z.object({ chainId: z.string().uuid(), seq: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      portInterop(ctx.user, "POST", `/v1/secure-chains/${input.chainId}/links/${input.seq}/accept`, {})),

  decline: protectedProcedure
    .input(z.object({ chainId: z.string().uuid(), seq: z.number().int().positive(), reason: z.string().min(1).max(500) }))
    .mutation(({ ctx, input }) =>
      portInterop(ctx.user, "POST", `/v1/secure-chains/${input.chainId}/links/${input.seq}/decline`, { reason: input.reason })),

  revoke: protectedProcedure
    .input(z.object({ chainId: z.string().uuid(), reason: z.string().min(1).max(500) }))
    .mutation(({ ctx, input }) =>
      portInterop(ctx.user, "POST", `/v1/secure-chains/${input.chainId}/revoke`, { reason: input.reason })),

  /**
   * Terminal-release check: 200 with the signed single-use token only for
   * the verified chain tail holder. The eCallUp truck-booking flow presents
   * this before gate check-in.
   */
  releaseAuthorization: protectedProcedure
    .input(z.object({ containerId: containerIdSchema }))
    .query(({ ctx, input }) =>
      portInterop(ctx.user, "GET", `/v1/secure-chain/${input.containerId}/release-authorization`)),

  /** Gate/eCallUp check-in consumes the single-use token. */
  consumeRelease: protectedProcedure
    .input(z.object({ nonce: digestSchema, gateId: z.string().min(1).max(64) }))
    .mutation(({ ctx, input }) =>
      portInterop(ctx.user, "POST", "/v1/secure-chain/consume", { nonce: input.nonce, gate_id: input.gateId })),

  /**
   * eCallUp booking hook: the chain requirement banner for a truck booking
   * bound to an import container — reports whether the caller currently
   * holds the verified tail (bookable) or the chain blocks the booking.
   */
  bookingRequirement: protectedProcedure
    .input(z.object({ containerId: containerIdSchema }))
    .query(async ({ ctx, input }) => {
      try {
        const chain = await portInterop<Record<string, unknown>>(ctx.user, "GET", `/v1/secure-chains/${input.containerId}`);
        return { required: true as const, chain };
      } catch (error) {
        if (error instanceof TRPCError && error.code === "NOT_FOUND") {
          return { required: false as const, chain: null };
        }
        throw error;
      }
    }),
});
