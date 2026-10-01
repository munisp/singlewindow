import "dotenv/config";
// Phase-7 OTel: start the SDK BEFORE any instrumented module (express, pg,
// ioredis, kafkajs, undici) is loaded. No-op unless OTEL_EXPORTER_OTLP_ENDPOINT
// is set — telemetry is fail-open and must never break boot (OTEL_DESIGN.md §1).
import "./telemetryBootstrap";
// Override DATABASE_URL: use LOCAL_DATABASE_URL if set, otherwise keep injected URL only
// if it is a PostgreSQL URL; otherwise fall back to the default local postgres connection.
const _injectedDbUrl = process.env.DATABASE_URL ?? "";
// SW-S11-4: no hardcoded credential fallback in production — a boot with no
// configured database URL must fail closed, never silently connect with a
// source-controlled password. The localhost default is development-only.
if (!_injectedDbUrl.startsWith("postgresql://") && !_injectedDbUrl.startsWith("postgres://")) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[security] DATABASE_URL is not a PostgreSQL URL in production — refusing to boot (fail-closed)."
    );
  }
  const _localDbUrl = process.env.LOCAL_DATABASE_URL ?? "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway";
  process.env.DATABASE_URL = _localDbUrl;
}
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOpenApiRoute } from "../openapi";
import { metricsRegistry } from "./metrics";
import { registerHealthRoutes } from "../routes/health";
import { parseCspOrigins } from "./csp";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import cron from "node-cron";
import rateLimit from "express-rate-limit";
import { ddosSlowDown, financialRateLimit, adminOperationRateLimit, fileUploadGuard, scheduledJobAuth } from "./security";
import helmet from "helmet";
import cors from "cors";
import { sanitizeMiddleware } from "./sanitize";
import { closeKafka } from "./kafka";
import { setupWebSocketServer, broadcastVesselUpdate } from "./wsServer";
import { sdk } from "./sdk";
import compression from "compression";
import { PAYMENT_STATUS } from "./statuses";

// ── Rate limiting ─────────────────────────────────────────────────────────────
// General tRPC API: 200 requests per minute per IP
const trpcRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down and try again in a minute." },
  skip: (req) => {
    // Skip rate limiting for health checks and static assets.
    // PITFALL: this limiter is mounted via app.use("/api/trpc", trpcRateLimit),
    // so req.path is mount-relative; the full "/api/..." path never matches.
    return req.path === "/health" || req.path === "/ping";
  },
});

// ── Nightly risk scan cron job ────────────────────────────────────────────────
// Fires at 02:00 UTC every day. Scans declarations with riskScore >= 0.8 in the
// last 24 hours, persists a RiskScanResult record, and sends an owner notification.
async function runNightlyRiskScan() {
  console.log("[Cron] Nightly risk scan starting…");
  try {
    const { getDb } = await import("../db");
    const { declarations, riskScanResults } = await import("../../drizzle/schema");
    const { gte, and, sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) {
      console.warn("[Cron] DB unavailable — skipping nightly risk scan");
      return;
    }
    const since = new Date();
    since.setHours(since.getHours() - 24);
    const highRiskDecls = await db
      .select()
      .from(declarations)
      .where(and(gte(declarations.createdAt, since), sql`${declarations.riskScore} >= 0.8`))
      .orderBy(sql`${declarations.riskScore} desc`)
      .limit(500);
    const flaggedIds = highRiskDecls.map((d) => d.id);
    const [scanResult] = await db
      .insert(riskScanResults)
      .values({
        totalDeclarationsScanned: highRiskDecls.length,
        highRiskCount: highRiskDecls.length,
        newCasesCreated: 0,
        thresholdUsed: 0.8,
        scanPeriodHours: 24,
        flaggedDeclarationIds: flaggedIds,
        notificationSent: false,
        runBy: null,
      })
      .returning();
    let notificationSent = false;
    if (highRiskDecls.length > 0) {
      try {
        const { notifyOwner } = await import("./notification");
        const topDecls = highRiskDecls
          .slice(0, 5)
          .map(
            (d) =>
              `  • ${d.declarationNumber} — risk ${Number(d.riskScore).toFixed(2)} (${d.riskLane ?? "unknown"} lane)`
          )
          .join("\n");
        notificationSent = await notifyOwner({
          title: `[Nightly Scan] ${highRiskDecls.length} high-risk declaration${highRiskDecls.length !== 1 ? "s" : ""} detected`,
          content: [
            `Nightly risk scan completed at ${new Date().toUTCString()}.`,
            `High-risk declarations (last 24h, threshold ≥ 0.8): ${highRiskDecls.length}`,
            ``,
            `Top flagged:\n${topDecls}`,
          ].join("\n"),
        });
      } catch {
        // Notification failure is non-fatal
      }
    }
    if (notificationSent && scanResult) {
      const { eq } = await import("drizzle-orm");
      await db
        .update(riskScanResults)
        .set({ notificationSent: true })
        .where(eq(riskScanResults.id, scanResult.id));
    }
    console.log(
      `[Cron] Nightly risk scan complete — ${highRiskDecls.length} high-risk declarations found, notification sent: ${notificationSent}`
    );
  } catch (err) {
    console.error("[Cron] Nightly risk scan failed:", err);
  }
}

