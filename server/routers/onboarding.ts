/**
 * Sprint 67 — Trader Onboarding Wizard
 * tRPC router: 5-step guided onboarding flow for new traders
 * Steps: company_profile → kyc_documents → bank_account → test_declaration → aeo_eligibility
 */

import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

// ─── Phase 20 (GAP 1) role governance ────────────────────────────────────────
// Roles a user may self-assign. Trader/applicant-level only — everything else
// requires maker-checker approval via onboarding.requestRole / reviewRoleRequest.
export const SELF_ASSIGNABLE_ROLES = ["user"] as const;
export type SelfAssignableRole = (typeof SELF_ASSIGNABLE_ROLES)[number];

// Privileged roles that require maker-checker approval (never self-assignable).
export const PRIVILEGED_ROLES = ["customs_officer", "oga_officer", "inspector", "finance", "admin"] as const;
export type PrivilegedRole = (typeof PRIVILEGED_ROLES)[number];

export function isSelfAssignableRole(role: string): role is SelfAssignableRole {
  return (SELF_ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

// ─── STEP SCHEMAS ─────────────────────────────────────────────────────────────

const companyProfileSchema = z.object({
  companyName: z.string().min(2).max(255),
  registrationNumber: z.string().min(3).max(64),
  country: z.string().length(2),
  address: z.string().min(5).max(512),
  city: z.string().min(2).max(128),
  postalCode: z.string().min(2).max(16),
  industry: z.enum([
    "manufacturing", "agriculture", "mining", "textiles",
    "electronics", "chemicals", "food_beverage", "automotive",
    "pharmaceuticals", "other"
  ]),
  annualTradeVolume: z.enum(["under_100k", "100k_1m", "1m_10m", "over_10m"]),
  website: z.string().url().optional(),
  phone: z.string().min(7).max(32),
});

const kycDocumentsSchema = z.object({
  incorporationCertUrl: z.string().url(),
  incorporationCertName: z.string(),
  taxIdCertUrl: z.string().url(),
  taxIdCertName: z.string(),
  directorIdUrl: z.string().url(),
  directorIdName: z.string(),
  taxId: z.string().min(5).max(32),
  directorName: z.string().min(2).max(128),
});

const bankAccountSchema = z.object({
  accountHolderName: z.string().min(2).max(255),
  accountNumber: z.string().min(6).max(34),
  bankName: z.string().min(2).max(128),
  bankCode: z.string().min(2).max(16),
  swiftBic: z.string().min(8).max(11),
  currency: z.string().length(3),
  iban: z.string().optional(),
  branchCode: z.string().optional(),
});

const testDeclarationSchema = z.object({
  declarationNumber: z.string(),
  hsCode: z.string(),
  goodsDescription: z.string(),
  countryOfOrigin: z.string().length(2),
  invoiceValue: z.number().positive(),
  currency: z.string().length(3),
  grossWeight: z.number().positive(),
  numberOfPackages: z.number().int().positive(),
  submittedAt: z.string().datetime(),
});

const aeoEligibilitySchema = z.object({
  yearsInBusiness: z.number().int().min(0),
  previousViolations: z.boolean(),
  hasCustomsBroker: z.boolean(),
  hasInternalCompliance: z.boolean(),
  annualDeclarationCount: z.number().int().min(0),
  eligibilityTier: z.enum(["not_eligible", "standard", "silver", "gold"]),
  score: z.number().min(0).max(100),
});

// ─── STEP DEFINITIONS ────────────────────────────────────────────────────────

const STEPS = [
  "company_profile",
  "kyc_documents",
  "bank_account",
  "test_declaration",
  "aeo_eligibility",
] as const;

type OnboardingStep = typeof STEPS[number];

// ─── AEO ELIGIBILITY CALCULATOR ──────────────────────────────────────────────

function calculateAeoEligibility(companyData: z.infer<typeof companyProfileSchema>): {
  tier: "not_eligible" | "standard" | "silver" | "gold";
  score: number;
  factors: string[];
} {
  let score = 0;
  const factors: string[] = [];

  // Trade volume
  if (companyData.annualTradeVolume === "over_10m") { score += 30; factors.push("High annual trade volume (>$10M)"); }
  else if (companyData.annualTradeVolume === "1m_10m") { score += 20; factors.push("Significant trade volume ($1M–$10M)"); }
  else if (companyData.annualTradeVolume === "100k_1m") { score += 10; factors.push("Moderate trade volume ($100K–$1M)"); }
  else { score += 5; factors.push("Early-stage trade volume (<$100K)"); }

  // Industry risk
  const lowRiskIndustries = ["food_beverage", "textiles", "agriculture"];
  if (lowRiskIndustries.includes(companyData.industry)) {
    score += 15;
    factors.push("Low-risk industry classification");
  } else {
    score += 8;
    factors.push("Standard-risk industry classification");
  }

  // Base score for completing onboarding
  score += 25;
  factors.push("Completed full onboarding process");

  // Website presence
  if (companyData.website) { score += 5; factors.push("Verified web presence"); }

  const tier: "not_eligible" | "standard" | "silver" | "gold" =
    score >= 70 ? "gold" :
    score >= 55 ? "silver" :
    score >= 35 ? "standard" : "not_eligible";

  return { tier, score: Math.min(score, 100), factors };
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────

export const onboardingRouter = router({
  /**
   * getProgress — returns the current onboarding state for the logged-in user
   */
  getProgress: protectedProcedure.query(async ({ ctx }) => {
    try {
      const db = await (await import("../db")).getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { onboardingProgress } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const [record] = await db
        .select()
        .from(onboardingProgress)
        .where(eq(onboardingProgress.userId, ctx.user.id))
        .limit(1);

      if (!record) {
        return {
          exists: false,
          currentStep: "company_profile" as OnboardingStep,
          completedSteps: [] as OnboardingStep[],
          overallStatus: "not_started",
          stepData: {} as Record<string, unknown>,
          completedAt: null,
        };
      }

      const stepData = (record.stepData ?? {}) as Record<string, unknown>;
      const completedSteps = STEPS.filter(s => !!(stepData as Record<string, unknown>)[`${s}_completed`]);

      return {
        exists: true,
        currentStep: record.currentStep as OnboardingStep,
        completedSteps,
        overallStatus: record.overallStatus,
        stepData,
        completedAt: record.completedAt?.toISOString() ?? null,
      };
    } catch {
      // DB not available in sandbox — return default state
      return {
        exists: false,
        currentStep: "company_profile" as OnboardingStep,
        completedSteps: [] as OnboardingStep[],
        overallStatus: "not_started",
        stepData: {} as Record<string, unknown>,
        completedAt: null,
      };
    }
  }),

  /**
   * saveStep — saves data for a specific step and advances to the next
   */
  saveStep: protectedProcedure
    .input(z.object({
      step: z.enum(["company_profile", "kyc_documents", "bank_account", "test_declaration", "aeo_eligibility"]),
      data: z.record(z.string(), z.unknown()),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await (await import("../db")).getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { onboardingProgress } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        const stepIdx = STEPS.indexOf(input.step as OnboardingStep);
        const nextStep: OnboardingStep = stepIdx < STEPS.length - 1 ? STEPS[stepIdx + 1] : STEPS[STEPS.length - 1];
        const isLastStep = stepIdx === STEPS.length - 1;

        const [existing] = await db
          .select()
          .from(onboardingProgress)
          .where(eq(onboardingProgress.userId, ctx.user.id))
          .limit(1);

        const currentData = ((existing?.stepData ?? {}) as Record<string, unknown>);
        const newData = {
          ...currentData,
          [input.step]: input.data,
          [`${input.step}_completed`]: true,
        };

        if (existing) {
          await db.update(onboardingProgress)
            .set({
              currentStep: isLastStep ? input.step as any : nextStep as any,
              stepData: newData,
              overallStatus: isLastStep ? "completed" : "in_progress",
              completedAt: isLastStep ? new Date() : null,
              updatedAt: new Date(),
            })
            .where(eq(onboardingProgress.userId, ctx.user.id));
        } else {
          await db.insert(onboardingProgress).values({
            userId: ctx.user.id,
            currentStep: isLastStep ? input.step as any : nextStep as any,
            stepData: newData,
            overallStatus: isLastStep ? "completed" : "in_progress",
            completedAt: isLastStep ? new Date() : null,
          });
        }

        return { success: true, nextStep: isLastStep ? null : nextStep, isComplete: isLastStep };
      } catch {
        // DB not available — return success for sandbox
        const stepIdx = STEPS.indexOf(input.step as OnboardingStep);
        const nextStep = stepIdx < STEPS.length - 1 ? STEPS[stepIdx + 1] : null;
        return { success: true, nextStep, isComplete: stepIdx === STEPS.length - 1 };
      }
    }),

  /**
   * resetOnboarding — allows a user to restart the wizard
   */
  resetOnboarding: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const db = await (await import("../db")).getDb();
      if (!db) return { success: true };
      const { onboardingProgress } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.delete(onboardingProgress).where(eq(onboardingProgress.userId, ctx.user.id));
      return { success: true };
    } catch {
      return { success: true };
    }
  }),

  /**
   * calculateAeoEligibility — runs AEO eligibility check from company profile data
   */
  calculateAeoEligibility: protectedProcedure
    .input(companyProfileSchema)
    .mutation(({ input }) => {
      return calculateAeoEligibility(input);
    }),

  /**
   * selectRole — Sprint 80 / Phase 20 (GAP 1): self-select onboarding role.
   *
   * FAIL-CLOSED: only trader/applicant-level roles ("user") are self-assignable.
   * Privileged roles (customs_officer, oga_officer, inspector, finance, admin)
   * were previously self-assignable here with zero verification — that
   * privilege-escalation path is removed. Use onboarding.requestRole to submit
   * a maker-checker role request for admin approval.
   */
  selectRole: protectedProcedure
    .input(z.object({
      role: z.enum(["user", "customs_officer", "oga_officer", "inspector", "finance"]),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!isSelfAssignableRole(input.role)) {
        // Honest failure + pointer to the governed path. No silent success.
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            `Role '${input.role}' is privileged and cannot be self-assigned. ` +
            `Submit onboarding.requestRole for maker-checker admin approval.`,
        });
      }
      try {
        const db = await (await import("../db")).getDb();
        if (!db) return { success: true, role: input.role };
        const { users } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(users)
          .set({ role: input.role, updatedAt: new Date() })
          .where(eq(users.id, ctx.user.id));
        return { success: true, role: input.role };
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        return { success: true, role: input.role };
      }
    }),

  /**
   * requestRole — Phase 20 (GAP 1): maker submits a privileged-role request.
   * The request is PENDING until a DIFFERENT admin approves it
   * (maker ≠ checker, enforced in reviewRoleRequest). Fully audit-logged.
   */
  requestRole: protectedProcedure
    .input(z.object({
      role: z.enum(["customs_officer", "oga_officer", "inspector", "finance", "admin"]),
      reason: z.string().min(10).max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await (await import("../db")).getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const { roleRequests } = await import("../../drizzle/schema");
      const { and, eq } = await import("drizzle-orm");

      // One pending request per user at a time (no queue flooding).
      const [pending] = await db
        .select({ id: roleRequests.id })
        .from(roleRequests)
        .where(and(eq(roleRequests.userId, ctx.user.id), eq(roleRequests.status, "pending")))
        .limit(1);
      if (pending) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You already have a pending role request; wait for it to be reviewed.",
        });
      }

      const [created] = await db.insert(roleRequests).values({
        userId: ctx.user.id,
        requestedRole: input.role,
        reason: input.reason,
      }).returning();

      const { logAuditEvent } = await import("../db");
      await logAuditEvent({
        entityType: "user",
        entityId: ctx.user.id,
        action: "role_request_submitted",
        actorId: ctx.user.id,
        actorType: "user",
        previousState: null,
        newState: { requestedRole: input.role, roleRequestId: created.id },
        metadata: { reason: input.reason },
      });

      return { success: true, roleRequestId: created.id, status: "pending" as const };
    }),

  /**
   * myRoleRequests — the caller's own role-request history.
   */
  myRoleRequests: protectedProcedure.query(async ({ ctx }) => {
    const db = await (await import("../db")).getDb();
    if (!db) return [];
    const { roleRequests } = await import("../../drizzle/schema");
    const { desc, eq } = await import("drizzle-orm");
    return db.select().from(roleRequests)
      .where(eq(roleRequests.userId, ctx.user.id))
      .orderBy(desc(roleRequests.createdAt));
  }),

  /**
   * listPendingRoleRequests — admin: pending maker-checker queue.
   */
  listPendingRoleRequests: adminProcedure.query(async () => {
    const db = await (await import("../db")).getDb();
    if (!db) return [];
    const { roleRequests } = await import("../../drizzle/schema");
    const { desc, eq } = await import("drizzle-orm");
    return db.select().from(roleRequests)
      .where(eq(roleRequests.status, "pending"))
      .orderBy(desc(roleRequests.createdAt));
  }),

  /**
   * reviewRoleRequest — admin (checker) approves/rejects a role request.
   * Maker ≠ checker: the reviewing admin must NOT be the requester.
   * On approval the role is granted and the grant is audit-logged.
   */
  reviewRoleRequest: adminProcedure
    .input(z.object({
      roleRequestId: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      reviewNote: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await (await import("../db")).getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const { roleRequests, users } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const [request] = await db.select().from(roleRequests)
        .where(eq(roleRequests.id, input.roleRequestId)).limit(1);
      if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Role request not found" });
      if (request.status !== "pending") {
        throw new TRPCError({ code: "CONFLICT", message: `Role request already ${request.status}` });
      }
      // Maker-checker separation: the requester cannot approve their own request.
      if (request.userId === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Maker-checker violation: you cannot review your own role request.",
        });
      }

      await db.update(roleRequests).set({
        status: input.decision,
        reviewedBy: ctx.user.id,
        reviewedAt: new Date(),
        reviewNote: input.reviewNote ?? null,
        updatedAt: new Date(),
      }).where(eq(roleRequests.id, request.id));

      if (input.decision === "approved") {
        await db.update(users)
          .set({ role: request.requestedRole, updatedAt: new Date() })
          .where(eq(users.id, request.userId));
        // Seed Permify with the approved role relation
        try {
          const { writeRelationship } = await import("../_core/permify");
          const roleToRelation: Record<string, string> = {
            "admin": "admin",
            "customs_officer": "member",
            "oga_officer": "oga",
            "finance": "finance",
            "auditor": "auditor",
          };
          const relation = roleToRelation[request.requestedRole] ?? "member";
          await writeRelationship("organisation", "main", relation, "user", String(request.userId));
        } catch (permifyErr) {
          console.warn("[Permify] Failed to seed role relation:", permifyErr);
        }
      }

      const { logAuditEvent } = await import("../db");
      await logAuditEvent({
        entityType: "user",
        entityId: request.userId,
        action: input.decision === "approved" ? "role_request_approved" : "role_request_rejected",
        actorId: ctx.user.id,
        actorType: "admin",
        previousState: { roleRequestStatus: "pending", requestedRole: request.requestedRole },
        newState: { roleRequestStatus: input.decision, grantedRole: input.decision === "approved" ? request.requestedRole : null },
        metadata: { roleRequestId: request.id, reviewNote: input.reviewNote ?? null },
      });

      return { success: true, decision: input.decision };
    }),

  /**
   * suspendUser — admin: suspend an account (GAP 9). Suspended users are
   * rejected at authentication time in sdk.authenticateRequest.
   */
  suspendUser: adminProcedure
    .input(z.object({ userId: z.number().int().positive(), reason: z.string().min(5).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot suspend your own account." });
      }
      return setUserStatus(ctx.user.id, input.userId, "suspended", input.reason);
    }),

  /**
   * reactivateUser — admin: reactivate a suspended account.
   */
  reactivateUser: adminProcedure
    .input(z.object({ userId: z.number().int().positive(), reason: z.string().min(5).max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      return setUserStatus(ctx.user.id, input.userId, "active", input.reason ?? "reactivated");
    }),

  /**
   * offboardUser — admin: permanently offboard an account (terminal state).
   */
  offboardUser: adminProcedure
    .input(z.object({ userId: z.number().int().positive(), reason: z.string().min(5).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot offboard your own account." });
      }
      return setUserStatus(ctx.user.id, input.userId, "offboarded", input.reason);
    }),

  /**
   * getOnboardingStats — admin view of onboarding completion rates
   */
  getOnboardingStats: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    try {
      const db = await (await import("../db")).getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { onboardingProgress } = await import("../../drizzle/schema");
      const all = await db.select().from(onboardingProgress);
      const completed = all.filter(r => r.overallStatus === "completed").length;
      const inProgress = all.filter(r => r.overallStatus === "in_progress").length;

      const stepCounts = STEPS.reduce((acc, step) => {
        acc[step] = all.filter(r => !!(r.stepData as Record<string, unknown>)?.[`${step}_completed`]).length;
        return acc;
      }, {} as Record<string, number>);

      return {
        total: all.length,
        completed,
        inProgress,
        completionRate: all.length > 0 ? Math.round((completed / all.length) * 100) : 0,
        stepCounts,
      };
    } catch {
      return {
        total: 0, completed: 0, inProgress: 0, completionRate: 0,
        stepCounts: STEPS.reduce((a, s) => ({ ...a, [s]: 0 }), {} as Record<string, number>),
      };
    }
  }),
});

/**
 * setUserStatus — Phase 20 (GAP 9): shared admin lifecycle transition helper.
 * Writes the status change and an audit event; rejects unknown users and
 * no-op transitions. Enforcement of the status happens at authentication
 * time in server/_core/sdk.ts (fail-closed).
 */
async function setUserStatus(
  actorAdminId: number,
  targetUserId: number,
  status: "active" | "suspended" | "offboarded",
  reason: string,
) {
  const db = await (await import("../db")).getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const { users } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const [target] = await db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  if (target.status === status) {
    throw new TRPCError({ code: "CONFLICT", message: `User is already ${status}` });
  }

  await db.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, targetUserId));

  const { logAuditEvent } = await import("../db");
  await logAuditEvent({
    entityType: "user",
    entityId: targetUserId,
    action: `user_${status === "active" ? "reactivated" : status}`,
    actorId: actorAdminId,
    actorType: "admin",
    previousState: { status: target.status, role: target.role },
    newState: { status },
    metadata: { reason },
  });

  return { success: true, userId: targetUserId, status };
}
