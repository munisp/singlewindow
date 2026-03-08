/**
 * Fraud Cases tRPC Router
 *
 * Manages investigation case lifecycle:
 *   - createCase: open a new fraud case linked to a trader
 *   - getCase: full case detail with notes and evidence
 *   - listCases: paginated list with status/priority filters
 *   - addNote: append an investigator note to a case
 *   - uploadEvidence: attach an S3-backed evidence file
 *   - updateStatus: advance case status (with closure reason)
 *   - assignCase: assign/reassign to an investigator
 *
 * All procedures require admin or customs_officer role.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function requireInvestigator(role: string) {
  if (role !== "admin" && role !== "customs_officer") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin or customs officer role required" });
  }
}

function generateCaseNumber(): string {
  const now = new Date();
  const yymmdd = now.toISOString().slice(2, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `FC-${yymmdd}-${rand}`;
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────

export const fraudCasesRouter = router({

  // ── CREATE CASE ─────────────────────────────────────────────────────────────
  createCase: protectedProcedure
    .input(
      z.object({
        traderId: z.number().int().positive(),
        title: z.string().min(3).max(255),
        description: z.string().max(4000).optional(),
        priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
        linkedDeclarationIds: z.array(z.number().int()).max(50).default([]),
        riskScore: z.number().min(0).max(1).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireInvestigator(ctx.user.role);

      const { getDb } = await import("../db");
      const { fraudCases } = await import("../../drizzle/schema");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const caseNumber = generateCaseNumber();

      const [created] = await db
        .insert(fraudCases)
        .values({
          caseNumber,
          traderId: input.traderId,
          title: input.title,
          description: input.description ?? null,
          status: "open",
          priority: input.priority,
          createdBy: ctx.user.id,
          linkedDeclarationIds: input.linkedDeclarationIds,
          riskScore: input.riskScore ?? null,
        })
        .returning();

      return created;
    }),

  // ── GET CASE ─────────────────────────────────────────────────────────────────
  getCase: protectedProcedure
    .input(z.object({ caseId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      requireInvestigator(ctx.user.role);

      const { getDb } = await import("../db");
      const { fraudCases, fraudCaseNotes, fraudCaseEvidence } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [caseRow] = await db
        .select()
        .from(fraudCases)
        .where(eq(fraudCases.id, input.caseId))
        .limit(1);

      if (!caseRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Case ${input.caseId} not found` });
      }

      const notes = await db
        .select()
        .from(fraudCaseNotes)
        .where(eq(fraudCaseNotes.caseId, input.caseId))
        .orderBy(fraudCaseNotes.createdAt);

      const evidence = await db
        .select()
        .from(fraudCaseEvidence)
        .where(eq(fraudCaseEvidence.caseId, input.caseId))
        .orderBy(fraudCaseEvidence.createdAt);

      return { ...caseRow, notes, evidence };
    }),

  // ── LIST CASES ───────────────────────────────────────────────────────────────
  listCases: protectedProcedure
    .input(
      z.object({
        status: z.enum(["open", "under_review", "escalated", "closed_confirmed", "closed_cleared", "referred_prosecution", "all"]).default("all"),
        priority: z.enum(["low", "medium", "high", "critical", "all"]).default("all"),
        traderId: z.number().int().positive().optional(),
        assignedTo: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      requireInvestigator(ctx.user.role);

      const { getDb } = await import("../db");
      const { fraudCases } = await import("../../drizzle/schema");
      const { eq, and, desc } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [];
      if (input.status !== "all") conditions.push(eq(fraudCases.status, input.status));
      if (input.priority !== "all") conditions.push(eq(fraudCases.priority, input.priority));
      if (input.traderId) conditions.push(eq(fraudCases.traderId, input.traderId));
      if (input.assignedTo) conditions.push(eq(fraudCases.assignedTo, input.assignedTo));

      const rows = await db
        .select()
        .from(fraudCases)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(fraudCases.updatedAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows;
    }),

  // ── ADD NOTE ─────────────────────────────────────────────────────────────────
  addNote: protectedProcedure
    .input(
      z.object({
        caseId: z.number().int().positive(),
        content: z.string().min(1).max(10000),
        isInternal: z.boolean().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireInvestigator(ctx.user.role);

      const { getDb } = await import("../db");
      const { fraudCases, fraudCaseNotes } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Verify case exists
      const [caseRow] = await db.select().from(fraudCases).where(eq(fraudCases.id, input.caseId)).limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND", message: `Case ${input.caseId} not found` });

      const [note] = await db
        .insert(fraudCaseNotes)
        .values({
          caseId: input.caseId,
          authorId: ctx.user.id,
          content: input.content,
          isInternal: input.isInternal,
        })
        .returning();

      // Bump updatedAt on the case
      await db
        .update(fraudCases)
        .set({ updatedAt: new Date() })
        .where(eq(fraudCases.id, input.caseId));

      return note;
    }),

  // ── UPLOAD EVIDENCE ──────────────────────────────────────────────────────────
  // Accepts a pre-signed S3 URL (client uploads directly to S3, then calls this
  // to register the metadata in the DB).
  uploadEvidence: protectedProcedure
    .input(
      z.object({
        caseId: z.number().int().positive(),
        fileKey: z.string().min(1).max(512),
        fileUrl: z.string().url(),
        fileName: z.string().min(1).max(255),
        mimeType: z.string().max(128).optional(),
        fileSizeBytes: z.number().int().positive().optional(),
        description: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireInvestigator(ctx.user.role);

      const { getDb } = await import("../db");
      const { fraudCases, fraudCaseEvidence } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [caseRow] = await db.select().from(fraudCases).where(eq(fraudCases.id, input.caseId)).limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND", message: `Case ${input.caseId} not found` });

      const [ev] = await db
        .insert(fraudCaseEvidence)
        .values({
          caseId: input.caseId,
          uploadedBy: ctx.user.id,
          fileKey: input.fileKey,
          fileUrl: input.fileUrl,
          fileName: input.fileName,
          mimeType: input.mimeType ?? null,
          fileSizeBytes: input.fileSizeBytes ?? null,
          description: input.description ?? null,
        })
        .returning();

      await db
        .update(fraudCases)
        .set({ updatedAt: new Date() })
        .where(eq(fraudCases.id, input.caseId));

      return ev;
    }),

  // ── UPDATE STATUS ────────────────────────────────────────────────────────────
  updateStatus: protectedProcedure
    .input(
      z.object({
        caseId: z.number().int().positive(),
        status: z.enum(["open", "under_review", "escalated", "closed_confirmed", "closed_cleared", "referred_prosecution"]),
        closureReason: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireInvestigator(ctx.user.role);

      const { getDb } = await import("../db");
      const { fraudCases } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [caseRow] = await db.select().from(fraudCases).where(eq(fraudCases.id, input.caseId)).limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND", message: `Case ${input.caseId} not found` });

      const isClosed = input.status.startsWith("closed") || input.status === "referred_prosecution";

      const [updated] = await db
        .update(fraudCases)
        .set({
          status: input.status,
          closureReason: input.closureReason ?? null,
          closedAt: isClosed ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(fraudCases.id, input.caseId))
        .returning();

      return updated;
    }),

  // ── ASSIGN CASE ──────────────────────────────────────────────────────────────
  assignCase: protectedProcedure
    .input(
      z.object({
        caseId: z.number().int().positive(),
        assignedTo: z.number().int().positive().nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireInvestigator(ctx.user.role);

      const { getDb } = await import("../db");
      const { fraudCases } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [caseRow] = await db.select().from(fraudCases).where(eq(fraudCases.id, input.caseId)).limit(1);
      if (!caseRow) throw new TRPCError({ code: "NOT_FOUND", message: `Case ${input.caseId} not found` });

      const [updated] = await db
        .update(fraudCases)
        .set({ assignedTo: input.assignedTo, updatedAt: new Date() })
        .where(eq(fraudCases.id, input.caseId))
        .returning();

      return updated;
    }),

  // ── CASE STATS ───────────────────────────────────────────────────────────────
  caseStats: protectedProcedure
    .query(async ({ ctx }) => {
      requireInvestigator(ctx.user.role);

      const { getDb } = await import("../db");
      const { fraudCases } = await import("../../drizzle/schema");
      const { sql } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const rows = await db
        .select({
          status: fraudCases.status,
          priority: fraudCases.priority,
          count: sql<number>`count(*)::int`,
        })
        .from(fraudCases)
        .groupBy(fraudCases.status, fraudCases.priority);

      const byStatus: Record<string, number> = {};
      const byPriority: Record<string, number> = {};
      let total = 0;

      for (const r of rows) {
        byStatus[r.status] = (byStatus[r.status] ?? 0) + r.count;
        byPriority[r.priority] = (byPriority[r.priority] ?? 0) + r.count;
        total += r.count;
      }

      return { total, byStatus, byPriority };
    }),
});
