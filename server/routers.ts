import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getAllUsers, getUserById, logAuditEvent } from "./db";
import { documentVaultRouter } from "./routers/documentVault";
import { z } from "zod";
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
import { postAuditRouter } from "./routers/postAudit";
import { drawbackRouter } from "./routers/drawback";
import { knowledgeGraphRouter } from "./routers/knowledgeGraph";
import { fraudCasesRouter } from "./routers/fraudCases";
import { alertsRouter } from "./routers/alerts";
import { officerWorkloadRouter } from "./routers/officerWorkload";
import { userNotificationsRouter } from "./routers/userNotifications";
import { slaEscalationRouter } from "./routers/slaEscalation";
import { bulkExportRouter } from "./routers/bulkExport";
import { notificationPreferencesRouter } from "./routers/notificationPreferences";
import { adminAnalyticsRouter } from "./routers/adminAnalytics";
import { ledgerRouter } from "./routers/ledger";
import { keycloakRouter } from "./routers/keycloak";
import { streamRouter } from "./routers/stream";
import { warehouseRouter } from "./routers/warehouse";
import { aseanSwRouter } from "./routers/aseanSw";
import { cenRouter } from "./routers/cen";
import { freeZoneRouter } from "./routers/freeZone";
import { devPortalRouter } from "./routers/devPortal";
import { threatIntelRouter } from "./routers/threatIntel";
import { wazuhRouter } from "./routers/wazuh";
import { riskModelRouter } from "./routers/riskModel";
import { analyticsRouter } from "./routers/analytics";
import { tenantRouter } from "./routers/tenant";
import { cepRouter } from "./routers/cep";
import { costRouter } from "./routers/cost";
import { socRouter } from "./routers/soc";
import { auditEngineRouter } from "./routers/auditEngine";
import { bondedWarehouseRouter } from "./routers/bondedWarehouse";

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
    changeRole: protectedProcedure
      .input(z.object({
        userId: z.number().int().positive(),
        role: z.enum(["user", "admin", "customs_officer", "oga_officer", "inspector", "finance"]),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot change your own role" });
        const db = await (await import("./db")).getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { users } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const result = await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId)).returning();
        if (!result[0]) throw new TRPCError({ code: "NOT_FOUND" });
        await logAuditEvent({
          entityType: "user",
          entityId: input.userId,
          action: "role_changed",
          actorId: ctx.user.id,
          actorType: "admin",
          newState: { role: input.role },
        });
        return result[0];
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
  postAudit: postAuditRouter,
  drawback: drawbackRouter,
  knowledgeGraph: knowledgeGraphRouter,
  fraudCases: fraudCasesRouter,
  alerts: alertsRouter,
  officerWorkload: officerWorkloadRouter,
  userNotifications: userNotificationsRouter,
  slaEscalation: slaEscalationRouter,
  bulkExport: bulkExportRouter,
  notificationPreferences: notificationPreferencesRouter,
  adminAnalytics: adminAnalyticsRouter,
  documentVault: documentVaultRouter,
  ledger: ledgerRouter,
  keycloak: keycloakRouter,
  stream: streamRouter,
  warehouse: warehouseRouter,
  aseanSw: aseanSwRouter,
  cen: cenRouter,
  freeZone: freeZoneRouter,
  devPortal: devPortalRouter,
  threatIntel: threatIntelRouter,
  wazuh: wazuhRouter,
  riskModel: riskModelRouter,
  analytics: analyticsRouter,
  tenant: tenantRouter,
  cep: cepRouter,
  cost: costRouter,
  soc: socRouter,
  auditEngine: auditEngineRouter,
  bondedWarehouse: bondedWarehouseRouter,
});

export type AppRouter = typeof appRouter;
