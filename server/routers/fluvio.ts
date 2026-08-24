/**
 * fluvioRouter — v88: Fluvio consumer-group lag dashboard.
 * Provides read access to fluvio_topic_offsets table and service-only offset reporting.
 */
import { z } from "zod";
import { timingSafeEqual } from "crypto";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";

const OFFSET_FRESHNESS_MS = Number(process.env.FLUVIO_OFFSET_FRESHNESS_MS ?? 300_000);
const FLUVIO_SERVICE_TOKEN = process.env.FLUVIO_SERVICE_TOKEN ?? "";

function hasStrongServiceToken(token: string): boolean {
  if (token.length < 32) return false;
  if (process.env.NODE_ENV !== "production") return true;
  const lower = token.toLowerCase();
  return !["dev", "secret", "password", "placeholder", "example", "test"].some((value) => lower.includes(value));
}

function tokensMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer);
}

export function classifyOffsetFreshness(lastUpdatedAt: Date, now = Date.now()): "current" | "stale" {
  return now - lastUpdatedAt.getTime() <= OFFSET_FRESHNESS_MS ? "current" : "stale";
}

export const fluvioRouter = router({
  reportOffset: publicProcedure
    .input(z.object({
      topic: z.string().min(1),
      partition: z.number().int().min(0).default(0),
      consumerGroup: z.string().min(1),
      committedOffset: z.number().int().min(0),
      latestOffset: z.number().int().min(0),
      lagCount: z.number().int().min(0),
      isHealthy: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const authorization = ctx.req.headers.authorization;
      const providedToken = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "";
      if (!hasStrongServiceToken(FLUVIO_SERVICE_TOKEN) || !tokensMatch(providedToken, FLUVIO_SERVICE_TOKEN)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Fluvio consumer service authentication required" });
      }
      const { upsertFluvioOffset } = await import("../db");
      return upsertFluvioOffset(input);
    }),

  /**
   * v88: List all topic/partition/consumer-group offsets, sorted by lag desc.
   */
  getTopicOffsets: protectedProcedure
    .input(z.object({ topic: z.string().optional(), consumerGroup: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const { getFluvioTopicOffsets } = await import("../db");
      const rows = await getFluvioTopicOffsets({ topic: input?.topic, consumerGroup: input?.consumerGroup });
      const now = Date.now();
      return rows.map((row) => {
        const fresh = classifyOffsetFreshness(row.lastUpdatedAt, now) === "current";
        return {
          ...row,
          freshness: fresh ? "current" : "stale",
          displayStatus: fresh && row.isHealthy ? "healthy" : "unknown / stale",
        };
      });
    }),

  /**
   * v88: Get aggregate lag summary per consumer group.
   */
  getLagSummary: protectedProcedure.query(async () => {
    const { getFluvioTopicOffsets } = await import("../db");
    const rows = await getFluvioTopicOffsets();
    const now = Date.now();
    const byGroup: Record<string, { totalLag: number; unhealthyTopics: number; topicCount: number }> = {};
    for (const r of rows) {
      if (!byGroup[r.consumerGroup]) byGroup[r.consumerGroup] = { totalLag: 0, unhealthyTopics: 0, topicCount: 0 };
      const fresh = classifyOffsetFreshness(r.lastUpdatedAt, now) === "current";
      byGroup[r.consumerGroup].totalLag += fresh ? Number(r.lagCount) : 0;
      byGroup[r.consumerGroup].topicCount++;
      if (!fresh || !r.isHealthy) byGroup[r.consumerGroup].unhealthyTopics++;
    }
    return Object.entries(byGroup).map(([consumerGroup, stats]) => ({ consumerGroup, ...stats }));
  }),
});
