/**
 * msw.ts — Maritime Single Window (MSW / IMO FAL) tRPC router (Phase 9 WP-C).
 *
 * Thin PBAC-gated surface over server/mswService.ts (the producing boundary
 * blueeconomy-singlewindow-msw for topic maritime.msw.v1; contract:
 * blueeconomy-contracts commit eb6b1ae — proto/blueeconomy/msw/v1/msw.proto
 * + docs/msw.md).
 *
 * PBAC roles (Keycloak realm roles via keycloakRoleProcedure; docs/msw.md
 * §Single-submission and versioning):
 *   msw-agent        — createVisit, nominateAgent, submitDeclaration
 *   msw-port-health  — grantPratique / refusePratique (+ agency decisions)
 *   msw-nis, msw-customs, msw-ndlea, msw-nimasa, msw-npa — declaration review,
 *                      boarding and clearance decisions
 *
 * FAIL CLOSED: stable reason codes (MswServiceError.reasonCode) are surfaced
 * in the error message; port-call verification is real or honestly flagged
 * (PORT_CALL_UNAVAILABLE when the adapter is unconfigured); signing keys are
 * env-only (MswSigningConfigError → PRECONDITION_FAILED, no unsigned
 * admission); nothing is fabricated.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { IMO_NUMBER_MESSAGE, isValidImoNumber } from "../_core/vesselIds";
import {
  MSW_AGENCIES,
  MSW_CLEARANCE_KINDS,
  MSW_FORM_TYPES,
  MswSigningConfigError,
} from "../_core/mswEnvelope";
import {
  acceptDeclaration,
  completeBoarding,
  createVisit,
  grantClearance,
  grantPratique,
  MSW_AGENCY_ROLES,
  MswServiceError,
  nominateAgent,
  refuseClearance,
  refusePratique,
  returnDeclaration,
  scheduleBoarding,
  submitDeclaration,
  type MswPrincipal,
  type MswRole,
} from "../mswService";

const AGENCY_SET = z.enum(MSW_AGENCIES);

/** Maps service/config errors onto tRPC codes; reason codes stay in the message. */
function toTrpcError(err: unknown): never {
  if (err instanceof MswServiceError) {
    const code =
      err.reasonCode === "VISIT_NOT_FOUND" ||
      err.reasonCode === "DECLARATION_NOT_FOUND" ||
      err.reasonCode === "BOARDING_NOT_FOUND"
        ? "NOT_FOUND"
        : err.reasonCode === "MAKER_CHECKER_VIOLATION"
          ? "FORBIDDEN"
          : err.reasonCode === "DATABASE_UNAVAILABLE" || err.reasonCode === "PORT_CALL_UNAVAILABLE"
            ? "PRECONDITION_FAILED"
            : "BAD_REQUEST";
    throw new TRPCError({ code, message: `${err.reasonCode}: ${err.message}` });
  }
  if (err instanceof MswSigningConfigError) {
    // Fail closed: no unsigned admission, no placeholder keys.
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `SIGNING_UNAVAILABLE: ${err.message}` });
  }
  throw err;
}

/**
 * Agency-officer gate: caller must hold one of the MSW agency roles. Returns
 * the matched role so provenance carries the role actually exercised.
 */
function requireAgencyRole(ctx: { keycloakRoles?: string[]; user?: unknown }): MswRole {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
  const held = ctx.keycloakRoles ?? [];
  const match = MSW_AGENCY_ROLES.find((r) => held.includes(r));
  if (!match) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `one of the MSW agency roles (${MSW_AGENCY_ROLES.join(", ")}) is required`,
    });
  }
  return match;
}

