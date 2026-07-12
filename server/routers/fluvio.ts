/**
 * fluvioRouter — v88: Fluvio consumer-group lag dashboard.
 * Provides read/write access to fluvio_topic_offsets table.
 */
import { z } from "zod";
import { router, adminProcedure, protectedProcedure } from "../_core/trpc";

export const fluvioRouter = router({
  /**
   * v88: List all topic/partition/consumer-group offsets, sorted by lag desc.
   */
  getTopicOffsets: protectedProcedure
    .input(z.object({ topic: z.string().optional(), consumerGroup: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const { getFluvioTopicOffsets } = await import("../db");
      return getFluvioTopicOffsets({ topic: input?.topic, consumerGroup: input?.consumerGroup });
    }),

  /**
   * v88: Upsert a topic offset record (used by Fluvio metrics scraper).
   */
  upsertOffset: adminProcedure
    .input(z.object({
      topic: z.string().min(1),
      partition: z.number().int().min(0).default(0),
      consumerGroup: z.string().min(1),
      committedOffset: z.number().int().min(0),
      latestOffset: z.number().int().min(0),
      lagCount: z.number().int().min(0),
      isHealthy: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const { upsertFluvioOffset } = await import("../db");
      return upsertFluvioOffset(input);
    }),

  /**
   * v88: Get aggregate lag summary per consumer group.
   */
  getLagSummary: protectedProcedure.query(async () => {
    const { getFluvioTopicOffsets } = await import("../db");
    const rows = await getFluvioTopicOffsets();
    const byGroup: Record<string, { totalLag: number; unhealthyTopics: number; topicCount: number }> = {};
    for (const r of rows) {
      if (!byGroup[r.consumerGroup]) byGroup[r.consumerGroup] = { totalLag: 0, unhealthyTopics: 0, topicCount: 0 };
      byGroup[r.consumerGroup].totalLag += Number(r.lagCount);
      byGroup[r.consumerGroup].topicCount++;
      if (!r.isHealthy) byGroup[r.consumerGroup].unhealthyTopics++;
    }
    return Object.entries(byGroup).map(([consumerGroup, stats]) => ({ consumerGroup, ...stats }));
  }),
});
