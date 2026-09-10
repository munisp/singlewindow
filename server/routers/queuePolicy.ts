/**
 * queuePolicy.ts — Phase 18 RL queue-policy SHADOW surface for officers.
 *
 *   - suggestion      — calls the ml-stack POST /score/queue-policy shadow
 *                       scorer (config-gated, fail-closed) and returns the
 *                       policy's suggested order NEXT TO the authoritative
 *                       FIFO/AEO order. The authoritative order is never
 *                       modified; the RL output is an annotation only.
 *   - recordDecision  — append-only log of the officer's accept/override
 *                       decision (queue_policy_decisions, migration 0070)
 *                       for future offline-RL reward joins.
 *
 * Untrained policy is a first-class honest state: ml-stack 409/503 (or a
 * non-shadow payload) maps to PRECONDITION_FAILED with a typed
 * QUEUE_POLICY_NOT_TRAINED message; an unconfigured deployment maps to
 * PRECONDITION_FAILED QUEUE_POLICY_NOT_CONFIGURED. No suggestion is ever
 * fabricated.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { queuePolicyDecisions } from "../../drizzle/schema";
import {
  loadPrioritizedExportQueue,
  requireOfficer,
} from "./aeoFastLane";
import {
  QueuePolicyConfigError,
  QueuePolicyInvalidResponseError,
  QueuePolicyUnavailableError,
  QueuePolicyUntrainedError,
  requestQueuePolicySuggestion,
  type QueuePolicyCandidate,
} from "../rl/queuePolicy";

function toTrpcError(err: unknown): TRPCError {
  if (err instanceof QueuePolicyUntrainedError) {
    return new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
  }
  if (err instanceof QueuePolicyConfigError) {
    return new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
  }
  if (err instanceof QueuePolicyInvalidResponseError) {
    // The upstream answered 200 but the payload violates the shadow
    // contract — refuse to display it (fail closed).
    return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
  }
  if (err instanceof QueuePolicyUnavailableError) {
    return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
  }
  return err instanceof TRPCError
    ? err
    : new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "queue-policy suggestion failed" });
}

const TIER_RANKS: Record<string, number> = { gold: 3, silver: 2, standard: 1 };

export const queuePolicyRouter = router({
  /**
   * Shadow suggestion for the officer export queue. Returns both orders;
   * the caller MUST treat authoritativeOrder as the binding sequence.
   */
  suggestion: protectedProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database is not available in this environment",
        });
      }
      const items = await loadPrioritizedExportQueue(db, {
        status: input?.status,
        limit: input?.limit ?? 50,
      });
      const now = Date.now();
      const candidates: QueuePolicyCandidate[] = items.map((r) => ({
        declarationId: r.id,
        features: {
          aeoTierRank: r.fastLane ? TIER_RANKS[r.aeoTier ?? "standard"] ?? 1 : 0,
          fastLane: r.fastLane ? 1 : 0,
          submittedAgeMinutes: r.submittedAt
            ? Math.max(0, Math.round((now - new Date(r.submittedAt).getTime()) / 60_000))
            : 0,
          riskScore: r.riskScore != null ? Number(r.riskScore) : 0,
        },
      }));
      try {
        const suggestion = await requestQueuePolicySuggestion(candidates);
        return {
          mode: suggestion.mode,
          policyVersion: suggestion.policyVersion,
          opeScore: suggestion.opeScore,
          /** Authoritative FIFO/AEO order — binding, never auto-reordered. */
          authoritativeOrder: items.map((r) => r.id),
          suggestedOrder: suggestion.suggestedOrder,
        };
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  /**
   * Append-only officer decision log (reward-join substrate). The decision
   * is recorded against the policy version that produced the suggestion.
   */
  recordDecision: protectedProcedure
    .input(
      z.object({
        declarationId: z.number().int().positive(),
        policyVersion: z.string().min(1).max(64),
        suggestedPosition: z.number().int().min(1),
        authoritativePosition: z.number().int().min(1),
        decision: z.enum(["accepted", "overrode"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database is not available in this environment",
        });
      }
      const [row] = await db
        .insert(queuePolicyDecisions)
        .values({
          officerId: ctx.user.id,
          declarationId: input.declarationId,
          policyVersion: input.policyVersion,
          suggestedPosition: input.suggestedPosition,
          authoritativePosition: input.authoritativePosition,
          decision: input.decision,
        })
        .returning();
      return { id: row.id, recorded: true };
    }),
});
