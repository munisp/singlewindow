/**
 * Batch Payments tRPC Router — 1B Payments/Day Architecture
 *
 * Implements the async payment queue pattern from:
 *   https://backend.how/posts/1b-payments-per-day/
 *   https://github.com/pratikgajjar/1b-payments
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  paymentQueue,
  paymentAccounts,
  paymentIdempotencyKeys,
  paymentArchivalJobs,
} from "../../drizzle/schema";
import { eq, desc, and, count, gte, lt } from "drizzle-orm";

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const batchPaymentsRouter = router({
  enqueue: protectedProcedure
    .input(z.object({
      transferId: z.string().min(1).max(128),
      debitAccountId: z.string().min(1).max(128),
      creditAccountId: z.string().min(1).max(128),
      amountMinorUnits: z.number().int().positive(),
      currency: z.string().length(3).default("GHS"),
      ledger: z.number().int().default(1),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const keyHash = await sha256(`enqueue:${input.transferId}`);
      const [existing] = await db.select().from(paymentIdempotencyKeys).where(eq(paymentIdempotencyKeys.keyHash, keyHash)).limit(1);
      if (existing) return { duplicate: true, transferId: input.transferId, cachedResponse: existing.responseSnapshot };
      const [inserted] = await db.insert(paymentQueue).values({
        transferId: input.transferId,
        debitAccountId: input.debitAccountId,
        creditAccountId: input.creditAccountId,
        amountMinorUnits: BigInt(input.amountMinorUnits),
        currency: input.currency,
        ledger: input.ledger,
        metadata: input.metadata ?? null,
        status: "queued",
        attemptCount: 0,
        nextRetryAt: new Date(),
      }).returning();
      const expiresAt = new Date(Date.now() + 86_400_000);
      await db.insert(paymentIdempotencyKeys).values({ keyHash, transferId: input.transferId, responseSnapshot: { queueId: inserted.id, status: "queued" }, expiresAt });
      return { duplicate: false, queueId: inserted.id, transferId: inserted.transferId, status: inserted.status };
    }),

  getQueueStats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const statuses = ["queued", "processing", "committed", "failed", "dead_letter"] as const;
    const results: Record<string, number> = {};
    for (const status of statuses) {
      const [{ total }] = await db.select({ total: count() }).from(paymentQueue).where(eq(paymentQueue.status, status));
      results[status] = Number(total);
    }
    const [{ idempotencyCount }] = await db.select({ idempotencyCount: count() }).from(paymentIdempotencyKeys).where(gte(paymentIdempotencyKeys.expiresAt, new Date()));
    const [{ archivalCount }] = await db.select({ archivalCount: count() }).from(paymentArchivalJobs);
    return {
      queued: results["queued"] ?? 0,
      processing: results["processing"] ?? 0,
      committed: results["committed"] ?? 0,
      failed: results["failed"] ?? 0,
      deadLetter: results["dead_letter"] ?? 0,
      activeIdempotencyKeys: Number(idempotencyCount),
      totalArchivalJobs: Number(archivalCount),
    };
  }),

  retryDeadLetters: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(10) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const oneHourAgo = new Date(Date.now() - 3_600_000);
      const deadItems = await db.select({ id: paymentQueue.id, transferId: paymentQueue.transferId }).from(paymentQueue).where(and(eq(paymentQueue.status, "dead_letter"), lt(paymentQueue.deadLetteredAt, oneHourAgo))).limit(input.limit);
      if (deadItems.length === 0) return { retried: 0, transferIds: [] };
      for (const item of deadItems) {
        await db.update(paymentQueue).set({ status: "queued", attemptCount: 0, lastError: null, nextRetryAt: new Date(), deadLetteredAt: null, updatedAt: new Date() }).where(eq(paymentQueue.id, item.id));
      }
      return { retried: deadItems.length, transferIds: deadItems.map((i) => i.transferId) };
    }),

  getAccountBalance: protectedProcedure
    .input(z.object({ accountId: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [account] = await db.select().from(paymentAccounts).where(eq(paymentAccounts.accountId, input.accountId)).limit(1);
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: `Account ${input.accountId} not found` });
      return {
        accountId: account.accountId,
        currency: account.currency,
        ledger: account.ledger,
        shardKey: account.shardKey,
        debitsPosted: Number(account.debitsPosted),
        creditsPosted: Number(account.creditsPosted),
        debitsPending: Number(account.debitsPending),
        creditsPending: Number(account.creditsPending),
        netBalance: Number(account.creditsPosted) - Number(account.debitsPosted),
        lastSyncAt: account.lastSyncAt,
      };
    }),

  listQueue: protectedProcedure
    .input(z.object({
      status: z.enum(["queued", "processing", "committed", "failed", "dead_letter", "all"]).default("all"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const offset = (input.page - 1) * input.pageSize;
      const whereClause = input.status !== "all" ? eq(paymentQueue.status, input.status as "queued" | "processing" | "committed" | "failed" | "dead_letter") : undefined;
      const [items, [{ total }]] = await Promise.all([
        db.select().from(paymentQueue).where(whereClause).orderBy(desc(paymentQueue.createdAt)).limit(input.pageSize).offset(offset),
        db.select({ total: count() }).from(paymentQueue).where(whereClause),
      ]);
      return {
        items: items.map((i) => ({ ...i, amountMinorUnits: Number(i.amountMinorUnits) })),
        total: Number(total),
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(Number(total) / input.pageSize),
      };
    }),

  listArchivalJobs: protectedProcedure
    .input(z.object({
      tier: z.enum(["hot", "warm", "cold", "all"]).default("all"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const offset = (input.page - 1) * input.pageSize;
      const whereClause = input.tier !== "all" ? eq(paymentArchivalJobs.tier, input.tier as "hot" | "warm" | "cold") : undefined;
      const [jobs, [{ total }]] = await Promise.all([
        db.select().from(paymentArchivalJobs).where(whereClause).orderBy(desc(paymentArchivalJobs.createdAt)).limit(input.pageSize).offset(offset),
        db.select({ total: count() }).from(paymentArchivalJobs).where(whereClause),
      ]);
      return {
        jobs: jobs.map((j) => ({ ...j, bytesWritten: Number(j.bytesWritten) })),
        total: Number(total),
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(Number(total) / input.pageSize),
      };
    }),
});
