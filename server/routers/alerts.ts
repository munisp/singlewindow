/**
 * Alerts tRPC Router
 *
 * Provides the nightly risk scan procedure that:
 *   1. Queries declarations with riskScore > threshold submitted in the last N hours
 *   2. Persists a RiskScanResult record
 *   3. Sends an owner notification with the summary
 *   4. Optionally auto-creates fraud cases for the highest-risk declarations
 *
 * The scan can be triggered manually (admin-only) or called by a cron job.
 * The getRiskAlerts procedure returns recent scan results for the Risk Alerts page.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";

// ─── ROUTER ──────────────────────────────────────────────────────────────────

export const alertsRouter = router({

  // ── RUN NIGHTLY RISK SCAN ───────────────────────────────────────────────────
  // Admin-only. Scans declarations in the last `periodHours` hours with
  // riskScore >= threshold. Persists results and sends owner notification.
  runNightlyRiskScan: protectedProcedure
    .input(
      z.object({
        threshold: z.number().min(0).max(1).default(0.8),
        periodHours: z.number().int().min(1).max(168).default(24),
        autoCreateCases: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin role required" });
      }

      const { getDb } = await import("../db");
      const { declarations, riskScanResults, fraudCases } = await import("../../drizzle/schema");
      const { gte, and, sql } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const since = new Date();
      since.setHours(since.getHours() - input.periodHours);

      // Query high-risk declarations
      const highRiskDecls = await db
        .select()
        .from(declarations)
        .where(
          and(
            gte(declarations.createdAt, since),
            sql`${declarations.riskScore} >= ${input.threshold}`
          )
        )
        .orderBy(sql`${declarations.riskScore} desc`)
        .limit(500);

      const flaggedIds = highRiskDecls.map((d) => d.id);
      let newCasesCreated = 0;

      // Optionally auto-create fraud cases for red-lane declarations
      if (input.autoCreateCases && highRiskDecls.length > 0) {
        const redDecls = highRiskDecls.filter((d) => d.riskLane === "red").slice(0, 20);
        for (const decl of redDecls) {
          try {
            await db.insert(fraudCases).values({
              caseNumber: `FC-AUTO-${decl.id}-${Date.now()}`,
              traderId: decl.traderId,
              title: `Auto-flagged: ${decl.declarationNumber} (risk ${Number(decl.riskScore).toFixed(2)})`,
              description: `Automatically created by nightly risk scan. Declaration ${decl.declarationNumber} scored ${decl.riskScore} on ${decl.createdAt?.toISOString()}.`,
              status: "open",
              priority: Number(decl.riskScore) >= 0.9 ? "critical" : "high",
              createdBy: ctx.user.id,
              linkedDeclarationIds: [decl.id],
              riskScore: Number(decl.riskScore),
            });
            newCasesCreated++;
          } catch {
            // Skip duplicates silently
          }
        }
      }

      // Persist scan result
      const [scanResult] = await db
        .insert(riskScanResults)
        .values({
          totalDeclarationsScanned: highRiskDecls.length,
          highRiskCount: highRiskDecls.length,
          newCasesCreated,
          thresholdUsed: input.threshold,
          scanPeriodHours: input.periodHours,
          flaggedDeclarationIds: flaggedIds,
          notificationSent: false,
          runBy: ctx.user.id,
        })
        .returning();

      // Send owner notification
      let notificationSent = false;
      try {
        const { notifyOwner } = await import("../_core/notification");
        const topDecls = highRiskDecls.slice(0, 5).map((d) =>
          `  • ${d.declarationNumber} — risk ${Number(d.riskScore).toFixed(2)} (${d.riskLane ?? "unknown"} lane)`
        ).join("\n");

        const content = [
          `Nightly risk scan completed at ${new Date().toUTCString()}.`,
          ``,
          `Period: last ${input.periodHours} hours | Threshold: ${input.threshold}`,
          `High-risk declarations found: ${highRiskDecls.length}`,
          newCasesCreated > 0 ? `Fraud cases auto-created: ${newCasesCreated}` : "",
          ``,
          highRiskDecls.length > 0 ? `Top flagged declarations:\n${topDecls}` : "No high-risk declarations found.",
        ].filter(Boolean).join("\n");

        notificationSent = await notifyOwner({
          title: `Risk Scan: ${highRiskDecls.length} high-risk declaration${highRiskDecls.length !== 1 ? "s" : ""} detected`,
          content,
        });
      } catch {
        // Notification failure is non-fatal
      }

      // Update notification status
      if (notificationSent) {
        const { eq } = await import("drizzle-orm");
        await db
          .update(riskScanResults)
          .set({ notificationSent: true })
          .where(eq(riskScanResults.id, scanResult.id));
      }

      return {
        ...scanResult,
        notificationSent,
        flaggedDeclarations: highRiskDecls.slice(0, 20).map((d) => ({
          id: d.id,
          declarationNumber: d.declarationNumber,
          traderId: d.traderId,
          riskScore: Number(d.riskScore ?? 0),
          riskLane: d.riskLane ?? "green",
          hsCode: d.hsCode ?? "",
          portOfEntry: d.portOfEntry ?? "",
          createdAt: d.createdAt?.toISOString() ?? "",
        })),
      };
    }),

  // ── GET RISK ALERTS ──────────────────────────────────────────────────────────
  // Returns the most recent scan results for the Risk Alerts page.
  getRiskAlerts: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin" && ctx.user.role !== "customs_officer") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin or customs officer role required" });
      }

      const { getDb } = await import("../db");
      const { riskScanResults } = await import("../../drizzle/schema");
      const { desc } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const rows = await db
        .select()
        .from(riskScanResults)
        .orderBy(desc(riskScanResults.scanRunAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows;
    }),

  // ── GET LATEST FLAGGED DECLARATIONS ─────────────────────────────────────────
  // Returns the high-risk declarations from the most recent scan.
  getLatestFlaggedDeclarations: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin" && ctx.user.role !== "customs_officer") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin or customs officer role required" });
      }

      const { getDb } = await import("../db");
      const { riskScanResults, declarations } = await import("../../drizzle/schema");
      const { desc, inArray } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Get the most recent scan
      const [latestScan] = await db
        .select()
        .from(riskScanResults)
        .orderBy(desc(riskScanResults.scanRunAt))
        .limit(1);

      if (!latestScan || !latestScan.flaggedDeclarationIds?.length) {
        return { scan: latestScan ?? null, declarations: [] };
      }

      const ids = (latestScan.flaggedDeclarationIds as number[]).slice(0, input.limit);
      const decls = await db
        .select()
        .from(declarations)
        .where(inArray(declarations.id, ids));

      return {
        scan: latestScan,
        declarations: decls.map((d) => ({
          id: d.id,
          declarationNumber: d.declarationNumber,
          traderId: d.traderId,
          riskScore: Number(d.riskScore ?? 0),
          riskLane: d.riskLane ?? "green",
          hsCode: d.hsCode ?? "",
          portOfEntry: d.portOfEntry ?? "",
          status: d.status,
          createdAt: d.createdAt?.toISOString() ?? "",
        })),
      };
    }),
});