// Permit expiry check — runs alongside the nightly risk scan
async function runPermitExpiryCheck() {
  console.log("[Cron] Permit expiry check starting…");
  try {
    const { getDb } = await import("../db");
    const { ogaPermits } = await import("../../drizzle/schema");
    const { lte, gte, and, eq, asc } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) {
      console.warn("[Cron] DB unavailable — skipping permit expiry check");
      return;
    }
    const now = new Date();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 30);
    const expiringPermits = await db
      .select()
      .from(ogaPermits)
      .where(and(gte(ogaPermits.expiresAt, now), lte(ogaPermits.expiresAt, cutoff), eq(ogaPermits.status, "approved")))
      .orderBy(asc(ogaPermits.expiresAt))
      .limit(200);
    if (expiringPermits.length === 0) {
      console.log("[Cron] Permit expiry check complete — no permits expiring within 30 days");
      return;
    }
    try {
      const { notifyOwner } = await import("./notification");
      const lines = expiringPermits.slice(0, 10).map((p) => {
        const daysLeft = Math.ceil((new Date(p.expiresAt!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return `  • Permit ${p.permitNumber ?? p.id} (${p.permitType ?? "general"}) — expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} (Declaration ID: ${p.declarationId})`;
      }).join("\n");
      await notifyOwner({
        title: `Permit Expiry Alert: ${expiringPermits.length} permit${expiringPermits.length !== 1 ? "s" : ""} expiring within 30 days`,
        content: [
          `Permit expiry check completed at ${now.toUTCString()}.`,
          `Permits expiring within 30 days: ${expiringPermits.length}`,
          ``,
          `Top expiring permits:`,
          lines,
          ``,
          `Action required: Contact affected traders to renew their permits before expiry.`,
        ].join("\n"),
      });
    } catch {
      // Non-fatal
    }
    console.log(`[Cron] Permit expiry check complete — ${expiringPermits.length} permits expiring within 30 days`);
  } catch (err) {
    console.error("[Cron] Permit expiry check failed:", err);
  }
}

// SLA breach scan — runs alongside nightly jobs, notifies traders of breached SLAs
async function runSLABreachScan() {
  console.log("[Cron] SLA breach scan starting…");
  try {
    const { getDb } = await import("../db");
    const { declarations } = await import("../../drizzle/schema");
    const { and, inArray, isNotNull } = await import("drizzle-orm");
    const { createUserNotification } = await import("../db");
    const db = await getDb();
    if (!db) {
      console.warn("[Cron] DB unavailable — skipping SLA breach scan");
      return;
    }

    const SLA_MS: Record<string, number> = {
      green: 4 * 60 * 60 * 1000,
      yellow: 24 * 60 * 60 * 1000,
      red: 72 * 60 * 60 * 1000,
      blue: 48 * 60 * 60 * 1000,
    };
    const SLA_LABELS: Record<string, string> = {
      green: "4 hours", yellow: "24 hours", red: "72 hours", blue: "48 hours",
    };

    const now = new Date();
    const processingStatuses = ["submitted", "under_assessment", "docs_required", "payment_pending", "payment_confirmed", "under_examination"];
    const rows = await db
      .select()
      .from(declarations)
      .where(and(inArray(declarations.status, processingStatuses as any[]), isNotNull(declarations.submittedAt)))
      .limit(500);

    let notified = 0;
    let critical = 0;
    for (const decl of rows) {
      if (!decl.submittedAt) continue;
      const lane = decl.riskLane ?? "green";
      const thresholdMs = SLA_MS[lane] ?? SLA_MS.green;
      const elapsed = now.getTime() - new Date(decl.submittedAt).getTime();
      if (elapsed > thresholdMs) {
        const hoursElapsed = Math.round(elapsed / (60 * 60 * 1000) * 10) / 10;
        if (elapsed > thresholdMs * 2) critical++;
        try {
          await createUserNotification({
            userId: decl.traderId,
            type: "sla_breach",
            title: `SLA Breach: Declaration ${decl.declarationNumber}`,
            body: `Your ${lane}-lane declaration (${decl.declarationNumber}) has been in "${decl.status}" status for ${hoursElapsed} hours, exceeding the ${SLA_LABELS[lane] ?? "SLA"} target. Our team has been notified.`,
            declarationId: decl.id,
          });
          notified++;
        } catch { /* non-fatal */ }
      }
    }

    if (critical > 0) {
      try {
        const { notifyOwner } = await import("./notification");
        await notifyOwner({
          title: `[Nightly SLA Scan] ${critical} critical breach${critical !== 1 ? "es" : ""} detected`,
          content: `SLA breach scan at ${now.toUTCString()}. Total breaches: ${notified} (${critical} critical). Trader notifications sent: ${notified}.`,
        });
      } catch { /* non-fatal */ }
    }
    console.log(`[Cron] SLA breach scan complete — ${notified} notifications sent (${critical} critical)`);
  } catch (err) {
    console.error("[Cron] SLA breach scan failed:", err);
  }
}

async function runAmendmentSLACheck() {
  console.log("[Cron] Amendment SLA check starting…");
  try {
    const { getPool } = await import("../db");
    const pool = getPool();
    if (!pool) {
      console.warn("[Cron] Amendment SLA check: DB unavailable");
      return;
    }
    const { rows } = await pool.query(`
      SELECT
        da.id,
        da.declaration_id,
        da.field,
        da.proposed_value,
        da.created_at,
        EXTRACT(EPOCH FROM (NOW() - da.created_at)) / 86400 AS age_days,
        u.name AS requester_name
      FROM declaration_amendments da
      LEFT JOIN users u ON u.id = da.requested_by_id
      WHERE da.status = 'pending'
        AND da.created_at < NOW() - INTERVAL '7 days'
      ORDER BY da.created_at ASC
      LIMIT 100
    `);
    if (!rows.length) {
      console.log("[Cron] Amendment SLA: no overdue pending amendments");
      return;
    }
    const lines = rows.map((r: any) =>
      `  • Amendment #${r.id} on Declaration #${r.declaration_id} — field: ${r.field}, ` +
      `requested by ${r.requester_name ?? 'unknown'}, ` +
      `${parseFloat(r.age_days).toFixed(1)} days old`
    ).join("\n");
    try {
      const { notifyOwner } = await import("./notification");
      await notifyOwner({
        title: `⚠️ ${rows.length} Amendment Request(s) Overdue (>5 business days)`,
        content: `The following amendment requests have exceeded the 5-business-day SLA and require immediate review:\n\n${lines}\n\nPlease log in to AdminDeclarations > Pending Amendments to action these.`,
      });
    } catch { /* non-fatal */ }
    console.log(`[Cron] Amendment SLA: ${rows.length} overdue amendment(s) flagged`);
  } catch (err) {
    console.error("[Cron] Amendment SLA check failed:", err);
  }
}


// ── CEP Suppression Log Retention ─────────────────────────────────────────────────────────────
// Runs nightly as part of runNightlyJobs().
// Prunes cep_suppression_log entries older than the configured retention window (default 90 days).
async function runSuppressionLogRetention() {
  try {
    const { getPool } = await import("../db");
    const pool = getPool();
    if (!pool) {
      console.warn("[Cron] Suppression log retention: DB unavailable");
      return;
    }
    // Read retention days from site_settings (key: cep_suppression_log_retention_days), default 90
    let retentionDays = 90;
    try {
      const { rows: setting } = await pool.query<{ value: string }>(
        `SELECT value FROM site_settings WHERE key = 'cep_suppression_log_retention_days' LIMIT 1`
      );
      if (setting.length > 0) {
        const parsed = parseInt(setting[0].value, 10);
        if (!isNaN(parsed) && parsed > 0) retentionDays = parsed;
      }
    } catch { /* use default */ }

    const { rowCount } = await pool.query(
      `DELETE FROM cep_suppression_log WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [String(retentionDays)]
    );
    const deleted = rowCount ?? 0;
    if (deleted > 0) {
      console.log(`[Cron] Suppression log retention: pruned ${deleted} entries older than ${retentionDays} days`);
    } else {
      console.log(`[Cron] Suppression log retention: no entries to prune (retention: ${retentionDays} days)`);
    }
  } catch (err) {
    console.error("[Cron] Suppression log retention failed:", err);
  }
}

async function runNightlyJobs() {
  await runNightlyRiskScan();
  await runPermitExpiryCheck();
  await runSLABreachScan();
  await runBondedWarehouseExpiryCheck();
  await runAmendmentSLACheck();
  await runSuppressionLogRetention();
}

// ── Bonded Warehouse Expiry Notification cron ──────────────────────────────────────────────────
// Runs nightly as part of runNightlyJobs().
// Queries bonded_inventory for bonds expiring within 7 days and sends
// owner notifications via notifyOwner(). Uses the isBondExpiringSoon()
// utility exported from bondedWarehouse.ts for consistent expiry logic.
async function runBondedWarehouseExpiryCheck() {
  try {
    const { getPool } = await import("../db");
    const { isBondExpiringSoon } = await import("../routers/bondedWarehouse");
    const pool = getPool();
    if (!pool) {
      console.warn("[Cron] Bonded warehouse expiry check: DB unavailable");
      return;
    }

    // Fetch all active inventory items with bond_expiry_date set
    const { rows } = await pool.query(`
      SELECT
        bi.id,
        bi.ucr,
        bi.description AS goods_description,
        bi.quantity_kg AS quantity,
        'kg' AS unit,
        bi.expiry_date AS bond_expiry_date,
        bw.name AS warehouse_name,
        bw.location AS warehouse_location,
        bw.license_number
      FROM bonded_inventory bi
      JOIN bonded_warehouses bw ON bw.id = bi.warehouse_id
      WHERE bi.status = 'active'
        AND bi.expiry_date IS NOT NULL
      ORDER BY bi.expiry_date ASC
    `);

    if (!rows.length) {
      console.log("[Cron] Bonded warehouse expiry check: no active inventory found");
      return;
    }

    const expiringSoon: typeof rows = [];
    const alreadyExpired: typeof rows = [];
    const now = new Date();

    for (const row of rows) {
      const expiryDate = new Date(row.bond_expiry_date);
      const daysUntilExpiry = Math.ceil(
        (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysUntilExpiry < 0) {
        alreadyExpired.push({ ...row, daysUntilExpiry });
      } else if (isBondExpiringSoon(row.bond_expiry_date, 7)) {
        expiringSoon.push({ ...row, daysUntilExpiry });
      }
    }

    const totalAlerts = expiringSoon.length + alreadyExpired.length;

    if (totalAlerts === 0) {
      console.log("[Cron] Bonded warehouse expiry check: no bonds expiring within 7 days");
      return;
    }

    // Build notification content
    const lines: string[] = [
      `Bonded Warehouse Expiry Report — ${now.toUTCString()}`,
      "",
    ];

    if (alreadyExpired.length > 0) {
      lines.push(`⚠️ ALREADY EXPIRED (${alreadyExpired.length} items):`);
      for (const item of alreadyExpired) {
        const expDate = new Date(item.bond_expiry_date).toLocaleDateString("en-GB");
        lines.push(
          `  • UCR: ${item.ucr} | ${item.goods_description} | ` +
          `${item.quantity} ${item.unit} | Warehouse: ${item.warehouse_name} (${item.warehouse_location}) | ` +
          `Expired: ${expDate} (${Math.abs(item.daysUntilExpiry)} days ago)`
        );
      }
      lines.push("");
    }

    if (expiringSoon.length > 0) {
      lines.push(`⏰ EXPIRING WITHIN 7 DAYS (${expiringSoon.length} items):`);
      for (const item of expiringSoon) {
        const expDate = new Date(item.bond_expiry_date).toLocaleDateString("en-GB");
        lines.push(
          `  • UCR: ${item.ucr} | ${item.goods_description} | ` +
          `${item.quantity} ${item.unit} | Warehouse: ${item.warehouse_name} (${item.warehouse_location}) | ` +
          `Expires: ${expDate} (in ${item.daysUntilExpiry} day${item.daysUntilExpiry === 1 ? "" : "s"})`
        );
      }
      lines.push("");
    }

    lines.push(
      `Action Required: Log into TradeGateway and navigate to Bonded Warehouse Management ` +
      `to renew bonds or initiate ex-bond clearance before expiry to avoid customs penalties.`
    );

    const { notifyOwner: _notifyOwner } = await import("./notification");
    await _notifyOwner({
      title: `🏭 Bonded Warehouse Alert: ${totalAlerts} bond${totalAlerts === 1 ? "" : "s"} expiring soon`,
      content: lines.join("\n"),
    });

    // Write in-app notifications for each flagged bond so mobile/PWA users see them
    try {
      const { createNotification, getUserByOpenId } = await import("../db");
      const { ENV } = await import("./env");
      const env = ENV;
      if (env.bootstrapOwnerOpenId) {
        const owner = await getUserByOpenId(env.bootstrapOwnerOpenId);
        if (owner) {
          const allFlagged = [
            ...alreadyExpired.map((item: any) => ({ ...item, flag: "expired" })),
            ...expiringSoon.map((item: any) => ({ ...item, flag: "expiring_soon" })),
          ];
          for (const item of allFlagged) {
            const daysUntilExpiry = Math.ceil(
              (new Date(item.bond_expiry_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );
            const isExpired = daysUntilExpiry < 0;
            await createNotification({
              userId: owner.id,
              type: "permit_expiry_warning",
              title: isExpired
                ? `Bond Expired: ${item.ucr} (${Math.abs(daysUntilExpiry)}d overdue)`
                : `Bond Expiring Soon: ${item.ucr} (${daysUntilExpiry}d left)`,
              message: `${item.goods_description} — ${item.quantity} ${item.unit} at ${item.warehouse_name} (${item.warehouse_location}). ` +
                (isExpired
                  ? `Bond expired ${Math.abs(daysUntilExpiry)} day${Math.abs(daysUntilExpiry) === 1 ? "" : "s"} ago. Immediate action required.`
                  : `Bond expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}. Initiate ex-bond clearance or renewal.`),
              entityType: "bonded_inventory",
              entityId: item.id,
            });
          }
          console.log(`[Cron] Bonded warehouse expiry check: ${allFlagged.length} in-app notification(s) created for owner`);
        }
      }
    } catch (notifErr) {
      console.warn("[Cron] Bonded warehouse expiry check: failed to write in-app notifications:", notifErr);
    }

    console.log(
      `[Cron] Bonded warehouse expiry check complete — ` +
      `${expiringSoon.length} expiring soon, ${alreadyExpired.length} already expired. ` +
      `Owner notification sent.`
    );
  } catch (err) {
    console.error("[Cron] Bonded warehouse expiry check failed:", err);
  }
}

// ── Port congestion critical alert scan ────────────────────────────────────────
// Runs every 15 minutes. Checks the latest congestion status for each active port.
// When a port transitions TO "critical" from a non-critical status, it fires a
// security_alert notification to all admin and customs_officer users.
// Stores the last-notified status in port_congestion_alerts to avoid duplicates.
async function runPortCongestionAlertScan() {
  try {
    const { getDb } = await import("../db");
    const { portLocations, portCongestionEvents, portCongestionAlerts, users } = await import("../../drizzle/schema");
    const { eq, desc, inArray, sql } = await import("drizzle-orm");
    const { createUserNotification } = await import("../db");
    const db = await getDb();
    if (!db) return;

    // Get all active ports
    const activePorts = await db
      .select({ portCode: portLocations.portCode, portName: portLocations.portName })
      .from(portLocations)
      .where(eq(portLocations.isActive, true));

    if (!activePorts.length) return;

    // Get the latest congestion event per port using a subquery
    const latestEvents = await db
      .select()
      .from(portCongestionEvents)
      .where(
        inArray(
          portCongestionEvents.portCode,
          activePorts.map((p) => p.portCode)
        )
      )
      .orderBy(desc(portCongestionEvents.recordedAt))
      .limit(activePorts.length * 3); // fetch recent events, we'll pick latest per port

    // Build map: portCode -> latest event (SW-O4: demo-seeded rows NEVER alert)
    const latestByPort = new Map<string, typeof latestEvents[0]>();
    for (const ev of latestEvents) {
      if ((ev as { source?: string }).source === "demo") continue;
      if (!latestByPort.has(ev.portCode)) latestByPort.set(ev.portCode, ev);
    }

    // Get existing alert tracking rows
    const alertRows = await db.select().from(portCongestionAlerts);
    const alertMap = new Map(alertRows.map((r) => [r.portCode, r]));

    // Get all admin + customs_officer user IDs to notify
    const staffUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.role, ["admin", "customs_officer"]));
    const staffIds = staffUsers.map((u) => u.id);

    let alertsFired = 0;

    for (const port of activePorts) {
      const latest = latestByPort.get(port.portCode);
      if (!latest) continue;

      const currentStatus = latest.congestionStatus;
      const existingAlert = alertMap.get(port.portCode);
      const lastNotified = existingAlert?.lastNotifiedStatus ?? "clear";

      // Only fire if transitioning TO critical from a non-critical status
      if (currentStatus === "critical" && lastNotified !== "critical") {
        // Notify all staff users
        for (const staffUser of staffIds) {
          try {
            await createUserNotification({
              userId: staffUser.id,
              type: "security_alert",
              title: `Port Congestion CRITICAL: ${port.portName}`,
              body: `Port ${port.portName} (${port.portCode}) has reached CRITICAL congestion status. Vessel count: ${latest.vesselCount ?? "N/A"}, wait time: ${latest.waitTimeHours ?? 0}h, declaration backlog: ${latest.declarationBacklog ?? 0}. Immediate action may be required.`,
            });
          } catch { /* non-fatal */ }
        }

        // Also notify the owner
        try {
          const { notifyOwner } = await import("./notification");
          await notifyOwner({
            title: `[Port Alert] ${port.portName} reached CRITICAL congestion`,
            content: `Port ${port.portCode} transitioned to CRITICAL at ${new Date().toUTCString()}. Vessel count: ${latest.vesselCount}, wait time: ${latest.waitTimeHours}h, backlog: ${latest.declarationBacklog} declarations.`,
          });
        } catch { /* non-fatal */ }

        alertsFired++;
      }

      // Upsert the alert tracking row
      if (existingAlert) {
        await db
          .update(portCongestionAlerts)
          .set({ lastNotifiedStatus: currentStatus, lastAlertSentAt: currentStatus === "critical" && lastNotified !== "critical" ? new Date() : existingAlert.lastAlertSentAt, updatedAt: new Date() })
          .where(eq(portCongestionAlerts.portCode, port.portCode));
      } else {
        await db.insert(portCongestionAlerts).values({
          portCode: port.portCode,
          lastNotifiedStatus: currentStatus,
          lastAlertSentAt: currentStatus === "critical" ? new Date() : null,
          updatedAt: new Date(),
        });
      }
    }

    if (alertsFired > 0) {
      console.log(`[Cron] Port congestion scan — ${alertsFired} CRITICAL alert(s) fired`);
    }
  } catch (err) {
    console.error("[Cron] Port congestion alert scan failed:", err);
  }
}

// ── Notification digest sender ─────────────────────────────────────────────────
// Runs daily at 08:00 UTC. Sends a batched digest of unread notifications to users
// who have opted into daily or weekly digests.
async function runNotificationDigest(mode: "daily" | "weekly") {
  try {
    const { getDb } = await import("../db");
    const { notificationDigestSettings, userNotifications, users } = await import("../../drizzle/schema");
    const { eq, and, isNull } = await import("drizzle-orm");
    const { notifyOwner } = await import("./notification");
    const db = await getDb();
    if (!db) return;

    const digestRows = await db
      .select()
      .from(notificationDigestSettings)
      .where(eq(notificationDigestSettings.digestFrequency, mode));

    let sent = 0;
    for (const setting of digestRows) {
      // Get unread notifications since last digest
      const since = setting.lastDigestSentAt ?? new Date(0);
      const unread = await db
        .select()
        .from(userNotifications)
        .where(
          and(
            eq(userNotifications.userId, setting.userId),
            eq(userNotifications.isRead, false)
          )
        )
        .limit(50);

      if (!unread.length) continue;

      // Get user info
      const userRows = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, setting.userId)).limit(1);
      const userName = userRows[0]?.name ?? `User #${setting.userId}`;

      const summary = unread
        .slice(0, 10)
        .map((n) => `• ${n.title}: ${n.body?.slice(0, 80) ?? ""}${(n.body?.length ?? 0) > 80 ? "…" : ""}`)
        .join("\n");
      const extra = unread.length > 10 ? `\n…and ${unread.length - 10} more unread notification(s).` : "";

      try {
        await notifyOwner({
          title: `[${mode === "daily" ? "Daily" : "Weekly"} Digest] ${unread.length} unread notification(s) for ${userName}`,
          content: `${userName} has ${unread.length} unread notification(s):\n\n${summary}${extra}\n\nLog in to TradeGateway to view and manage your notifications.`,
        });
        // Update lastDigestSentAt
        await db
          .update(notificationDigestSettings)
          .set({ lastDigestSentAt: new Date(), updatedAt: new Date() })
          .where(eq(notificationDigestSettings.userId, setting.userId));
        sent++;
      } catch { /* non-fatal */ }
    }

    if (sent > 0) console.log(`[Cron] ${mode} digest sent to ${sent} user(s)`);
  } catch (err) {
    console.error(`[Cron] Notification digest (${mode}) failed:`, err);
  }
}


