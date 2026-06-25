/**
 * SLA Breach Escalation Router — Sprint 15
 *
 * SLA thresholds (time since submission):
 *   Green lane  → 4 hours
 *   Yellow lane → 24 hours
 *   Red lane    → 72 hours
 *   Blue lane   → 48 hours (AEO / trusted trader)
 *
 * Provides:
 *   - slaEscalation.scan   — admin/officer: run a scan and create breach notifications
 *   - slaEscalation.list   — admin/officer: list current SLA breaches
 *   - slaEscalation.stats  — admin/officer: summary stats
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { createUserNotification } from "../db";

// SLA thresholds in milliseconds
const SLA_THRESHOLDS_MS: Record<string, number> = {
  green: 4 * 60 * 60 * 1000,   // 4 hours
  yellow: 24 * 60 * 60 * 1000, // 24 hours
  red: 72 * 60 * 60 * 1000,    // 72 hours
  blue: 48 * 60 * 60 * 1000,   // 48 hours (AEO)
};

const SLA_LABELS: Record<string, string> = {
  green: "4 hours",
  yellow: "24 hours",
  red: "72 hours",
  blue: "48 hours",
};

function isOfficerOrAdmin(role: string) {
  return role === "admin" || role === "customs_officer" || role === "oga_officer";
}

export const slaEscalationRouter = router({
  // ── SCAN FOR SLA BREACHES ────────────────────────────────────────────────────
  // Finds declarations that have been in processing status beyond their SLA.
  // Creates user_notifications for affected traders and returns a summary.
  scan: protectedProcedure
    .input(
      z.object({
        notifyTraders: z.boolean().default(true),
        dryRun: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isOfficerOrAdmin(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Customs officer or admin role required" });
      }

      const { getDb } = await import("../db");
      const { declarations } = await import("../../drizzle/schema");
      const { and, inArray, lt, isNotNull, notInArray } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return { scanned: 0, breachCount: 0, criticalCount: 0, warningCount: 0, notificationsSent: 0, dryRun: input.dryRun, breaches: [] };

      const now = new Date();

      // Find declarations in processing states (not yet cleared/rejected)
      // Use only status values that exist in the declaration_status DB enum
      const processingStatuses = ["submitted", "under_assessment", "docs_required", "payment_pending", "under_examination"];
      const breachedDeclarations = await db
        .select()
        .from(declarations)
        .where(
          and(
            inArray(declarations.status, processingStatuses as any[]),
            isNotNull(declarations.submittedAt)
          )
        )
        .limit(500);

      const breaches: Array<{
        declarationId: number;
        declarationNumber: string;
        traderId: number;
        riskLane: string;
        status: string;
        submittedAt: string;
        hoursElapsed: number;
        slaThresholdHours: number;
        breachSeverity: "warning" | "critical";
      }> = [];

      for (const decl of breachedDeclarations) {
        if (!decl.submittedAt) continue;
        const lane = decl.riskLane ?? "green";
        const thresholdMs = SLA_THRESHOLDS_MS[lane] ?? SLA_THRESHOLDS_MS.green;
        const elapsed = now.getTime() - new Date(decl.submittedAt).getTime();

        if (elapsed > thresholdMs) {
          const hoursElapsed = Math.round(elapsed / (60 * 60 * 1000) * 10) / 10;
          const thresholdHours = thresholdMs / (60 * 60 * 1000);
          const overageRatio = elapsed / thresholdMs;

          breaches.push({
            declarationId: decl.id,
            declarationNumber: decl.declarationNumber,
            traderId: decl.traderId,
            riskLane: lane,
            status: decl.status,
            submittedAt: decl.submittedAt.toISOString(),
            hoursElapsed,
            slaThresholdHours: thresholdHours,
            breachSeverity: overageRatio >= 2 ? "critical" : "warning",
          });
        }
      }

      // Create notifications for affected traders
      let notificationsSent = 0;
      if (input.notifyTraders && !input.dryRun && breaches.length > 0) {
        for (const breach of breaches) {
          try {
            await createUserNotification({
              userId: breach.traderId,
              type: "sla_breach",
              title: `SLA Breach: Declaration ${breach.declarationNumber}`,
              body: `Your ${breach.riskLane}-lane declaration (${breach.declarationNumber}) has been in "${breach.status}" status for ${breach.hoursElapsed} hours, exceeding the ${SLA_LABELS[breach.riskLane] ?? "SLA"} target. Our team has been notified and is prioritising your case.`,
              declarationId: breach.declarationId,
            });
            notificationsSent++;
          } catch {
            // Non-fatal — continue with other notifications
          }
        }
      }

      // Also notify the owner if there are critical breaches
      if (!input.dryRun && breaches.filter((b) => b.breachSeverity === "critical").length > 0) {
        try {
          const { notifyOwner } = await import("../_core/notification");
          const criticalCount = breaches.filter((b) => b.breachSeverity === "critical").length;
          await notifyOwner({
            title: `SLA Escalation: ${criticalCount} critical breach${criticalCount !== 1 ? "es" : ""} detected`,
            content: [
              `SLA breach scan completed at ${now.toUTCString()}.`,
              `Total breaches: ${breaches.length} (${criticalCount} critical)`,
              ``,
              `Critical breaches (>2× SLA):`,
              ...breaches
                .filter((b) => b.breachSeverity === "critical")
                .slice(0, 10)
                .map(
                  (b) =>
                    `  • ${b.declarationNumber} — ${b.riskLane} lane, ${b.hoursElapsed}h elapsed (SLA: ${b.slaThresholdHours}h)`
                ),
            ].join("\n"),
          });
        } catch {
          // Non-fatal
        }
      }

      return {
        scanned: breachedDeclarations.length,
        breachCount: breaches.length,
        criticalCount: breaches.filter((b) => b.breachSeverity === "critical").length,
        warningCount: breaches.filter((b) => b.breachSeverity === "warning").length,
        notificationsSent,
        dryRun: input.dryRun,
        breaches: breaches.slice(0, 50), // Return up to 50 for display
      };
    }),

  // ── LIST CURRENT SLA BREACHES ────────────────────────────────────────────────
  // Returns declarations currently in breach of their SLA.
  list: protectedProcedure
    .input(
      z.object({
        severity: z.enum(["all", "warning", "critical"]).default("all"),
        lane: z.enum(["all", "green", "yellow", "red", "blue"]).default("all"),
        limit: z.number().int().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!isOfficerOrAdmin(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Customs officer or admin role required" });
      }

      const { getDb } = await import("../db");
      const { declarations, users } = await import("../../drizzle/schema");
      const { and, inArray, isNotNull, eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return { total: 0, critical: 0, warning: 0, items: [], generatedAt: new Date().toISOString() };

      const now = new Date();
      // Use only status values that exist in the declaration_status DB enum
      const processingStatuses = ["submitted", "under_assessment", "docs_required", "payment_pending", "under_examination"];

      const rows = await db
        .select({
          id: declarations.id,
          declarationNumber: declarations.declarationNumber,
          traderId: declarations.traderId,
          traderName: users.name,
          riskLane: declarations.riskLane,
          status: declarations.status,
          submittedAt: declarations.submittedAt,
          portOfEntry: declarations.portOfEntry,
          goodsDescription: declarations.goodsDescription,
        })
        .from(declarations)
        .leftJoin(users, eq(declarations.traderId, users.id))
        .where(
          and(
            inArray(declarations.status, processingStatuses as any[]),
            isNotNull(declarations.submittedAt)
          )
        )
        .limit(500);

      const breaches = rows
        .filter((r) => {
          if (!r.submittedAt) return false;
          const lane = r.riskLane ?? "green";
          if (input.lane !== "all" && lane !== input.lane) return false;
          const thresholdMs = SLA_THRESHOLDS_MS[lane] ?? SLA_THRESHOLDS_MS.green;
          return now.getTime() - new Date(r.submittedAt).getTime() > thresholdMs;
        })
        .map((r) => {
          const lane = r.riskLane ?? "green";
          const thresholdMs = SLA_THRESHOLDS_MS[lane] ?? SLA_THRESHOLDS_MS.green;
          const elapsed = now.getTime() - new Date(r.submittedAt!).getTime();
          const hoursElapsed = Math.round(elapsed / (60 * 60 * 1000) * 10) / 10;
          const thresholdHours = thresholdMs / (60 * 60 * 1000);
          const overageRatio = elapsed / thresholdMs;
          const severity: "warning" | "critical" = overageRatio >= 2 ? "critical" : "warning";

          return {
            declarationId: r.id,
            declarationNumber: r.declarationNumber,
            traderId: r.traderId,
            traderName: r.traderName ?? "Unknown",
            riskLane: lane,
            status: r.status,
            submittedAt: r.submittedAt!.toISOString(),
            portOfEntry: r.portOfEntry ?? null,
            goodsDescription: r.goodsDescription ?? null,
            hoursElapsed,
            slaThresholdHours: thresholdHours,
            overageHours: Math.round((hoursElapsed - thresholdHours) * 10) / 10,
            breachSeverity: severity,
          };
        })
        .filter((b) => input.severity === "all" || b.breachSeverity === input.severity)
        .sort((a, b) => b.hoursElapsed - a.hoursElapsed)
        .slice(0, input.limit);

      return {
        total: breaches.length,
        critical: breaches.filter((b) => b.breachSeverity === "critical").length,
        warning: breaches.filter((b) => b.breachSeverity === "warning").length,
        items: breaches,
        generatedAt: now.toISOString(),
      };
    }),

  // ── SLA STATS ────────────────────────────────────────────────────────────────
  // Summary statistics for the SLA dashboard widget.
  stats: protectedProcedure.query(async ({ ctx }) => {
    if (!isOfficerOrAdmin(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Customs officer or admin role required" });
    }

    const { getDb } = await import("../db");
    const { declarations } = await import("../../drizzle/schema");
    const { and, inArray, isNotNull, sql, count: countFn } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { totalInProcessing: 0, totalBreaches: 0, criticalBreaches: 0, warningBreaches: 0, byLane: { green: { total: 0, breached: 0 }, yellow: { total: 0, breached: 0 }, red: { total: 0, breached: 0 }, blue: { total: 0, breached: 0 } }, generatedAt: new Date().toISOString() };

    const now = new Date();
    // Use only status values that exist in the declaration_status DB enum
    const processingStatuses = ["submitted", "under_assessment", "docs_required", "payment_pending", "under_examination"];

    const rows = await db
      .select({
        riskLane: declarations.riskLane,
        submittedAt: declarations.submittedAt,
      })
      .from(declarations)
      .where(
        and(
          inArray(declarations.status, processingStatuses as any[]),
          isNotNull(declarations.submittedAt)
        )
      );

    let totalBreaches = 0;
    let criticalBreaches = 0;
    const byLane: Record<string, { total: number; breached: number }> = {
      green: { total: 0, breached: 0 },
      yellow: { total: 0, breached: 0 },
      red: { total: 0, breached: 0 },
      blue: { total: 0, breached: 0 },
    };

    for (const row of rows) {
      const lane = row.riskLane ?? "green";
      if (!byLane[lane]) byLane[lane] = { total: 0, breached: 0 };
      byLane[lane].total++;

      if (!row.submittedAt) continue;
      const thresholdMs = SLA_THRESHOLDS_MS[lane] ?? SLA_THRESHOLDS_MS.green;
      const elapsed = now.getTime() - new Date(row.submittedAt).getTime();

      if (elapsed > thresholdMs) {
        byLane[lane].breached++;
        totalBreaches++;
        if (elapsed > thresholdMs * 2) criticalBreaches++;
      }
    }

    return {
      totalInProcessing: rows.length,
      totalBreaches,
      criticalBreaches,
      warningBreaches: totalBreaches - criticalBreaches,
      byLane,
      generatedAt: now.toISOString(),
    };
  }),

  // ── TRADER: MY DECLARATIONS AT SLA RISK ─────────────────────────────────────
  // Returns the calling trader's in-processing declarations with SLA urgency info.
  // Urgency: "critical" = already breached, "warning" = >75% of SLA elapsed, "ok" = safe.
  getMyAtRisk: protectedProcedure.query(async ({ ctx }) => {
    const { getDb } = await import("../db");
    const { declarations } = await import("../../drizzle/schema");
    const { and, eq, inArray, isNotNull } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { declarations: [], critical: 0, warning: 0, ok: 0, generatedAt: new Date().toISOString() };
    const processingStatuses = ["submitted", "under_assessment", "docs_required", "payment_pending", "under_examination"];
    const rows = await db
      .select({
        id: declarations.id,
        declarationNumber: declarations.declarationNumber,
        riskLane: declarations.riskLane,
        status: declarations.status,
        submittedAt: declarations.submittedAt,
        goodsDescription: declarations.goodsDescription,
        portOfEntry: declarations.portOfEntry,
      })
      .from(declarations)
      .where(
        and(
          eq(declarations.traderId, ctx.user.id),
          inArray(declarations.status, processingStatuses as any[]),
          isNotNull(declarations.submittedAt)
        )
      );
    const now = Date.now();
    const results = rows.map((r) => {
      const lane = r.riskLane ?? "green";
      const thresholdMs = SLA_THRESHOLDS_MS[lane] ?? SLA_THRESHOLDS_MS.green;
      const elapsedMs = now - new Date(r.submittedAt!).getTime();
      const remainingMs = thresholdMs - elapsedMs;
      const pctElapsed = Math.min(100, (elapsedMs / thresholdMs) * 100);
      let urgency: "critical" | "warning" | "ok";
      if (elapsedMs >= thresholdMs) urgency = "critical";
      else if (pctElapsed >= 75) urgency = "warning";
      else urgency = "ok";
      return {
        id: r.id,
        declarationNumber: r.declarationNumber,
        riskLane: lane,
        status: r.status,
        goodsDescription: r.goodsDescription ?? "",
        portOfEntry: r.portOfEntry ?? "",
        submittedAt: r.submittedAt!.toISOString(),
        slaLabel: SLA_LABELS[lane] ?? "4 hours",
        thresholdMs,
        elapsedMs,
        remainingMs,
        pctElapsed: Math.round(pctElapsed),
        urgency,
      };
    }).sort((a, b) => b.pctElapsed - a.pctElapsed);
    return {
      declarations: results,
      critical: results.filter((r) => r.urgency === "critical").length,
      warning: results.filter((r) => r.urgency === "warning").length,
      ok: results.filter((r) => r.urgency === "ok").length,
      generatedAt: new Date().toISOString(),
    };
  }),
});
