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
import { and, eq } from "drizzle-orm";
import { queuePolicyDecisions, queuePolicySuggestions } from "../../drizzle/schema";
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

/**
 * M2: 23505 unique_violation detection that WALKS the error cause chain.
 * node-postgres surfaces the SQLSTATE on the thrown error itself, but
 * driver wrappers (drizzle proxies, pool middleware) may wrap it — the
 * code can live on err.cause (or deeper). Verified against real PG both
 * ways; a flat `err.code === "23505"` check misses wrapped violations and
 * would surface a spurious 500 instead of folding the duplicate.
 */
function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 8 && cur != null && typeof cur === "object"; depth += 1) {
    if ((cur as { code?: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

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
        // M2: persist the suggestion EPISODE (policy version, candidate ids,
        // feature snapshot, both orders, served_at) so recordDecision can be
        // attributed to this exact episode and offline-RL replay can
        // reconstruct the state the policy saw.
        const authoritativeOrder = items.map((r) => r.id);
        const featureSnapshot: Record<string, Record<string, number>> = {};
        for (const c of candidates) featureSnapshot[String(c.declarationId)] = c.features;
        const [episode] = await db
          .insert(queuePolicySuggestions)
          .values({
            policyVersion: suggestion.policyVersion,
            candidateIds: candidates.map((c) => c.declarationId),
            featureSnapshot,
            authoritativeOrder,
            suggestedOrder: suggestion.suggestedOrder,
            servedTo: ctx.user.id,
          })
          .returning({ id: queuePolicySuggestions.id });
        return {
          suggestionId: episode.id,
          mode: suggestion.mode,
          policyVersion: suggestion.policyVersion,
          opeScore: suggestion.opeScore,
          /** Authoritative FIFO/AEO order — binding, never auto-reordered. */
          authoritativeOrder,
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
  /**
   * Record the officer's decision against a SERVED suggestion episode (M1/M2).
   * The client supplies only { suggestionId, declarationId, decision }; both
   * positions and the policy version are derived server-side from the
   * persisted episode — fabricated positions are impossible. Membership is
   * validated: the declaration must be in the episode's candidate set. The
   * (suggestion_id, declaration_id, officer_id) unique index makes the log
   * insert-idempotent: a duplicate submission (double-click, retry) folds
   * into the already-recorded decision instead of appending a second row.
   */
  recordDecision: protectedProcedure
    .input(
      z.object({
        suggestionId: z.number().int().positive(),
        declarationId: z.number().int().positive(),
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
      const [episode] = await db
        .select()
        .from(queuePolicySuggestions)
        .where(eq(queuePolicySuggestions.id, input.suggestionId));
      if (!episode) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Suggestion episode #${input.suggestionId} not found — decisions can only be recorded against a served suggestion`,
        });
      }
      const candidates = episode.candidateIds as number[];
      if (!candidates.includes(input.declarationId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Declaration #${input.declarationId} was not in the scored candidate set of suggestion #${input.suggestionId}`,
        });
      }
      const suggestedOrder = episode.suggestedOrder as number[];
      const authoritativeOrder = episode.authoritativeOrder as number[];
      const suggestedPosition = suggestedOrder.indexOf(input.declarationId) + 1;
      const authoritativePosition = authoritativeOrder.indexOf(input.declarationId) + 1;
      try {
        const [row] = await db
          .insert(queuePolicyDecisions)
          .values({
            officerId: ctx.user.id,
            declarationId: input.declarationId,
            policyVersion: episode.policyVersion,
            suggestedPosition,
            authoritativePosition,
            decision: input.decision,
            suggestionId: episode.id,
          })
          .returning();
        return { id: row.id, recorded: true, duplicate: false };
      } catch (err) {
        // 23505 unique_violation → this officer already decided on this
        // declaration in this episode: fold into the existing row.
        if (isUniqueViolation(err)) {
          const [existing] = await db
            .select({ id: queuePolicyDecisions.id })
            .from(queuePolicyDecisions)
            .where(
              and(
                eq(queuePolicyDecisions.suggestionId, episode.id),
                eq(queuePolicyDecisions.declarationId, input.declarationId),
                eq(queuePolicyDecisions.officerId, ctx.user.id)
              )
            );
          return { id: existing?.id, recorded: true, duplicate: true };
        }
        throw err;
      }
    }),
});
