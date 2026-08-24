import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicRateLimitedProcedure, router } from "../_core/trpc";
import {
  createStakeholderRegistration,
  getStakeholderRegistrationById,
  getPendingStakeholderRegistrationForUser,
  getStakeholderRegistrationsByUser,
  getPendingStakeholderRegistrations,
  updateStakeholderRegistration,
  createStakeholderMandate,
  getStakeholderMandateById,
  getStakeholderMandateByReference,
  revokeStakeholderMandate,
  getStakeholderMandatesByPrincipal,
  getStakeholderMandatesByAgent,
  getApprovedAgentRegistration,
  getApprovedAgentRegistrations,
  getApprovedTraderProfile,
  logAuditEvent,
} from "../db";
import { resolveActingPrincipal } from "../_core/mandateAuthorization";
import { lookupPublicApplication } from "../_core/applicationTracking";
import { nanoid } from "nanoid";

const registrationType = z.enum([
  "freight_forwarder",
  "shipping_line",
  "shipping_company",
  "airline_gha",
]);

const registrationInput = z.object({
  stakeholderType: registrationType,
  organizationName: z.string().min(2).max(255),
  organizationCode: z.string().max(64).optional(),
  licenseNumber: z.string().max(128).optional(),
  licenseExpiresAt: z.string().datetime().optional(),
  taxId: z.string().max(64).optional(),
  country: z.string().length(2),
  phone: z.string().max(32).optional(),
  kycDocumentIds: z.array(z.number().int().positive()).max(20).default([]),
}).superRefine((input, ctx) => {
  if (input.stakeholderType === "freight_forwarder") {
    if (!input.licenseNumber) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["licenseNumber"], message: "A licence number is required for freight-forwarding agents." });
    }
    if (!input.licenseExpiresAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["licenseExpiresAt"], message: "A licence expiry date is required for freight-forwarding agents." });
    } else if (new Date(input.licenseExpiresAt) <= new Date()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["licenseExpiresAt"], message: "The licence must not already be expired." });
    }
  }
});

const REVIEWER_ROLES = new Set(["admin", "customs_officer", "oga_officer"]);

function reference(prefix: string) {
  return `NSW-${prefix}-${new Date().getFullYear()}-${nanoid(10).toUpperCase()}`;
}

function serviceUnavailable(message: string, cause: unknown): never {
  if (cause instanceof TRPCError) throw cause;
  throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message, cause });
}

