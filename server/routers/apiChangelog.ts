/**
 * API Changelog Router — Sprint 74
 * Track and display API version changes, breaking changes, and migration guides.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { apiChangelog } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

// Seed data for initial changelog entries
const INITIAL_CHANGELOG = [
  { version: "3.0.0", changeType: "added" as const, endpoint: "trpc.cargoTracking.getLiveVessels", description: "Real-time AIS vessel position tracking for East Africa corridor", breakingChange: false },
  { version: "3.0.0", changeType: "added" as const, endpoint: "trpc.onboarding.*", description: "5-step trader onboarding wizard with AEO eligibility assessment", breakingChange: false },
  { version: "3.0.0", changeType: "added" as const, endpoint: "GET /api/openapi.json", description: "OpenAPI 3.1 specification endpoint for all tRPC procedures", breakingChange: false },
  { version: "2.9.0", changeType: "added" as const, endpoint: "trpc.geofences.*", description: "Geofence management with vessel entry/exit alerts and owner notifications", breakingChange: false },
  { version: "2.9.0", changeType: "added" as const, endpoint: "trpc.webhooks.*", description: "Webhook subscription management with HMAC-signed delivery", breakingChange: false },
  { version: "2.8.0", changeType: "modified" as const, endpoint: "trpc.auth.me", description: "Added hasCompletedOnboarding flag to auth.me response", breakingChange: false },
  { version: "2.7.0", changeType: "added" as const, endpoint: "trpc.documentVault.share", description: "Secure document sharing with optional password protection and expiry", breakingChange: false },
  { version: "2.6.0", changeType: "added" as const, endpoint: "trpc.bulkExport.exportDeclarations", description: "Export declarations to CSV/Excel with date range and status filters", breakingChange: false },
  { version: "2.5.0", changeType: "added" as const, endpoint: "trpc.slaEscalation.*", description: "SLA breach detection with supervisor notifications and workload tracking", breakingChange: false },
  { version: "2.4.0", changeType: "added" as const, endpoint: "trpc.userNotifications.*", description: "In-app notification system with read/unread state and badge counts", breakingChange: false },
  { version: "2.3.0", changeType: "added" as const, endpoint: "trpc.fraudCases.*", description: "Investigation case management with evidence upload and audit trail", breakingChange: false },
  { version: "2.2.0", changeType: "added" as const, endpoint: "trpc.knowledgeGraph.*", description: "Entity relationship graph for trader network analysis", breakingChange: false },
  { version: "2.1.0", changeType: "breaking" as const, endpoint: "trpc.declarations.submit", description: "Declaration submission now requires UCR generation before status transition", breakingChange: true, migrationGuide: "Call declarations.generateUcr before submitting. The UCR field is now mandatory in the submitted state." },
  { version: "2.0.0", changeType: "added" as const, endpoint: "trpc.mojaloop.*", description: "Mojaloop payment integration for mobile money duty collection", breakingChange: false },
  { version: "1.9.0", changeType: "added" as const, endpoint: "trpc.vision.*", description: "AI-powered cargo inspection with computer vision analysis", breakingChange: false },
  { version: "1.8.0", changeType: "deprecated" as const, endpoint: "trpc.payments.initiateLegacy", description: "Legacy payment initiation deprecated in favour of trpc.mojaloop.initiatePayment", breakingChange: false, migrationGuide: "Use trpc.mojaloop.initiatePayment with FSP selection and MSISDN input." },
  { version: "1.7.0", changeType: "added" as const, endpoint: "trpc.aeo.*", description: "Authorised Economic Operator programme management and self-assessment", breakingChange: false },
  { version: "1.6.0", changeType: "added" as const, endpoint: "trpc.postAudit.*", description: "Post-clearance audit management with risk-based sampling", breakingChange: false },
  { version: "1.5.0", changeType: "added" as const, endpoint: "trpc.drawback.*", description: "Duty drawback claims with automated eligibility calculation", breakingChange: false },
  { version: "1.0.0", changeType: "added" as const, endpoint: "trpc.declarations.*", description: "Core declaration submission, risk assessment, and clearance workflow", breakingChange: false },
];

export const apiChangelogRouter = router({
  /** List changelog entries (public) */
  list: publicProcedure
    .input(z.object({
      version: z.string().optional(),
      changeType: z.enum(["added", "modified", "deprecated", "removed", "breaking", "all"]).default("all"),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        // Return seed data when DB unavailable
        let entries = INITIAL_CHANGELOG;
        if (input.version) entries = entries.filter(e => e.version === input.version);
        if (input.changeType !== "all") entries = entries.filter(e => e.changeType === input.changeType);
        return entries.slice(0, input.limit).map((e, i) => ({
          id: i + 1,
          ...e,
          migrationGuide: (e as any).migrationGuide ?? null,
          publishedAt: new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000),
          publishedBy: null,
        }));
      }

      const conditions = [];
      if (input.version) conditions.push(eq(apiChangelog.version, input.version));
      if (input.changeType !== "all") conditions.push(eq(apiChangelog.changeType, input.changeType));

      const rows = await db.select().from(apiChangelog)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(apiChangelog.publishedAt))
        .limit(input.limit);

      // If no entries in DB, seed them
      if (rows.length === 0) {
        const seeded = await db.insert(apiChangelog).values(
          INITIAL_CHANGELOG.map((e, i) => ({
            ...e,
            migrationGuide: (e as any).migrationGuide ?? null,
            publishedAt: new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000),
          }))
        ).returning();
        return seeded.slice(0, input.limit);
      }

      return rows;
    }),

  /** Get unique versions */
  versions: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      const versions = Array.from(new Set(INITIAL_CHANGELOG.map(e => e.version))).sort((a, b) => b.localeCompare(a));
      return versions.map(v => ({
        version: v,
        breakingChanges: INITIAL_CHANGELOG.filter(e => e.version === v && e.breakingChange).length,
        totalChanges: INITIAL_CHANGELOG.filter(e => e.version === v).length,
      }));
    }
    const rows = await db.select().from(apiChangelog).orderBy(desc(apiChangelog.publishedAt));
    const versionMap = new Map<string, { breaking: number; total: number }>();
    for (const row of rows) {
      const existing = versionMap.get(row.version) ?? { breaking: 0, total: 0 };
      versionMap.set(row.version, {
        breaking: existing.breaking + (row.breakingChange ? 1 : 0),
        total: existing.total + 1,
      });
    }
    return Array.from(versionMap.entries()).map(([version, stats]) => ({
      version,
      breakingChanges: stats.breaking,
      totalChanges: stats.total,
    }));
  }),

  /** Admin: publish a new changelog entry */
  publish: adminProcedure
    .input(z.object({
      version: z.string().min(1).max(32),
      changeType: z.enum(["added", "modified", "deprecated", "removed", "breaking"]),
      endpoint: z.string().min(1).max(256),
      description: z.string().min(10),
      breakingChange: z.boolean().default(false),
      migrationGuide: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [row] = await db.insert(apiChangelog).values({
        version: input.version,
        changeType: input.changeType,
        endpoint: input.endpoint,
        description: input.description,
        breakingChange: input.breakingChange,
        migrationGuide: input.migrationGuide,
        publishedBy: ctx.user.id,
      }).returning();
      return row;
    }),

  /** Admin: delete a changelog entry */
  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.delete(apiChangelog).where(eq(apiChangelog.id, input.id));
      return { success: true };
    }),
});

export type ApiChangelogRouter = typeof apiChangelogRouter;
