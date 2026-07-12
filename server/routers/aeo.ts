import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { assertCan, setOwner } from "../_core/permify";
import {
  createAeoApplication, getAeoApplicationsByTrader, getAllAeoApplications,
  updateAeoApplication, logAuditEvent, createNotification, getProfileByUserId,
  withRlsContext, getDb
} from "../db";
import { nanoid } from "nanoid";
import { aeoApplications, aeoRenewalRequests, users } from "../../drizzle/schema";
import { eq, and, lte, gte, desc } from "drizzle-orm";

export const aeoRouter = router({
  // Get current user's AEO application — RLS-enforced at DB layer
  myApplication: protectedProcedure.query(async ({ ctx }) => {
    const apps = await withRlsContext({ id: ctx.user.id, role: ctx.user.role }, (db) =>
      db.select().from(aeoApplications)
        .where(eq(aeoApplications.traderId, ctx.user.id))
        .orderBy(desc(aeoApplications.createdAt))
        .limit(1)
    );
    return (apps as (typeof aeoApplications.$inferSelect)[])[0] ?? null;
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
      await assertCan(String(ctx.user.id), "aeo_application", String(input.applicationId), "approve");
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
      await assertCan(String(ctx.user.id), "aeo_application", String(input.applicationId), "reject");
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

  // ─── Sprint 85: AEO Renewal Workflow ─────────────────────────────────────

  // Admin: get AEO certificates expiring within N days
  getExpiringCertificates: adminProcedure
    .input(z.object({ withinDays: z.number().int().min(1).max(365).default(60) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const now = new Date();
      const cutoff = new Date(now.getTime() + input.withinDays * 24 * 60 * 60 * 1000);
      const rows = await db
        .select({
          id: aeoApplications.id,
          traderId: aeoApplications.traderId,
          applicationNumber: aeoApplications.applicationNumber,
          certificateNumber: aeoApplications.certificateNumber,
          tier: aeoApplications.tier,
          certificateIssuedAt: aeoApplications.certificateIssuedAt,
          certificateExpiresAt: aeoApplications.certificateExpiresAt,
          traderName: users.name,
          traderEmail: users.email,
        })
        .from(aeoApplications)
        .leftJoin(users, eq(aeoApplications.traderId, users.id))
        .where(
          and(
            eq(aeoApplications.status, "approved"),
            lte(aeoApplications.certificateExpiresAt, cutoff),
            gte(aeoApplications.certificateExpiresAt, now)
          )
        )
        .orderBy(aeoApplications.certificateExpiresAt);
      return rows.map(r => ({
        ...r,
        daysUntilExpiry: r.certificateExpiresAt
          ? Math.ceil((r.certificateExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          : null,
      }));
    }),

  // Admin: renew an approved AEO certificate (extends by 3 years)
  renewCertificate: adminProcedure
    .input(z.object({ applicationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "AEO application not found" });
      const [app] = await db
        .select()
        .from(aeoApplications)
        .where(eq(aeoApplications.id, input.applicationId));
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "AEO application not found" });
      if (app.status !== "approved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only approved certificates can be renewed" });
      }
      const newCertNumber = `AEO-RNW-${nanoid(10).toUpperCase()}`;
      const newExpiresAt = new Date();
      newExpiresAt.setFullYear(newExpiresAt.getFullYear() + 3);
      const updated = await updateAeoApplication(input.applicationId, {
        certificateNumber: newCertNumber,
        certificateIssuedAt: new Date(),
        certificateExpiresAt: newExpiresAt,
        updatedAt: new Date(),
      });
      await logAuditEvent({
        entityType: "aeo_application",
        entityId: input.applicationId,
        action: "aeo_certificate_renewed",
        actorId: ctx.user.id,
        actorType: "admin",
        newState: { certificateNumber: newCertNumber, expiresAt: newExpiresAt.toISOString() },
      });
      await createNotification({
        userId: app.traderId,
        type: "aeo_status_update",
        title: "AEO Certificate Renewed",
        message: `Your AEO certificate has been renewed. New certificate number: ${newCertNumber}. Valid until ${newExpiresAt.toLocaleDateString()}. Thank you for your continued compliance.`,
        entityType: "aeo_application",
        entityId: input.applicationId,
      });
      return updated;
    }),

  // ── Trader self-service renewal request ──────────────────────────────────────
  requestRenewal: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "No approved AEO application found" });
      const [app] = await db
        .select()
        .from(aeoApplications)
        .where(and(eq(aeoApplications.traderId, ctx.user.id), eq(aeoApplications.status, "approved")));
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "No approved AEO certificate found" });
      if (!app.certificateExpiresAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Certificate has no expiry date set" });
      }
      const daysLeft = Math.ceil(
        (app.certificateExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      if (daysLeft > 90) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Renewal requests can only be submitted within 90 days of expiry. Your certificate expires in ${daysLeft} days.`,
        });
      }
      const [existing] = await db
        .select()
        .from(aeoRenewalRequests)
        .where(and(
          eq(aeoRenewalRequests.applicationId, app.id),
          eq(aeoRenewalRequests.status, "pending")
        ));
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A renewal request is already pending for this certificate" });
      }
      const [request] = await db
        .insert(aeoRenewalRequests)
        .values({ applicationId: app.id, traderId: ctx.user.id, status: "pending", requestedAt: new Date() })
        .returning();
      await logAuditEvent({
        entityType: "aeo_application", entityId: app.id, action: "aeo_renewal_requested",
        actorId: ctx.user.id, actorType: "trader", newState: { renewalRequestId: request.id, daysLeft },
      });
      await createNotification({
        userId: ctx.user.id, type: "aeo_status_update",
        title: "AEO Renewal Request Submitted",
        message: `Your renewal request for certificate ${app.certificateNumber ?? app.applicationNumber} has been submitted. You will be notified once it is processed.`,
        entityType: "aeo_application", entityId: app.id,
      });
      return request;
    }),

  myRenewalStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const [request] = await db
      .select()
      .from(aeoRenewalRequests)
      .where(eq(aeoRenewalRequests.traderId, ctx.user.id))
      .orderBy(desc(aeoRenewalRequests.requestedAt))
      .limit(1);
    return request ?? null;
  }),

  listRenewalRequests: adminProcedure
    .input(z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const rows = await db
        .select({
          id: aeoRenewalRequests.id,
          applicationId: aeoRenewalRequests.applicationId,
          traderId: aeoRenewalRequests.traderId,
          status: aeoRenewalRequests.status,
          requestedAt: aeoRenewalRequests.requestedAt,
          processedAt: aeoRenewalRequests.processedAt,
          notes: aeoRenewalRequests.notes,
          traderName: users.name,
          traderEmail: users.email,
          certNumber: aeoApplications.certificateNumber,
          certExpiresAt: aeoApplications.certificateExpiresAt,
          tier: aeoApplications.tier,
        })
        .from(aeoRenewalRequests)
        .leftJoin(users, eq(aeoRenewalRequests.traderId, users.id))
        .leftJoin(aeoApplications, eq(aeoRenewalRequests.applicationId, aeoApplications.id))
        .where(input.status ? eq(aeoRenewalRequests.status, input.status) : undefined)
        .orderBy(desc(aeoRenewalRequests.requestedAt));
      return rows;
    }),

  processRenewalRequest: adminProcedure
    .input(z.object({
      requestId: z.number().int().positive(),
      action: z.enum(["approved", "rejected"]),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [req] = await db.select().from(aeoRenewalRequests).where(eq(aeoRenewalRequests.id, input.requestId));
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Renewal request not found" });
      if (req.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Request is no longer pending" });
      await db.update(aeoRenewalRequests)
        .set({ status: input.action, processedAt: new Date(), processedBy: ctx.user.id, notes: input.notes ?? null })
        .where(eq(aeoRenewalRequests.id, input.requestId));
      if (input.action === "approved") {
        const newCertNumber = `AEO-RNW-${nanoid(10).toUpperCase()}`;
        const newExpiresAt = new Date();
        newExpiresAt.setFullYear(newExpiresAt.getFullYear() + 3);
        await updateAeoApplication(req.applicationId, {
          certificateNumber: newCertNumber, certificateIssuedAt: new Date(),
          certificateExpiresAt: newExpiresAt, updatedAt: new Date(),
        });
        await createNotification({
          userId: req.traderId, type: "aeo_status_update",
          title: "AEO Certificate Renewed",
          message: `Your renewal request has been approved. New certificate: ${newCertNumber}. Valid until ${newExpiresAt.toLocaleDateString()}.`,
          entityType: "aeo_application", entityId: req.applicationId,
        });
      } else {
        await createNotification({
          userId: req.traderId, type: "aeo_status_update",
          title: "AEO Renewal Request Rejected",
          message: `Your renewal request has been rejected.${input.notes ? ` Reason: ${input.notes}` : ""} Please contact the NCS AEO Unit for assistance.`,
          entityType: "aeo_application", entityId: req.applicationId,
        });
      }
      await logAuditEvent({
        entityType: "aeo_application", entityId: req.applicationId,
        action: `aeo_renewal_${input.action}`, actorId: ctx.user.id, actorType: "admin",
        newState: { requestId: input.requestId, action: input.action, notes: input.notes },
      });
      return { success: true, action: input.action };
    }),

  /** Get compliance score trend across the last N renewal cycles for an AEO application */
  getComplianceScoreTrend: adminProcedure
    .input(z.object({ applicationId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const app = await db.select({
        id: aeoApplications.id,
        complianceScore: aeoApplications.complianceScore,
        createdAt: aeoApplications.createdAt,
      }).from(aeoApplications).where(eq(aeoApplications.id, input.applicationId)).limit(1);
      if (!app.length) return [];
      const renewals = await db.select({
        processedAt: aeoRenewalRequests.processedAt,
        complianceScoreAtRenewal: aeoRenewalRequests.complianceScoreAtRenewal,
        status: aeoRenewalRequests.status,
      }).from(aeoRenewalRequests)
        .where(and(
          eq(aeoRenewalRequests.applicationId, input.applicationId),
          eq(aeoRenewalRequests.status, "approved"),
        ))
        .orderBy(aeoRenewalRequests.processedAt);
      const points: { label: string; score: number }[] = [];
      if (app[0].complianceScore != null) {
        points.push({ label: "Initial", score: app[0].complianceScore });
      }
      renewals.forEach((r, i) => {
        if (r.complianceScoreAtRenewal != null) {
          const label = r.processedAt
            ? new Date(r.processedAt).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
            : `Renewal ${i + 1}`;
          points.push({ label, score: r.complianceScoreAtRenewal });
        }
      });
      return points;
    }),

  /**
   * v97: Initiate an AEO renewal request for the authenticated trader.
   */
  initiateAeoRenewal: protectedProcedure
    .input(z.object({
      applicationId: z.number().int().positive(),
      renewalNotes: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { aeoRenewalRequests } = await import("../../drizzle/schema");
      const [row] = await db.insert(aeoRenewalRequests).values({
        applicationId: input.applicationId,
        traderId: ctx.user.id,
        notes: input.renewalNotes,
        status: "pending",
        requestedAt: new Date(),
      }).returning();
      return row;
    }),

  /**
   * v97: Get AEO renewal status for a given application.
   */
  getAeoRenewalStatus: protectedProcedure
    .input(z.object({ applicationId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return null;
      const { aeoRenewalRequests } = await import("../../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");
      const [row] = await db.select().from(aeoRenewalRequests)
        .where(eq(aeoRenewalRequests.applicationId, input.applicationId))
        .orderBy(desc(aeoRenewalRequests.requestedAt))
        .limit(1);
      return row ?? null;
    }),

  /**
   * v97: Admin: process (approve/reject) an AEO renewal request.
   */
  processAeoRenewal: protectedProcedure
    .input(z.object({
      renewalId: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      reviewNotes: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ["admin", "customs_officer"].includes(ctx.user.role);
      if (!isAdmin) throw new TRPCError({ code: "FORBIDDEN" });
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { aeoRenewalRequests } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const [row] = await db.update(aeoRenewalRequests)
        .set({ status: input.decision, notes: input.reviewNotes, processedBy: ctx.user.id, processedAt: new Date() })
        .where(eq(aeoRenewalRequests.id, input.renewalId))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),
});
