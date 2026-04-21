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
import { portCongestionRouter } from "./routers/portCongestion";
import { traderScorecardRouter } from "./routers/traderScorecard";
import { cargoTrackingRouter } from "./routers/cargoTracking";
import { onboardingRouter } from "./routers/onboarding";
import { geofencesRouter } from "./routers/geofences";
import { webhooksRouter } from "./routers/webhooks";
import { apiChangelogRouter } from "./routers/apiChangelog";
import { onboardingAnalyticsRouter } from "./routers/onboardingAnalytics";
import { rulesOfOriginRouter } from "./routers/rulesOfOrigin";
import { pilotRouter } from "./routers/pilot";
import { executiveDashboardRouter } from "./routers/executiveDashboard";
import { nigeriaIdRouter } from "./routers/nigeriaId";
import { siteSettingsRouter } from "./routers/siteSettings";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(async (opts) => {
      const user = opts.ctx.user;
      if (!user) return null;
      // Keycloak role sync: if a Keycloak Bearer token is present, sync realm_access.roles → user.role
      try {
        const { syncKeycloakRole } = await import("./_core/keycloakRoleSync");
        await syncKeycloakRole(opts.ctx.req, user.id);
      } catch { /* non-fatal */ }
      // Sprint 69: check onboarding completion status
      try {
        const db = await (await import("./db")).getDb();
        if (!db) return { ...user, hasCompletedOnboarding: false };
        const { onboardingProgress } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const [record] = await db
          .select({ completedAt: onboardingProgress.completedAt })
          .from(onboardingProgress)
          .where(eq(onboardingProgress.userId, user.id))
          .limit(1);
        const hasCompletedOnboarding = !!(record?.completedAt);
        return { ...user, hasCompletedOnboarding };
      } catch {
        return { ...user, hasCompletedOnboarding: false };
      }
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
    listUsers: protectedProcedure
      .input(z.object({
        limit: z.number().int().min(1).max(500).default(200),
        offset: z.number().int().min(0).default(0),
        search: z.string().optional(),
        role: z.string().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const db = await (await import("./db")).getDb();
        if (!db) return [];
        const { users } = await import("../drizzle/schema");
        const { desc, ilike, eq, and, or } = await import("drizzle-orm");
        const conditions: any[] = [];
        if (input?.search) {
          conditions.push(or(
            ilike(users.name, `%${input.search}%`),
            ilike(users.email, `%${input.search}%`),
          ));
        }
        if (input?.role && input.role !== "ALL") {
          conditions.push(eq(users.role, input.role as any));
        }
        return db.select().from(users)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(users.createdAt))
          .limit(input?.limit ?? 200)
          .offset(input?.offset ?? 0);
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
    userStats: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await (await import("./db")).getDb();
      if (!db) return { total: 0, byRole: {} as Record<string, number> };
      const { users } = await import("../drizzle/schema");
      const { sql } = await import("drizzle-orm");
      const rows = await db.select({ role: users.role, count: sql<number>`count(*)::int` }).from(users).groupBy(users.role);
      const byRole: Record<string, number> = {};
      let total = 0;
      for (const r of rows) { byRole[r.role] = r.count; total += r.count; }
      return { total, byRole };
    }),
    updateUserName: protectedProcedure
      .input(z.object({ userId: z.number().int().positive(), name: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const db = await (await import("./db")).getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { users } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const result = await db.update(users).set({ name: input.name, updatedAt: new Date() }).where(eq(users.id, input.userId)).returning();
        if (!result[0]) throw new TRPCError({ code: "NOT_FOUND" });
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
  portCongestion: portCongestionRouter,
  traderScorecard: traderScorecardRouter,
  cargoTracking: cargoTrackingRouter,
  onboarding: onboardingRouter,
  geofences: geofencesRouter,
  webhooks: webhooksRouter,
  apiChangelog: apiChangelogRouter,
  onboardingAnalytics: onboardingAnalyticsRouter,
  rulesOfOrigin: rulesOfOriginRouter,
  pilot: pilotRouter,
  executiveDashboard: executiveDashboardRouter,
  nigeriaId: nigeriaIdRouter,
  siteSettings: siteSettingsRouter,
});

export type AppRouter = typeof appRouter;