export const stakeholderRegistrationsRouter = router({
  register: protectedProcedure
    .input(registrationInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const existing = await getPendingStakeholderRegistrationForUser(ctx.user.id, input.stakeholderType);
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A pending application already exists: ${existing.referenceNumber}`,
          });
        }
        const registration = await createStakeholderRegistration({
          referenceNumber: reference("REG"),
          userId: ctx.user.id,
          stakeholderType: input.stakeholderType,
          organizationName: input.organizationName,
          organizationCode: input.organizationCode,
          licenseNumber: input.licenseNumber,
          licenseExpiresAt: input.licenseExpiresAt ? new Date(input.licenseExpiresAt) : null,
          taxId: input.taxId,
          country: input.country,
          phone: input.phone,
          kycDocumentIds: input.kycDocumentIds,
          status: "pending",
        });
        await logAuditEvent({
          entityType: "user",
          entityId: ctx.user.id,
          action: "stakeholder_registration_created",
          actorId: ctx.user.id,
          actorType: input.stakeholderType,
          newState: { referenceNumber: registration.referenceNumber, status: registration.status },
        });
        return registration;
      } catch (error) {
        return serviceUnavailable("Stakeholder registration is unavailable.", error);
      }
    }),

  track: publicRateLimitedProcedure
    .input(z.object({ referenceNumber: z.string().min(8).max(32) }))
    .query(async ({ input }) => {
      try {
        return await lookupPublicApplication(input.referenceNumber);
      } catch (error) {
        return serviceUnavailable("Application tracking is unavailable.", error);
      }
    }),

  mine: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await getStakeholderRegistrationsByUser(ctx.user.id);
    } catch (error) {
      return serviceUnavailable("Stakeholder registrations are unavailable.", error);
    }
  }),

  pending: protectedProcedure.query(async ({ ctx }) => {
    if (!REVIEWER_ROLES.has(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
    try {
      return await getPendingStakeholderRegistrations();
    } catch (error) {
      return serviceUnavailable("Stakeholder registrations are unavailable.", error);
    }
  }),

  approve: protectedProcedure
    .input(z.object({ registrationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (!REVIEWER_ROLES.has(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const registration = await getStakeholderRegistrationById(input.registrationId);
        if (!registration) throw new TRPCError({ code: "NOT_FOUND" });
        if (registration.status === "approved") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Registration is already approved." });
        }
        const updated = await updateStakeholderRegistration(input.registrationId, {
          status: "approved",
          approvedBy: ctx.user.id,
          approvedAt: new Date(),
          rejectionReason: null,
        });
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        await logAuditEvent({
          entityType: "user",
          entityId: updated.userId,
          action: "stakeholder_registration_approved",
          actorId: ctx.user.id,
          actorType: ctx.user.role,
          newState: { referenceNumber: updated.referenceNumber, status: updated.status },
        });
        return updated;
      } catch (error) {
        return serviceUnavailable("Stakeholder registration approval is unavailable.", error);
      }
    }),

  reject: protectedProcedure
    .input(z.object({ registrationId: z.number().int().positive(), reason: z.string().min(10).max(1024) }))
    .mutation(async ({ ctx, input }) => {
      if (!REVIEWER_ROLES.has(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const updated = await updateStakeholderRegistration(input.registrationId, {
          status: "rejected",
          rejectionReason: input.reason,
        });
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        await logAuditEvent({
          entityType: "user",
          entityId: updated.userId,
          action: "stakeholder_registration_rejected",
          actorId: ctx.user.id,
          actorType: ctx.user.role,
          newState: { referenceNumber: updated.referenceNumber, status: updated.status, reason: input.reason },
        });
        return updated;
      } catch (error) {
        return serviceUnavailable("Stakeholder registration rejection is unavailable.", error);
      }
    }),

  createMandate: protectedProcedure
    .input(z.object({
      agentUserId: z.number().int().positive(),
      validFrom: z.string().datetime().optional(),
      validUntil: z.string().datetime(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const validFrom = input.validFrom ? new Date(input.validFrom) : new Date();
        const validUntil = new Date(input.validUntil);
        if (validUntil <= validFrom) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Mandate validity must end after it begins." });
        }
        if (validUntil <= new Date()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Mandate validity must extend into the future." });
        }
        if (input.agentUserId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A principal cannot appoint itself as its agent." });
        }
        const principalProfile = await getApprovedTraderProfile(ctx.user.id);
        if (!principalProfile) {
          throw new TRPCError({ code: "FORBIDDEN", message: "An approved importer/exporter profile is required." });
        }
        if (!(await getApprovedAgentRegistration(input.agentUserId))) {
          throw new TRPCError({ code: "FORBIDDEN", message: "The agent must have an approved, unexpired licence." });
        }
        const mandate = await createStakeholderMandate({
          referenceNumber: reference("MND"),
          principalUserId: ctx.user.id,
          agentUserId: input.agentUserId,
          validFrom,
          validUntil,
        });
        await logAuditEvent({
          entityType: "user",
          entityId: ctx.user.id,
          action: "stakeholder_mandate_created",
          actorId: ctx.user.id,
          actorType: "trader",
          newState: {
            referenceNumber: mandate.referenceNumber,
            principalUserId: mandate.principalUserId,
            agentUserId: mandate.agentUserId,
            validFrom,
            validUntil,
          },
        });
        return mandate;
      } catch (error) {
        return serviceUnavailable("Mandate creation is unavailable.", error);
      }
    }),

  getMandate: protectedProcedure
    .input(z.object({ referenceNumber: z.string().min(8).max(32) }))
    .query(async ({ ctx, input }) => {
      try {
        const mandate = await getStakeholderMandateByReference(input.referenceNumber);
        if (!mandate) throw new TRPCError({ code: "NOT_FOUND" });
        if (mandate.principalUserId !== ctx.user.id && mandate.agentUserId !== ctx.user.id && !REVIEWER_ROLES.has(ctx.user.role)) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return mandate;
      } catch (error) {
        return serviceUnavailable("Mandate lookup is unavailable.", error);
      }
  }),

  mineMandates: protectedProcedure
    .input(z.object({ side: z.enum(["principal", "agent"]) }))
    .query(async ({ ctx, input }) => {
      try {
        return input.side === "principal"
          ? await getStakeholderMandatesByPrincipal(ctx.user.id)
          : await getStakeholderMandatesByAgent(ctx.user.id);
      } catch (error) {
        return serviceUnavailable("Mandate history is unavailable.", error);
      }
    }),

  approvedAgents: protectedProcedure.query(async () => {
    try {
      return await getApprovedAgentRegistrations();
    } catch (error) {
      return serviceUnavailable("Approved agent directory is unavailable.", error);
    }
  }),

  revokeMandate: protectedProcedure
    .input(z.object({ mandateId: z.number().int().positive(), reason: z.string().max(1024).optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const mandate = await getStakeholderMandateById(input.mandateId);
        if (!mandate) throw new TRPCError({ code: "NOT_FOUND" });
        if (mandate.principalUserId !== ctx.user.id && !REVIEWER_ROLES.has(ctx.user.role)) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const revoked = await revokeStakeholderMandate(input.mandateId, ctx.user.id, input.reason);
        if (!revoked) throw new TRPCError({ code: "BAD_REQUEST", message: "Mandate is already revoked." });
        await logAuditEvent({
          entityType: "user",
          entityId: mandate.principalUserId,
          action: "stakeholder_mandate_revoked",
          actorId: ctx.user.id,
          actorType: ctx.user.role,
          previousState: { referenceNumber: mandate.referenceNumber },
          newState: { revokedAt: revoked.revokedAt, revokedBy: revoked.revokedBy, reason: input.reason },
        });
        return revoked;
      } catch (error) {
        return serviceUnavailable("Mandate revocation is unavailable.", error);
      }
    }),

  resolvePrincipal: protectedProcedure
    .input(z.object({ principalUserId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const resolved = await resolveActingPrincipal(input.principalUserId, ctx.user);
      return resolved;
    }),
});
