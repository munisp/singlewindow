/**
 * mswExchange.ts (router) — cross-border MSW exchange egress (Phase 10 WP-3).
 * Admin-gated: transforms an ACCEPTED declaration version into a signed IMO
 * Compendium envelope v1.0 (see server/_core/mswExchange.ts). Ingest lives on
 * the raw HTTP path POST /api/v1/msw/exchange/ingest (mounted in
 * server/_core/index.ts) because it is authenticated by the peer authority
 * JWS, not by a platform session.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import {
  buildSignedExport,
  MswExchangeError,
} from "../_core/mswExchange";
import { MswServiceError } from "../mswService";

export const mswExchangeRouter = router({
  /**
   * Export an ACCEPTED declaration as a signed IMO Compendium envelope.
   * Returns the signed envelope plus the honest delivery state
   * ("NOT_DELIVERED_NO_PEER_CONFIGURED" unless MSW_EXCHANGE_PEER_URL is set
   * and deliver=true). Fail closed: non-ACCEPTED declarations, unmapped
   * mandatory elements, digest mismatches and missing signing keys reject.
   */
  exportDeclaration: adminProcedure
    .input(
      z.object({
        declarationId: z.string().min(1).max(32),
        deliver: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await buildSignedExport({
          declarationId: input.declarationId,
          principalId: `user:${ctx.user.id}`,
          deliver: input.deliver,
        });
      } catch (err) {
        if (err instanceof MswExchangeError || err instanceof MswServiceError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${err.reasonCode}: ${err.message}`,
          });
        }
        throw err;
      }
    }),
});
