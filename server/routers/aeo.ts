import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createAeoApplication, getAeoApplicationsByTrader, getAllAeoApplications,
  updateAeoApplication, logAuditEvent, createNotification, getProfileByUserId
} from "../db";
import { nanoid } from "nanoid";

export const aeoRouter = router({
  // Get current user's AEO application
  myApplication: protectedProcedure.query(async ({ ctx }) => {
    const apps = await getAeoApplicationsByTrader(ctx.user.id);
    return apps[0] ?? null;
  }),

  // Submit AEO application
  submitApplication: protectedProcedure
    .input(z.object({
      applicantType: z.enum(["importer", "exporter", "customs_broker", "freight_forwarder", "warehouse_operator"]),
      yearsInBusiness: z.number().int().min(0),
      annualTradeVolume: z.number().positive(),
      numberOfDeclarationsPerYear: z.number().int().min(0),
      hasComplianceOfficer: z.boolean(),
      hasTradingPartnerVetting: z.boolean(),
      hasSecurityProcedures: z.boolean(),
      hasFinancialSolvency: z.boolean(),
      selfAssessmentScore: z.number().min(0).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const profile = await getProfileByUserId(ctx.user.id);
      if (!profile || profile.status !== "approved") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Approved trader profile required for AEO application." });
      }
      const existing = await getAeoApplicationsByTrader(ctx.user.id);
      if (existing.length > 0 && existing[0].status === "approved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You already hold an AEO certificate." });
      }

      // Compute a compliance score from the self-assessment
      const boolScore = [
        input.hasComplianceOfficer,
        input.hasTradingPartnerVetting,
        input.hasSecurityProcedures,
        input.hasFinancialSolvency,
      ].filter(Boolean).length * 25;

      const app = await createAeoApplication({
        traderId: ctx.user.id,
        applicationNumber: `AEO-APP-${nanoid(10).toUpperCase()}`,
        tier: "standard",
        status: "submitted",
        selfAssessmentScore: input.selfAssessmentScore,
        complianceScore: boolScore,
        securityScore: input.hasSecurityProcedures ? 80 : 40,
        financialStandingScore: input.hasFinancialSolvency ? 90 : 50,
      });

      await logAuditEvent({
        entityType: "declaration",
        entityId: app!.id,
        action: "aeo_application_submitted",
        actorId: ctx.user.id,
        actorType: "trader",
        newState: { status: "submitted" },
      });

      await createNotification({
        userId: ctx.user.id,
        type: "aeo_status_update",
        title: "AEO Application Submitted",
        message: "Your Authorised Economic Operator application has been submitted and is under review. You will be notified of any updates.",
        entityType: "aeo_application",
        entityId: app!.id,
      });

      return app;
    }),

  // Admin: list all AEO applications
  all: protectedProcedure
    .input(z.object({ limit: z.number().default(50), offset: z.number().default(0) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getAllAeoApplications(input.limit, input.offset);
    }),

  // Admin: approve AEO
  approve: protectedProcedure
    .input(z.object({ applicationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const certNumber = `AEO-${new Date().getFullYear()}-${nanoid(8).toUpperCase()}`;
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 3);

      const updated = await updateAeoApplication(input.applicationId, {
        status: "approved",
        assignedReviewerId: ctx.user.id,
        certificateNumber: certNumber,
        certificateIssuedAt: new Date(),
        certificateExpiresAt: expiresAt,
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });

      await createNotification({
        userId: updated.traderId,
        type: "aeo_status_update",
        title: "AEO Certificate Issued",
        message: `Congratulations! Your AEO certificate ${certNumber} has been issued. Valid until ${expiresAt.toLocaleDateString()}. You now qualify for blue-lane fast-track clearance.`,
        entityType: "aeo_application",
        entityId: input.applicationId,
      });
      await logAuditEvent({
        entityType: "aeo_application",
        entityId: input.applicationId,
        action: "aeo_approved",
        actorId: ctx.user.id,
        actorType: "admin",
        newState: { status: "approved", certificateNumber: certNumber },
      });

      return updated;
    }),

  // Admin: reject AEO
  reject: protectedProcedure
    .input(z.object({ applicationId: z.number(), reason: z.string().min(10) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const updated = await updateAeoApplication(input.applicationId, {
        status: "rejected",
        assignedReviewerId: ctx.user.id,
        reviewerNotes: input.reason,
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });

      await createNotification({
        userId: updated.traderId,
        type: "aeo_status_update",
        title: "AEO Application Rejected",
        message: `Your AEO application was not approved. Reason: ${input.reason}. You may reapply after addressing the concerns raised.`,
        entityType: "aeo_application",
        entityId: input.applicationId,
      });
      await logAuditEvent({
        entityType: "aeo_application",
        entityId: input.applicationId,
        action: "aeo_rejected",
        actorId: ctx.user.id,
        actorType: "admin",
        previousState: { status: "under_review" },
        newState: { status: "rejected", reason: input.reason },
      });

      return updated;
    }),
});
