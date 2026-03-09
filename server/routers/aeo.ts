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

  // ─── Sprint 58: WCO SAFE Framework Self-Assessment ───────────────────────

  getSelfAssessmentQuestions: protectedProcedure.query(async () => {
    // WCO SAFE Framework pillars with questions
    const pillars = [
      {
        id: "financial_solvency",
        label: "Financial Solvency",
        description: "Demonstrated financial standing and solvency over the past 3 years",
        weight: 0.25,
        questions: [
          { id: "fs_1", text: "Has the company filed audited financial statements for the past 3 consecutive years?", weight: 0.3 },
          { id: "fs_2", text: "Is the company free from bankruptcy, insolvency, or winding-up proceedings?", weight: 0.3 },
          { id: "fs_3", text: "Does the company maintain a positive net worth as evidenced by the latest audited accounts?", weight: 0.25 },
          { id: "fs_4", text: "Has the company paid all customs duties, taxes, and fees without significant arrears?", weight: 0.15 },
        ],
      },
      {
        id: "compliance_record",
        label: "Compliance Record",
        description: "History of compliance with customs and trade regulations",
        weight: 0.30,
        questions: [
          { id: "cr_1", text: "Has the company maintained a clean customs compliance record with no serious violations in the past 3 years?", weight: 0.30 },
          { id: "cr_2", text: "Does the company have a designated compliance officer responsible for customs matters?", weight: 0.25 },
          { id: "cr_3", text: "Does the company maintain a documented customs compliance programme with regular internal audits?", weight: 0.25 },
          { id: "cr_4", text: "Has the company implemented corrective actions for any past customs discrepancies?", weight: 0.20 },
        ],
      },
      {
        id: "security_standards",
        label: "Security Standards",
        description: "Physical, personnel, and information security measures in place",
        weight: 0.25,
        questions: [
          { id: "ss_1", text: "Does the company have documented physical security procedures for its premises and cargo handling areas?", weight: 0.25 },
          { id: "ss_2", text: "Are background checks conducted on all employees with access to cargo and sensitive trade data?", weight: 0.25 },
          { id: "ss_3", text: "Does the company have an IT security policy covering access controls, encryption, and incident response?", weight: 0.25 },
          { id: "ss_4", text: "Does the company vet and monitor the security practices of its trading partners and logistics providers?", weight: 0.25 },
        ],
      },
      {
        id: "logistics_competence",
        label: "Logistics Competence",
        description: "Operational capability and expertise in international trade logistics",
        weight: 0.20,
        questions: [
          { id: "lc_1", text: "Does the company have staff with formal training in customs procedures and international trade regulations?", weight: 0.30 },
          { id: "lc_2", text: "Does the company use an integrated IT system for managing trade documentation and declarations?", weight: 0.30 },
          { id: "lc_3", text: "Does the company maintain accurate records of all import/export transactions for a minimum of 5 years?", weight: 0.20 },
          { id: "lc_4", text: "Does the company have documented procedures for handling cargo discrepancies, shortages, and damages?", weight: 0.20 },
        ],
      },
    ];
    return { pillars };
  }),

  submitSelfAssessment: protectedProcedure
    .input(z.object({
      answers: z.record(z.string(), z.boolean()),
      applicantName: z.string(),
      companyName: z.string(),
      registrationNo: z.string(),
      targetTier: z.enum(["standard", "silver", "gold"]),
    }))
    .mutation(async ({ input }) => {
      const pillars = [
        { id: "financial_solvency", weight: 0.25, questions: ["fs_1","fs_2","fs_3","fs_4"], qWeights: [0.3,0.3,0.25,0.15] },
        { id: "compliance_record", weight: 0.30, questions: ["cr_1","cr_2","cr_3","cr_4"], qWeights: [0.30,0.25,0.25,0.20] },
        { id: "security_standards", weight: 0.25, questions: ["ss_1","ss_2","ss_3","ss_4"], qWeights: [0.25,0.25,0.25,0.25] },
        { id: "logistics_competence", weight: 0.20, questions: ["lc_1","lc_2","lc_3","lc_4"], qWeights: [0.30,0.30,0.20,0.20] },
      ];

      const pillarScores: Record<string, number> = {};
      let overallScore = 0;

      for (const pillar of pillars) {
        let pillarScore = 0;
        for (let i = 0; i < pillar.questions.length; i++) {
          const qId = pillar.questions[i];
          const answered = input.answers[qId] === true;
          pillarScore += answered ? pillar.qWeights[i] : 0;
        }
        pillarScores[pillar.id] = Math.round(pillarScore * 100);
        overallScore += pillarScore * pillar.weight;
      }

      const overallPct = Math.round(overallScore * 100);
      const eligibleTiers: string[] = [];
      if (overallPct >= 60) eligibleTiers.push("standard");
      if (overallPct >= 75) eligibleTiers.push("silver");
      if (overallPct >= 90) eligibleTiers.push("gold");

      const recommendation = eligibleTiers.includes(input.targetTier)
        ? `Eligible for ${input.targetTier.toUpperCase()} AEO. Proceed to formal application.`
        : `Score of ${overallPct}% is below the threshold for ${input.targetTier.toUpperCase()} AEO. Consider applying for ${eligibleTiers[eligibleTiers.length - 1]?.toUpperCase() ?? "Standard"} tier first.`;

      return {
        overallScore: overallPct,
        pillarScores,
        eligibleTiers,
        recommendation,
        assessedAt: new Date().toISOString(),
        applicantName: input.applicantName,
        companyName: input.companyName,
        registrationNo: input.registrationNo,
        targetTier: input.targetTier,
      };
    }),
});