// ── CEP Daily Breach Digest ───────────────────────────────────────────────────────────────────
// Runs daily at 08:00 UTC. Sends a single consolidated owner notification listing all CEP
// patterns that breached their daily_alert_threshold at least once in the past 24 hours.
// Complements the 30-min per-pattern alerts by providing a morning summary.
async function runDailyBreachDigest() {
  try {
    // Check opt-out setting before running
    const { getPool } = await import("../db");
    const pool = getPool();
    if (!pool) return;
    const { rows: settingRows } = await pool.query<{ value: string }>(
      `SELECT value FROM site_settings WHERE key = 'cep_daily_breach_digest_enabled' LIMIT 1`
    );
    const digestEnabled = settingRows[0]?.value ?? "true";
    if (digestEnabled === "false") {
      console.log("[Cron] Daily breach digest: disabled via site setting — skipping");
      return;
    }
    const { rows } = await pool.query<{
      pattern_id: string;
      pattern_name: string;
      daily_alert_threshold: number;
      today_count: string;
    }>(
      `SELECT
         cp.pattern_id,
         cp.pattern_name,
         cp.daily_alert_threshold,
         COUNT(ca.id)::text AS today_count
       FROM cep_patterns cp
       LEFT JOIN cep_alerts ca
         ON ca.pattern_id = cp.pattern_id
         AND ca.detected_at >= NOW() - INTERVAL '24 hours'
       WHERE cp.daily_alert_threshold IS NOT NULL
         AND cp.is_active = true
       GROUP BY cp.pattern_id, cp.pattern_name, cp.daily_alert_threshold
       HAVING COUNT(ca.id) > cp.daily_alert_threshold
       ORDER BY COUNT(ca.id) DESC`
    );
    if (rows.length === 0) {
      console.log("[Cron] Daily breach digest: no patterns in breach — skipping notification");
      return;
    }
    const lines = rows.map((r) =>
      `  • ${r.pattern_name}: ${r.today_count} alerts (threshold: ${r.daily_alert_threshold})`
    ).join("\n");
    const { notifyOwner } = await import("./notification");
    await notifyOwner({
      title: `[Daily Digest] ${rows.length} CEP Pattern${rows.length !== 1 ? "s" : ""} Breached Threshold in Last 24h`,
      content: [
        `Daily CEP breach summary — ${new Date().toUTCString()}`,
        "",
        `The following ${rows.length} pattern${rows.length !== 1 ? "s" : ""} exceeded their configured daily alert threshold in the past 24 hours:`,
        "",
        lines,
        "",
        "Review the CEP Alerts dashboard and consider adjusting thresholds or suppressing noisy patterns.",
      ].join("\n"),
    }).catch(() => {});
    console.log(`[Cron] Daily breach digest sent — ${rows.length} pattern${rows.length !== 1 ? "s" : ""} in breach`);
  } catch (err) {
    console.error("[Cron] Daily breach digest failed:", err);
  }
}

// Schedule: second(0) minute(0) hour(2) day(*) month(*) weekday(*) = 02:00 UTC daily
cron.schedule("0 0 2 * * *", runNightlyJobs, { timezone: "UTC" });
console.log("[Cron] Nightly jobs scheduled at 02:00 UTC daily (risk scan + permit expiry check + SLA breach scan)");

// Port congestion alert scan — every 15 minutes
cron.schedule("0 */15 * * * *", runPortCongestionAlertScan, { timezone: "UTC" });
console.log("[Cron] Port congestion alert scan scheduled every 15 minutes");

// Daily digest — every day at 08:00 UTC
cron.schedule("0 0 8 * * *", () => runNotificationDigest("daily"), { timezone: "UTC" });
console.log("[Cron] Daily notification digest scheduled at 08:00 UTC");
// CEP daily breach digest — every day at 08:05 UTC (5 min after daily digest)
cron.schedule("0 5 8 * * *", runDailyBreachDigest, { timezone: "UTC" });
console.log("[Cron] CEP daily breach digest scheduled at 08:05 UTC");
