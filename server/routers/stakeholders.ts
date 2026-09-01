/**
 * Phase 12 — Stakeholder-360 tRPC router.
 *
 * Officer-facing unified party view. Query-time aggregation only
 * (server/crm/stakeholders.ts); no data duplication.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../_core/trpc";
import { keycloakCustomsOfficerProcedure } from "../_core/trpc";
import {
  getStakeholder360,
  searchStakeholders,
  StakeholderNotFoundError,
  SEARCH_MAX_PAGE_SIZE,
} from "../crm/stakeholders";

export const stakeholdersRouter = router({
  /** Unified 360 profile for a stakeholder (trader/agent/carrier/insurer). */
  get360: keycloakCustomsOfficerProcedure
    .input(z.object({ profileId: z.number().int().positive() }))
    .query(async ({ input }) => {
      try {
        return await getStakeholder360(input.profileId);
      } catch (err) {
        if (err instanceof StakeholderNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stakeholder-360 aggregation failed",
          cause: err,
        });
      }
    }),

  /** Search across party profiles; page size is hard-capped server-side. */
  search: keycloakCustomsOfficerProcedure
    .input(
      z.object({
        q: z.string().max(120).optional(),
        stakeholderType: z.string().max(40).optional(),
        status: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(SEARCH_MAX_PAGE_SIZE).default(25),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        return await searchStakeholders(input);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stakeholder search failed",
          cause: err,
        });
      }
    }),
});
