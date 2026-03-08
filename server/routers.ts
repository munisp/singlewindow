import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getAllUsers } from "./db";
import { declarationsRouter } from "./routers/declarations";
import { profilesRouter } from "./routers/profiles";
import { paymentsRouter } from "./routers/payments";
import { ogaRouter } from "./routers/oga";
import { securityRouter } from "./routers/security";
import { aeoRouter } from "./routers/aeo";
import { notificationsRouter } from "./routers/notifications";
import { kycRouter } from "./routers/kyc";
import { visionRouter } from "./routers/vision";
import { aiRouter } from "./routers/ai";
import { mojaloopRouter } from "./routers/mojaloop";
import { temporalRouter } from "./routers/temporal";
import { geospatialRouter } from "./routers/geospatial";
import { financeRouter } from "./routers/finance";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
    listUsers: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getAllUsers(200, 0);
    }),
  }),

  declarations: declarationsRouter,
  profiles: profilesRouter,
  payments: paymentsRouter,
  oga: ogaRouter,
  security: securityRouter,
  aeo: aeoRouter,
  notifications: notificationsRouter,
  kyc: kycRouter,
  vision: visionRouter,
  ai: aiRouter,
  mojaloop: mojaloopRouter,
  temporal: temporalRouter,
  geospatial: geospatialRouter,
  finance: financeRouter,
});

export type AppRouter = typeof appRouter;
