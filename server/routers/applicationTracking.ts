import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicRateLimitedProcedure, router } from "../_core/trpc";
import { lookupPublicApplication } from "../_core/applicationTracking";

export const applicationTrackingRouter = router({
  track: publicRateLimitedProcedure
    .input(z.object({ referenceNumber: z.string().min(8).max(64) }))
    .query(async ({ input }) => {
      try {
        return await lookupPublicApplication(input.referenceNumber);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Application tracking is unavailable.",
          cause: error,
        });
      }
    }),
});