function requireRole(ctx: { keycloakRoles?: string[]; user?: unknown }, role: MswRole): void {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
  if (!(ctx.keycloakRoles ?? []).includes(role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Keycloak role '${role}' is required` });
  }
}

function agentPrincipal(ctx: { user: { id: number } }): MswPrincipal {
  return { userId: ctx.user.id, role: "msw-agent" };
}

const isoTimestamp = z.string().refine((v) => Number.isFinite(Date.parse(v)), "must be an ISO timestamp");

export const mswRouter = router({
  // ─── Visit declaration (msw-agent) ─────────────────────────────────────────
  createVisit: protectedProcedure
    .input(
      z.object({
        portCallId: z.string().min(1).optional(),
        // Phase-11: full IMO check-digit validation (not just shape).
        vesselImoNumber: z.string().refine(isValidImoNumber, IMO_NUMBER_MESSAGE),
        vesselName: z.string().min(1).max(256),
        vesselFlagCode: z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2"),
        portCode: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}$/, "UN/LOCODE"),
        agentReference: z.string().min(1).max(128),
        eta: isoTimestamp,
        etd: isoTimestamp.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, "msw-agent");
      try {
        return await createVisit(agentPrincipal(ctx), input);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  nominateAgent: protectedProcedure
    .input(
      z.object({
        visitId: z.string().min(1),
        agentReference: z.string().min(1).max(128),
        nominationDocument: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, "msw-agent");
      try {
        return await nominateAgent(agentPrincipal(ctx), input);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  // ─── FAL declaration lifecycle ─────────────────────────────────────────────
  submitDeclaration: protectedProcedure
    .input(
      z.object({
        visitId: z.string().min(1),
        formType: z.enum(MSW_FORM_TYPES),
        formPayload: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, "msw-agent");
      try {
        return await submitDeclaration(agentPrincipal(ctx), input);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  acceptDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.string().min(1), reviewNote: z.string().max(4000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const role = requireAgencyRole(ctx);
      try {
        return await acceptDeclaration({ userId: ctx.user.id, role }, input);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  returnDeclaration: protectedProcedure
    .input(
      z.object({
        declarationId: z.string().min(1),
        returnReasonCode: z.string().min(1).max(64),
        reviewNote: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const role = requireAgencyRole(ctx);
      try {
        return await returnDeclaration({ userId: ctx.user.id, role }, input);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  // ─── Pratique (Port Health only; anchored to an MDOH) ─────────────────────
  grantPratique: protectedProcedure
    .input(
      z.object({
        visitId: z.string().min(1),
        healthDeclarationId: z.string().min(1),
        officerReference: z.string().min(1).max(128).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, "msw-port-health");
      try {
        return await grantPratique({ userId: ctx.user.id, role: "msw-port-health" }, input);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  refusePratique: protectedProcedure
    .input(
      z.object({
        visitId: z.string().min(1),
        healthDeclarationId: z.string().min(1),
        refusalReasonCode: z.string().min(1).max(64),
        officerReference: z.string().min(1).max(128).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, "msw-port-health");
      try {
        return await refusePratique({ userId: ctx.user.id, role: "msw-port-health" }, input);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  // ─── Boarding (agency officers; pratique-first enforced in the service) ───
  scheduleBoarding: protectedProcedure
    .input(
      z.object({
        visitId: z.string().min(1),
        agencies: z.array(AGENCY_SET).min(1),
        scheduledAt: isoTimestamp,
        scheduleNote: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const role = requireAgencyRole(ctx);
      try {
        return await scheduleBoarding({ userId: ctx.user.id, role }, input);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  completeBoarding: protectedProcedure
    .input(
      z.object({
        boardingId: z.string().min(1),
        agencies: z.array(AGENCY_SET).min(1).optional(),
        startedAt: isoTimestamp,
        completedAt: isoTimestamp,
        outcome: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const role = requireAgencyRole(ctx);
      try {
        return await completeBoarding({ userId: ctx.user.id, role }, input);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  // ─── Clearance (agency officers; DEPARTURE preconditions in the service) ──
  grantClearance: protectedProcedure
    .input(
      z.object({
        visitId: z.string().min(1),
        kind: z.enum(MSW_CLEARANCE_KINDS),
        conditions: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const role = requireAgencyRole(ctx);
      try {
        return await grantClearance({ userId: ctx.user.id, role }, input);
      } catch (err) {
        toTrpcError(err);
      }
    }),

  refuseClearance: protectedProcedure
    .input(
      z.object({
        visitId: z.string().min(1),
        kind: z.enum(MSW_CLEARANCE_KINDS),
        refusalReasonCode: z.string().min(1).max(64),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const role = requireAgencyRole(ctx);
      try {
        return await refuseClearance({ userId: ctx.user.id, role }, input);
      } catch (err) {
        toTrpcError(err);
      }
    }),
});
