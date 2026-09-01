/**
 * Phase 12 — CRM case/ticket workflow tRPC router.
 *
 * State machine open→triaged→in_progress→resolved→closed with maker-checker
 * on dispute resolutions (server/crm/cases.ts). Every mutation emits a
 * signed crm.case.v1 envelope event; publication outcome is surfaced
 * honestly (eventPublished flag) — signing misconfiguration fails closed.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  keycloakCustomsOfficerProcedure,
  protectedProcedure,
  router,
} from "../_core/trpc";
import {
  approveResolution,
  assignCase,
  CaseTransitionError,
  createCase,
  CRM_CASE_STATUSES,
  CRM_CASE_TYPES,
  getCaseById,
  getCaseTimeline,
  listCases,
  MAX_PAGE_SIZE,
  transitionCase,
} from "../crm/cases";

function mapCaseError(err: unknown): never {
  if (err instanceof CaseTransitionError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  if (err instanceof Error && err.name === "CrmSigningConfigError") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Case operation failed",
    cause: err,
  });
}

export const casesRouter = router({
  /** Trader/officer opens a case (subject to validation). */
  create: protectedProcedure
    .input(
      z.object({
        subject: z.string().min(5).max(240),
        description: z.string().max(8000).optional(),
        caseType: z.enum(CRM_CASE_TYPES).default("general"),
        priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
        stakeholderProfileId: z.number().int().positive().optional(),
        declarationId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await createCase({
          ...input,
          actorId: ctx.user.id,
          actorRole: ctx.user.role,
        });
      } catch (err) {
        mapCaseError(err);
      }
    }),

  /** Officer case board with pagination caps. */
  list: keycloakCustomsOfficerProcedure
    .input(
      z.object({
        status: z.enum(CRM_CASE_STATUSES).optional(),
        caseType: z.enum(CRM_CASE_TYPES).optional(),
        assignedTo: z.number().int().positive().optional(),
        stakeholderProfileId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => listCases(input)),

  /** Cases the caller opened (trader self-service view). */
  myCases: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = await (await import("../db")).getDb();
      const { crmCases } = await import("../../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");
      return db!
        .select()
        .from(crmCases)
        .where(eq(crmCases.createdBy, ctx.user.id))
        .orderBy(desc(crmCases.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const c = await getCaseById(input.id);
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: `Case ${input.id} not found` });
      // Officers/admins see all; traders only their own cases.
      const isOfficer = ["admin", "customs_officer", "inspector"].includes(ctx.user.role);
      if (!isOfficer && c.createdBy !== ctx.user.id && c.assignedTo !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your case" });
      }
      const timeline = await getCaseTimeline(input.id);
      return { case: c, timeline };
    }),

  assign: keycloakCustomsOfficerProcedure
    .input(z.object({ caseId: z.number().int().positive(), assigneeId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await assignCase(input.caseId, input.assigneeId, { id: ctx.user.id, role: ctx.user.role });
      } catch (err) {
        mapCaseError(err);
      }
    }),

  transition: keycloakCustomsOfficerProcedure
    .input(
      z.object({
        caseId: z.number().int().positive(),
        toStatus: z.enum(CRM_CASE_STATUSES),
        note: z.string().max(2000).optional(),
        resolutionSummary: z.string().max(8000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await transitionCase({
          caseId: input.caseId,
          toStatus: input.toStatus,
          note: input.note,
          resolutionSummary: input.resolutionSummary,
          actor: { id: ctx.user.id, role: ctx.user.role },
        });
      } catch (err) {
        mapCaseError(err);
      }
    }),

  /** Maker-checker: approve a dispute resolution (checker ≠ maker). */
  approveResolution: keycloakCustomsOfficerProcedure
    .input(z.object({ caseId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await approveResolution(input.caseId, { id: ctx.user.id, role: ctx.user.role });
      } catch (err) {
        mapCaseError(err);
      }
    }),
});
