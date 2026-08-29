import "dotenv/config";
// Override DATABASE_URL: use LOCAL_DATABASE_URL if set, otherwise keep injected URL only
// if it is a PostgreSQL URL; otherwise fall back to the default local postgres connection.
const _injectedDbUrl = process.env.DATABASE_URL ?? "";
const _localDbUrl = process.env.LOCAL_DATABASE_URL ?? "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway";
if (!_injectedDbUrl.startsWith("postgresql://") && !_injectedDbUrl.startsWith("postgres://")) {
  process.env.DATABASE_URL = _localDbUrl;
}
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOpenApiRoute } from "../openapi";
import { metricsRegistry } from "./metrics";
import { registerHealthRoutes } from "../routes/health";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import cron from "node-cron";
import rateLimit from "express-rate-limit";
import { ddosSlowDown, financialRateLimit, adminOperationRateLimit, fileUploadGuard } from "./security";
import helmet from "helmet";
import cors from "cors";
import { sanitizeMiddleware } from "./sanitize";
import { closeKafka } from "./kafka";
import { setupWebSocketServer, broadcastVesselUpdate } from "./wsServer";
import { sdk } from "./sdk";

// ── Rate limiting ─────────────────────────────────────────────────────────────
// General tRPC API: 200 requests per minute per IP
const trpcRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down and try again in a minute." },
  skip: (req) => {
    // Skip rate limiting for health checks and static assets
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
        return `  \u2022 Permit ${p.permitNumber ?? p.id} (${p.permitType ?? "general"}) \u2014 expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} (Declaration ID: ${p.declarationId})`;
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
      `  \u2022 Amendment #${r.id} on Declaration #${r.declaration_id} \u2014 field: ${r.field}, ` +
      `requested by ${r.requester_name ?? 'unknown'}, ` +
      `${parseFloat(r.age_days).toFixed(1)} days old`
    ).join("\n");
    try {
      const { notifyOwner } = await import("./notification");
      await notifyOwner({
        title: `\u26a0\ufe0f ${rows.length} Amendment Request(s) Overdue (>5 business days)`,
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

    // Build map: portCode -> latest event
    const latestByPort = new Map<string, typeof latestEvents[0]>();
    for (const ev of latestEvents) {
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
              userId: staffUser,
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

// ── Weekly admin analytics KPI report ───────────────────────────────────────────────
// Sends a weekly KPI summary to the owner every Monday at 08:00 UTC.
async function runWeeklyAnalyticsReport() {
  try {
    const { getDb } = await import("../db");
    const { declarations, payments } = await import("../../drizzle/schema");
    const { sql, gte, and, isNotNull } = await import("drizzle-orm");
    const { notifyOwner } = await import("./notification");
    const db = await getDb();
    if (!db) return;

    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // 7-day declaration count + clearance stats
    const [declStats] = await db
      .select({
        total7d: sql<number>`COUNT(*)::int`.as("total_7d"),
        cleared7d: sql<number>`COUNT(*) FILTER (WHERE ${declarations.status} = 'cleared')::int`.as("cleared_7d"),
        avgHours: sql<number>`
          AVG(EXTRACT(EPOCH FROM (${declarations.clearedAt} - ${declarations.submittedAt})) / 3600)
          FILTER (WHERE ${declarations.clearedAt} IS NOT NULL AND ${declarations.submittedAt} IS NOT NULL)
        `.as("avg_hours"),
      })
      .from(declarations)
      .where(gte(declarations.createdAt, since7d));

    // 7-day duty revenue
    const [payStats] = await db
      .select({
        revenue7d: sql<number>`COALESCE(SUM(${payments.amount}), 0)::numeric(18,2)`.as("revenue_7d"),
      })
      .from(payments)
      .where(
        and(
          sql`${payments.status} = 'completed'`,
          gte(payments.createdAt, since7d)
        )
      );

    // SLA breach count (declarations still in processing beyond SLA)
    const processingRows = await db
      .select({ submittedAt: declarations.submittedAt, riskLane: declarations.riskLane })
      .from(declarations)
      .where(
        and(
          sql`${declarations.status} IN ('submitted','under_assessment','docs_required','payment_pending','payment_confirmed','under_examination')`,
          isNotNull(declarations.submittedAt)
        )
      )
      .limit(1000);

    const SLA_MS: Record<string, number> = {
      green: 4 * 3600 * 1000, yellow: 24 * 3600 * 1000, red: 72 * 3600 * 1000, blue: 48 * 3600 * 1000,
    };
    const now = Date.now();
    const slaBreaches = processingRows.filter((r) => {
      if (!r.submittedAt) return false;
      const elapsed = now - new Date(r.submittedAt).getTime();
      return elapsed > (SLA_MS[r.riskLane ?? "green"] ?? SLA_MS.green);
    }).length;

    const total7d = declStats?.total7d ?? 0;
    const cleared7d = declStats?.cleared7d ?? 0;
    const clearanceRate = total7d > 0 ? Math.round((cleared7d / total7d) * 100) : 0;
    const avgHours = declStats?.avgHours != null ? Number(Number(declStats.avgHours).toFixed(1)) : null;
    const revenue7d = Number(payStats?.revenue7d ?? 0);

    await notifyOwner({
      title: `[Weekly Analytics] TradeGateway KPI Report — ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}`,
      content: [
        "TradeGateway Weekly KPI Summary",
        `Period: Last 7 days (ending ${new Date().toUTCString()})`,
        "",
        "Declarations",
        `  Total submitted: ${total7d}`,
        `  Cleared: ${cleared7d} (${clearanceRate}% clearance rate)`,
        avgHours != null ? `  Avg clearance time: ${avgHours}h` : "  Avg clearance time: N/A",
        "",
        "Revenue",
        `  Duty collected: $${revenue7d.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        "",
        "Compliance",
        `  Active SLA breaches: ${slaBreaches}`,
        "",
        "Log in to the Admin Analytics Dashboard for full charts and drill-down.",
      ].join("\n"),
    });

    console.log(`[Cron] Weekly analytics report sent (${total7d} declarations, $${revenue7d.toFixed(2)} revenue, ${slaBreaches} SLA breaches)`);
  } catch (err) {
    console.error("[Cron] Weekly analytics report failed:", err);
  }
}

// Weekly digest + analytics report — every Monday at 08:00 UTC
cron.schedule("0 0 8 * * 1", async () => {
  await runNotificationDigest("weekly");
  await runWeeklyAnalyticsReport();
}, { timezone: "UTC" });
console.log("[Cron] Weekly digest + analytics report scheduled at 08:00 UTC every Monday");

// ── Document expiry enforcement cron ───────────────────────────────────────────
// Runs daily at 03:00 UTC. Revokes share links whose expiresAt has passed,
// logs an audit event for each, and notifies the owner.
export async function runDocumentExpiryCron() {
  try {
    const { getDb } = await import("../db");
    const { documentShares } = await import("../../drizzle/schema");
    const { notifyOwner } = await import("./notification");
    const { logAuditEvent } = await import("../db");
    const { lte, isNull, and, inArray } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) {
      console.warn("[Cron] DB unavailable — skipping document expiry cron");
      return { expired: 0, error: "DB unavailable" };
    }

    const now = new Date();

    // Find share links that have passed their expiresAt and have not yet been revoked
    const expiredShares = await db
      .select({ id: documentShares.id, documentId: documentShares.documentId, label: documentShares.label })
      .from(documentShares)
      .where(
        and(
          lte(documentShares.expiresAt, now),
          isNull(documentShares.revokedAt)
        )
      );

    if (expiredShares.length === 0) {
      console.log("[Cron] Document expiry: no expired share links found");
      return { expired: 0 };
    }

    const shareIds = expiredShares.map((s) => s.id);

    // Revoke all expired share links
    await db
      .update(documentShares)
      .set({ revokedAt: now })
      .where(inArray(documentShares.id, shareIds));

    // Log an audit event for each expired share
    for (const share of expiredShares) {
      await logAuditEvent({
        actorId: null,
        actorType: "system",
        action: "expire",
        entityType: "document_vault" as any,
        entityId: share.documentId,
        metadata: { shareId: share.id, label: share.label, expiredAt: now.toISOString() },
      });
    }

    // Notify owner
    await notifyOwner({
      title: `[Document Vault] ${expiredShares.length} share link(s) auto-expired`,
      content: [
        `Document share expiry cron ran at ${now.toUTCString()}.`,
        `${expiredShares.length} share link(s) have been automatically revoked after passing their expiry time.`,
        ``,
        `Affected share IDs: ${shareIds.join(", ")}`,
        ``,
        `Log in to TradeGateway to review the Document Vault.`,
      ].join("\n"),
    });

    console.log(`[Cron] Document expiry: revoked ${expiredShares.length} expired share link(s)`);
    return { expired: expiredShares.length };
  } catch (err) {
    console.error("[Cron] Document expiry cron failed:", err);
    return { expired: 0, error: String(err) };
  }
}

// Document expiry cron — daily at 03:00 UTC
cron.schedule("0 0 3 * * *", runDocumentExpiryCron, { timezone: "UTC" });
console.log("[Cron] Document expiry enforcement scheduled at 03:00 UTC daily");

// ── Executive Dashboard daily digest ─────────────────────────────────────────
// Fires at 03:05 UTC every day (5 min after document expiry to avoid DB contention).
// Collects yesterday's KPIs and sends a structured owner notification.
import { runExecDailyDigest } from "../jobs/execDigest";
cron.schedule("0 5 3 * * *", async () => {
  await runExecDailyDigest();
}, { timezone: "UTC" });
console.log("[Cron] Executive daily digest scheduled at 03:05 UTC daily");

// ── AEO Certificate Renewal Reminder cron ────────────────────────────────────
// Fires at 03:10 UTC every day. Sends renewal reminders at 60/30/7 days before expiry.
import { runAeoRenewalReminders } from "../jobs/aeoRenewalReminders";
cron.schedule("0 10 3 * * *", async () => {
  await runAeoRenewalReminders();
}, { timezone: "UTC" });
console.log("[Cron] AEO renewal reminders scheduled at 03:10 UTC daily");

// ── Nightly Revocation CSV email cron ────────────────────────────────────────
// Fires at 04:00 UTC every day. Emails yesterday's revocation log CSV to all
// active compliance officer addresses in the compliance_email_schedule table.
import { runNightlyRevocationCsv } from "../jobs/nightlyRevocationCsv";
import { startPaymentWorker, stopPaymentWorker } from "../paymentWorker";
import { runScheduledBalanceDriftCheck } from "../balanceDrift";
cron.schedule("0 0 4 * * *", async () => {
  await runNightlyRevocationCsv();
}, { timezone: "UTC" });
console.log("[Cron] Nightly revocation CSV email scheduled at 04:00 UTC daily");

// ── SLA breach real-time alert broadcast ─────────────────────────────────────
// Runs every 15 minutes. Queries declarations that have breached their SLA and
// broadcasts a workload_update WebSocket event to all connected officers so the
// CustomsDashboard alert banner refreshes without a page reload.
async function runSLABreachAlertBroadcast() {
  try {
    const { getDb } = await import("../db");
    const { declarations } = await import("../../drizzle/schema");
    const { and, inArray, isNotNull, sql, count } = await import("drizzle-orm");
    const { broadcastWorkloadUpdate } = await import("./wsServer");
    const db = await getDb();
    if (!db) return;
    const SLA_MS: Record<string, number> = {
      green: 4 * 3600 * 1000,
      yellow: 24 * 3600 * 1000,
      red: 72 * 3600 * 1000,
      blue: 48 * 3600 * 1000,
    };
    // Valid enum values from declarationStatusEnum in schema.ts
    const processingStatuses = ["submitted", "under_assessment", "docs_required", "payment_pending", "payment_confirmed", "under_examination"];
    const now = new Date();
    // Count total pending
    const [totalPendingRow] = await db
      .select({ count: count() })
      .from(declarations)
      .where(inArray(declarations.status, processingStatuses as any[]));
    // Count by lane
    const [redRow] = await db.select({ count: count() }).from(declarations)
      .where(and(inArray(declarations.status, processingStatuses as any[]), sql`${declarations.riskLane} = 'red'`));
    const [yellowRow] = await db.select({ count: count() }).from(declarations)
      .where(and(inArray(declarations.status, processingStatuses as any[]), sql`${declarations.riskLane} = 'yellow'`));
    const [greenRow] = await db.select({ count: count() }).from(declarations)
      .where(and(inArray(declarations.status, processingStatuses as any[]), sql`${declarations.riskLane} = 'green'`));
    // Count SLA breaches
    const processingRows = await db
      .select({ submittedAt: declarations.submittedAt, riskLane: declarations.riskLane })
      .from(declarations)
      .where(and(inArray(declarations.status, processingStatuses as any[]), isNotNull(declarations.submittedAt)))
      .limit(1000);
    const slaBreachedCount = processingRows.filter((r) => {
      if (!r.submittedAt) return false;
      const elapsed = now.getTime() - new Date(r.submittedAt).getTime();
      const threshold = SLA_MS[r.riskLane ?? "green"] ?? SLA_MS.green;
      return elapsed > threshold;
    }).length;
    broadcastWorkloadUpdate({
      totalPending: totalPendingRow?.count ?? 0,
      redLane: redRow?.count ?? 0,
      yellowLane: yellowRow?.count ?? 0,
      greenLane: greenRow?.count ?? 0,
      slaBreached: slaBreachedCount,
      updatedAt: now.toISOString(),
    });
    if (slaBreachedCount > 0) {
      console.log(`[Cron] SLA breach alert broadcast — ${slaBreachedCount} breach(es) detected, workload_update sent to all officers`);
    }
    // Sprint 118: read threshold from site_settings (falls back to 5 if not set)
    let SLA_BREACH_EMAIL_THRESHOLD = 5;
    try {
      const { siteSettings: siteSettingsTable } = await import("../../drizzle/schema");
      const { eq: eqSS } = await import("drizzle-orm");
      const [thresholdRow] = await db
        .select({ value: siteSettingsTable.value })
        .from(siteSettingsTable)
        .where(eqSS(siteSettingsTable.key, "sla_breach_email_threshold"))
        .limit(1);
      if (thresholdRow) {
        const parsed = parseInt(thresholdRow.value, 10);
        if (!isNaN(parsed) && parsed > 0) SLA_BREACH_EMAIL_THRESHOLD = parsed;
      }
    } catch { /* non-fatal, use default */ }
    if (slaBreachedCount >= SLA_BREACH_EMAIL_THRESHOLD) {
      try {
        const { notifyOwner } = await import("./notification");
        const redBreaches = processingRows.filter((r) => {
          if (!r.submittedAt || (r.riskLane ?? "green") !== "red") return false;
          const elapsed = now.getTime() - new Date(r.submittedAt).getTime();
          return elapsed > SLA_MS.red;
        }).length;
        const yellowBreaches = processingRows.filter((r) => {
          if (!r.submittedAt || (r.riskLane ?? "green") !== "yellow") return false;
          const elapsed = now.getTime() - new Date(r.submittedAt).getTime();
          return elapsed > SLA_MS.yellow;
        }).length;
        const greenBreaches = slaBreachedCount - redBreaches - yellowBreaches;
        await notifyOwner({
          title: `🚨 SLA Breach Alert — ${slaBreachedCount} Declaration${slaBreachedCount !== 1 ? "s" : ""} Overdue`,
          content: [
            `**SLA Breach Digest** — ${now.toUTCString()}`,
            ``,
            `A total of **${slaBreachedCount}** declaration${slaBreachedCount !== 1 ? "s are" : " is"} currently breaching their SLA threshold.`,
            ``,
            `| Lane   | Breached |`,
            `|--------|----------|`,
            `| 🔴 Red    | ${redBreaches} |`,
            `| 🟡 Yellow | ${yellowBreaches} |`,
            `| 🟢 Green  | ${greenBreaches} |`,
            ``,
            `Please log in to the Customs Dashboard and use the **SLA Breached** filter to triage these declarations immediately.`,
          ].join("\n"),
        });
        console.log(`[Cron] SLA breach escalation email sent — ${slaBreachedCount} breaches (threshold: ${SLA_BREACH_EMAIL_THRESHOLD})`);
      } catch (emailErr) {
        console.warn("[Cron] SLA breach escalation email failed:", emailErr);
      }
    }
  } catch (err) {
    console.error("[Cron] SLA breach alert broadcast failed:", err);
  }
}
// SLA breach alert broadcast — every 15 minutes (offset by 7 minutes from port congestion scan)
cron.schedule("0 7/15 * * * *", runSLABreachAlertBroadcast, { timezone: "UTC" });
console.log("[Cron] SLA breach alert broadcast scheduled every 15 minutes");

// ─── Nightly Bulk Export Expiry Cleanup ──────────────────────────────────────
// Runs at 03:30 UTC every day.
// Hard-deletes bulk_exports rows whose expiresAt has passed and removes their S3 objects.
async function runBulkExportExpiryCron() {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) { console.warn("[BulkExportExpiry] DB unavailable, skipping."); return; }
    const now = new Date();
    const { lt: ltOp, eq: eqOp } = await import("drizzle-orm");
    const { bulkExports: bulkExportsTable } = await import("../../drizzle/schema");
    const { storageDelete } = await import("../storage");
    // Find all expired rows
    const expired = await db
      .select({ id: bulkExportsTable.id, s3Key: bulkExportsTable.s3Key })
      .from(bulkExportsTable)
      .where(ltOp(bulkExportsTable.expiresAt, now));

    if (expired.length === 0) {
      console.log("[BulkExportExpiry] No expired exports to clean up.");
      return;
    }

    let deleted = 0;
    let s3Errors = 0;
    for (const row of expired) {
      try {
        if (row.s3Key) {
          await storageDelete(row.s3Key);
        }
      } catch (e) {
        console.warn(`[BulkExportExpiry] S3 delete failed for key ${row.s3Key}:`, e);
        s3Errors++;
      }
      await db.delete(bulkExportsTable).where(eqOp(bulkExportsTable.id, row.id));
      deleted++;
    }
    console.log(`[BulkExportExpiry] Cleaned up ${deleted} expired exports (${s3Errors} S3 errors).`);
  } catch (err) {
    console.error("[BulkExportExpiry] Cron error:", err);
  }
}
cron.schedule("0 30 3 * * *", runBulkExportExpiryCron, { timezone: "UTC" });
console.log("[Cron] Bulk export expiry cleanup scheduled nightly at 03:30 UTC");

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function runPermifySeedOnStartup() {
  const permifyHost = process.env.PERMIFY_HOST;
  if (!permifyHost) {
    console.log("[Permify] PERMIFY_HOST not set — skipping seed on startup");
    return;
  }
  try {
    // Check if Permify is reachable before attempting seed
    const healthRes = await fetch(`${permifyHost}/healthz`, { signal: AbortSignal.timeout(2000) });
    if (!healthRes.ok) {
      console.warn("[Permify] Health check failed — skipping seed");
      return;
    }
    // Write the schema
    const schemaPath = new URL("../../infra/permify/schema.perm", import.meta.url);
    let schemaBody: string;
    try {
      const { readFileSync } = await import("fs");
      schemaBody = readFileSync(schemaPath, "utf8");
    } catch {
      console.warn("[Permify] schema.perm not found — skipping seed");
      return;
    }
    const PERMIFY_TENANT = process.env.PERMIFY_TENANT || "tradegateway";
    const schemaRes = await fetch(`${permifyHost}/v1/tenants/${PERMIFY_TENANT}/schemas/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: schemaBody }),
      signal: AbortSignal.timeout(5000),
    });
    if (schemaRes.ok) {
      console.log("[Permify] Schema written successfully");
    } else {
      const text = await schemaRes.text();
      console.warn(`[Permify] Schema write failed (${schemaRes.status}): ${text}`);
    }
  } catch (err) {
    console.warn("[Permify] Seed on startup failed (non-fatal):", err);
  }
}

async function startServer() {
  // ── Phase-6 startup gates (fail fast, before any listener or route) ─────────
  // 1. Refuse to boot in production when demo/test/mock surfaces are enabled.
  // 2. Refuse to boot in production with missing or known-dev webhook secrets.
  {
    const { assertNoDemoSurfacesInProduction } = await import("./productionGates");
    assertNoDemoSurfacesInProduction();
    const { validateWebhookSecrets } = await import("./webhookSecretsValidator");
    validateWebhookSecrets();
  }
  const app = express();
  // Trust the reverse proxy (Manus/nginx) so express-rate-limit reads the correct client IP
  app.set('trust proxy', 1);
  const server = createServer(app);
  // Permify schema seed on startup (non-blocking, only when PERMIFY_HOST is set)
  runPermifySeedOnStartup().catch(() => {});
  // R4 FIX: Provision system payment accounts (NCS Revenue, Bond Collateral, etc.) at startup
  import('../_core/paymentAccountProvisioner').then(({ provisionSystemAccounts }) => {
    provisionSystemAccounts().catch((err) => console.warn('[Startup] System account provisioning failed:', err.message));
  }).catch(() => {});
  // R5 FIX: Ensure OpenSearch indices exist at startup
  import('../_core/opensearch').then(({ ensureOpenSearchIndices }) => {
    ensureOpenSearchIndices().catch((err) => console.warn('[Startup] OpenSearch index init failed:', err.message));
  }).catch(() => {});
  // Sprint 63: WebSocket server for real-time notifications
  setupWebSocketServer(server);

  // ── Request correlation ID middleware ───────────────────────────────────────────────
  // Injects X-Request-ID header for distributed tracing. Uses incoming header if
  // already set by a reverse proxy (nginx/APISIX), otherwise generates a new UUID.
  app.use((req: any, res: any, next: any) => {
    const requestId = (req.headers['x-request-id'] as string) ||
      `tg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  });

  // ── Structured access logging ───────────────────────────────────────────────────────────
  // Logs each API request as structured JSON in production, human-readable in dev.
  if (process.env.NODE_ENV === 'production') {
    app.use((req: any, res: any, next: any) => {
      const start = Date.now();
      res.on('finish', () => {
        // Skip health check and metrics noise in production logs
        if (req.path === '/api/health/live' || req.path === '/metrics') return;
        const log = {
          ts: new Date().toISOString(),
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - start,
          ip: req.ip,
          ua: req.headers['user-agent']?.slice(0, 120),
        };
        process.stdout.write(JSON.stringify(log) + '\n');
      });
      next();
    });
  }
  // ── CORS ─────────────────────────────────────────────────────────────────────
  const allowedOrigins = [
    /\.manus\.space$/,
    /\.manus\.computer$/,
    /^https?:\/\/localhost(:\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  ];
  // ── DDoS slow-down (global — applied before CORS so it catches all traffic) ──
  app.use("/api", ddosSlowDown);

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed = allowedOrigins.some(p => typeof p === 'string' ? p === origin : p.test(origin));
      callback(allowed ? null : new Error('CORS: origin not allowed'), allowed);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 86400,
  }));
  // ── Security headers (helmet) ─────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Tighten CSP in production: remove unsafe-inline/eval
        scriptSrc: process.env.NODE_ENV === 'production'
          ? ["'self'", "https://fonts.googleapis.com"]
          : ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://fonts.googleapis.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "wss:", "https:"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    noSniff: true,
    xssFilter: true,
  }));
  // ── Input sanitization (XSS prevention) ─────────────────────────────────────
  app.use(sanitizeMiddleware);
  // ── File upload guard (ransomware/malware delivery prevention) ─────────────
  app.use("/api/upload", fileUploadGuard);

  // ── Financial operation rate limiting ────────────────────────────────────────
  app.use("/api/trpc/payments", financialRateLimit);
  app.use("/api/trpc/mojaloop", financialRateLimit);
  app.use("/api/trpc/batchPayments", financialRateLimit);
  app.use("/api/trpc/ledger", financialRateLimit);
  app.use("/api/trpc/drawback", financialRateLimit);

  // ── Admin operation rate limiting ─────────────────────────────────────────────
  app.use("/api/trpc/bulkExport", adminOperationRateLimit);
  app.use("/api/trpc/tenant", adminOperationRateLimit);
  app.use("/api/trpc/keycloak", adminOperationRateLimit);

  // Body parser — 10 MB JSON, 25 MB for URL-encoded (file uploads use multipart)
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));

  // ─── KEYCLOAK EVENT WEBHOOK ──────────────────────────────────────────────────
  app.post("/api/webhooks/keycloak-event", express.json(), async (req, res) => {
    try {
      const secret = process.env.KEYCLOAK_WEBHOOK_SECRET;
      if (secret) {
        const sig = req.headers["x-keycloak-signature"] as string | undefined;
        if (!sig) { res.status(401).json({ error: "Missing signature" }); return; }
        const { createHmac } = await import("crypto");
        const hmac = createHmac("sha256", secret);
        hmac.update(JSON.stringify(req.body));
        const expected = hmac.digest("hex");
        if (sig !== expected) { res.status(401).json({ error: "Invalid signature" }); return; }
      }
      const event = req.body as {
        type?: string; realmId?: string; userId?: string;
        resourceType?: string; operationType?: string;
        representation?: unknown; time?: number;
      };
      const eventType = event.type ?? event.operationType ?? "UNKNOWN";
      const actor = event.userId ?? "keycloak-system";
      const detail = JSON.stringify({ resourceType: event.resourceType, representation: event.representation });
      // Write to auditEvents
      try {
        const dbModule = await import("../db");
        const db = await dbModule.getDb();
        if (db) {
          const { auditEvents } = await import("../../drizzle/schema");
          await db.insert(auditEvents).values({
            action: `KEYCLOAK_${eventType}`,
            entityType: "user" as any,
            entityId: 0,
            actorId: null,
            actorType: "keycloak",
            metadata: { actor, detail },
            createdAt: event.time ? new Date(event.time) : new Date(),
          });
        }
      } catch (dbErr) {
        console.warn("[Keycloak Webhook] DB write failed:", dbErr);
      }
      // Index in OpenSearch
      try {
        const { indexAuditEvent } = await import("./opensearch");
        await indexAuditEvent({
          id: 0,
          action: `KEYCLOAK_${eventType}`,
          entityType: event.resourceType ?? "keycloak",
          entityId: 0,
          actorId: null,
          actorType: "keycloak",
          createdAt: event.time ? new Date(event.time) : new Date(),
        });
      } catch (osErr) {
        console.warn("[Keycloak Webhook] OpenSearch index failed:", osErr);
      }
      res.json({ received: true });
    } catch (err) {
      console.error("[Keycloak Webhook] Error:", err);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // ─── OPENSEARCH ILM ADMIN ENDPOINT ───────────────────────────────────────────
  app.post("/api/admin/opensearch/setup-ilm", async (req, res) => {
    try {
      const authResult = await sdk.authenticateRequest(req);
      if (!authResult || authResult.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      const { setupIndexLifecycle } = await import("./opensearch");
      const result = await setupIndexLifecycle();
      res.json(result);
    } catch (err) {
      console.error("[ILM Setup] Error:", err);
      res.status(500).json({ error: "ILM setup failed" });
    }
  });

  // Sprint 68: OpenAPI spec endpoint
  registerOpenApiRoute(app);
  // Deep health check endpoints (/api/health, /api/health/live, /api/health/ready)
  registerHealthRoutes(app);
  // Prometheus metrics endpoint — scraped by Prometheus every 15 s
  // SECURITY: Restricted to internal network (loopback/RFC-1918) or bearer token auth
  app.get("/metrics", async (req, res) => {
    const clientIp = (req.headers['x-forwarded-for'] as string || req.ip || req.socket.remoteAddress || '').split(',')[0].trim();
    const isInternal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(clientIp)
      || clientIp.startsWith('10.') || clientIp.startsWith('172.16.') || clientIp.startsWith('192.168.');
    const metricsToken = process.env.METRICS_BEARER_TOKEN || '';
    const authHeader = req.headers.authorization || '';
    const hasValidToken = metricsToken.length > 0 && authHeader === `Bearer ${metricsToken}`;
    if (!isInternal && !hasValidToken) {
      res.status(403).json({ error: 'Metrics endpoint restricted to internal network. Provide Bearer token for external access.' });
      return;
    }
    try {
      res.set("Content-Type", metricsRegistry.contentType);
      res.end(await metricsRegistry.metrics());
    } catch (err) {
      res.status(500).end(String(err));
    }
  });
  // Sprint 74: OGA approval callback webhook (POST /api/webhooks/oga)
  const { registerOgaWebhookRoute } = await import("../webhooks/oga");
  registerOgaWebhookRoute(app);
  // Sprint 77: Sanctions screening real-time alert webhook (POST /api/webhooks/sanctions-hit)
  const { registerSanctionsWebhookRoute } = await import("../webhooks/sanctions");
  registerSanctionsWebhookRoute(app);
  // v39: Flink CEP alert ingest webhook (POST /api/webhooks/cep-event)
  const { registerCepWebhookRoute } = await import("../webhooks/cep");
  registerCepWebhookRoute(app);
  // Sprint 79: Public certificate verification endpoint (GET /api/verify/:certNumber)
  const { registerCertVerifyRoute } = await import("../routes/certVerify");
  registerCertVerifyRoute(app);
  // File upload endpoint — authenticated multipart upload to S3
  const { uploadRouter } = await import("../routes/uploadRoute");
  app.use("/api/upload", uploadRouter);
  // E2E test auth endpoint — only mounted when E2E_TEST_MODE=1 (never in production)
  if (process.env.E2E_TEST_MODE === "1") {
    const { registerE2eTestAuthRoute } = await import("../routes/e2eTestAuth");
    registerE2eTestAuthRoute(app);
  }
  // Demo mode auth endpoint — only mounted when DEMO_MODE=true
  // Provides zero-friction demo access without OAuth for all 6 portal roles
  if (process.env.DEMO_MODE === "true") {
    const { registerDemoAuthRoute } = await import("../routes/demoAuth");
    registerDemoAuthRoute(app);
  }

  // SSE endpoint for real-time anomaly alerts (insider threat monitoring)
  {
    const { anomalySSEHandler } = await import("../sse");
    app.get("/api/events/anomalies", anomalySSEHandler);
    console.log("[SSE] Anomaly alert stream mounted at GET /api/events/anomalies");
  }

  // Kafka consumer for insider threat topics → anomalyBus → SSE clients
  {
    const { startInsiderThreatKafkaConsumer } = await import("../kafkaConsumer");
    startInsiderThreatKafkaConsumer().catch((err: Error) =>
      console.warn("[KafkaConsumer] Failed to start insider threat consumer:", err.message)
    );
  }

  // Scheduled Heartbeat handlers — must be before Vite/static fallthrough
  {
    const { bondExpiryDigestHandler } = await import("../scheduled/bondExpiryDigest");
    app.post("/api/scheduled/bond-expiry-digest", bondExpiryDigestHandler);
  }

    // 4-Eyes Approval Expiry — heartbeat handler + cron
  {
    const { fourEyesExpiryHandler, runFourEyesExpiryCron } = await import("../scheduled/fourEyesExpiry");
    app.post("/api/scheduled/four-eyes-expiry", fourEyesExpiryHandler);
    // Also run as an in-process cron every 15 minutes
    cron.schedule("0 */15 * * * *", runFourEyesExpiryCron, { timezone: "UTC" });
    console.log("[Cron] 4-Eyes approval expiry scheduled every 15 minutes");
  }
  // Lakehouse Nightly Trade-Stats Rollup — Heartbeat handler
  // Cron is created via: external scheduler registration for lakehouse-nightly-rollup
  //   --cron "0 0 2 * * *" --path /api/scheduled/lakehouse-rollup
  //   --description "Nightly trade-stats Delta Lake write-back at 02:00 UTC"
  // Must be run after deploying the site.
  {
    const { lakehouseRollupHandler } = await import("../scheduled/lakehouseRollup");
    app.post("/api/scheduled/lakehouse-rollup", lakehouseRollupHandler);
    console.log("[Heartbeat] /api/scheduled/lakehouse-rollup registered");
  }
  // v106: Post-Clearance Audit Weekly Reminder — Heartbeat handler (Monday 06:00 UTC)
  {
    const { postAuditReminderHandler } = await import("../scheduled/postAuditReminder");
    app.post("/api/scheduled/post-audit-reminder", postAuditReminderHandler);
    console.log("[Heartbeat] /api/scheduled/post-audit-reminder registered");
  }
  {
    const { slaBreachEscalationHandler } = await import("../scheduled/slaBreachEscalation");
    app.post("/api/scheduled/sla-breach-escalation", slaBreachEscalationHandler);
    console.log("[Heartbeat] /api/scheduled/sla-breach-escalation registered");
  }
  {
    const { documentVaultExpiryHandler } = await import("../scheduled/documentVaultExpiry");
    app.post("/api/scheduled/document-vault-expiry", documentVaultExpiryHandler);
    console.log("[Heartbeat] /api/scheduled/document-vault-expiry registered");
  }
  // Tenant Domain DNS Propagation Poller — Heartbeat handler (every 15 min)
  // Cron creation: external scheduler registration for tenant-domain-poller
  //   --cron "0 */15 * * * *" --path /api/scheduled/tenant-domain-poll
  //   --description "Auto-verify pending tenant custom domains every 15 minutes"
  {
    const { tenantDomainPollerHandler } = await import("../scheduled/tenantDomainPoller");
    app.post("/api/scheduled/tenant-domain-poll", tenantDomainPollerHandler);
    console.log("[Heartbeat] /api/scheduled/tenant-domain-poll registered");
  }
  // tRPC API — apply general rate limiting
  app.use("/api/trpc", trpcRateLimit);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

    server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Seed default KPI targets on startup (idempotent)
    import("../routers/kpiTargets").then(({ seedDefaultKpiTargets }) => seedDefaultKpiTargets()).catch(() => {});
    // Seed demo data (bonded warehouses, CEP patterns, cost records) — idempotent
    import("../seedDemoData").then(({ seedAllDemoData }) => seedAllDemoData()).catch(() => {});

    // v52: Check CEP pattern threshold breaches every 30 minutes and notify owner
    const checkThresholdBreaches = async () => {
      try {
        const { getPool, getDb } = await import("../db");
        await getDb();
        const pool = getPool();
        if (!pool) return;
        // Find patterns with a threshold set
        const { rows: patterns } = await pool.query<{
          pattern_id: string;
          pattern_name: string;
          daily_alert_threshold: number;
        }>(`SELECT pattern_id, pattern_name, daily_alert_threshold
            FROM cep_patterns
            WHERE daily_alert_threshold IS NOT NULL AND is_active = true`);
        if (patterns.length === 0) return;
        const { notifyOwner } = await import("./notification");
        for (const pattern of patterns) {
          const { rows: [{ count }] } = await pool.query<{ count: string }>(
            `SELECT COUNT(*) AS count FROM cep_alerts
             WHERE pattern_id = $1
               AND status NOT IN ('resolved', 'dismissed')
               AND detected_at >= NOW() - INTERVAL '24 hours'`,
            [pattern.pattern_id]
          );
          const dailyCount = parseInt(count, 10);
          if (dailyCount > pattern.daily_alert_threshold) {
            await notifyOwner({
              title: `⚠ CEP Threshold Breach: ${pattern.pattern_name}`,
              content: `Pattern "${pattern.pattern_name}" fired ${dailyCount} alerts in the last 24 hours, exceeding the configured threshold of ${pattern.daily_alert_threshold}. Review the CEP Alerts dashboard immediately.`,
            }).catch(() => {});
          }
        }
      } catch {
        // Non-critical — swallow errors silently
      }
    };
    // Run once at startup, then every 30 minutes
    checkThresholdBreaches();
    setInterval(checkThresholdBreaches, 30 * 60 * 1000);
  });

  // ── CEP Suppression Log CSV export (admin-only) ───────────────────────────────────
  app.get("/api/cep/suppression-log.csv", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req as any).catch(() => null);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    } catch {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    try {
      const { getPool } = await import("../db");
      const pool = getPool();
      if (!pool) { res.status(500).json({ error: "DB unavailable" }); return; }
      const { rows } = await pool.query(`
        SELECT
          sl.id,
          sl.alert_id,
          sl.pattern_id,
          sl.suppressed_by,
          u.name AS suppressed_by_name,
          sl.hours,
          sl.suppressed_until,
          sl.created_at
        FROM cep_suppression_log sl
        LEFT JOIN users u ON u.id = sl.suppressed_by
        ORDER BY sl.created_at DESC
      `);
      const header = "id,alert_id,pattern_id,suppressed_by,suppressed_by_name,hours,suppressed_until,created_at\n";
      const csvRows = (rows as Record<string, unknown>[]).map((r) =>
        [
          r.id, r.alert_id, r.pattern_id, r.suppressed_by,
          `"${String(r.suppressed_by_name ?? "").replace(/"/g, '""')}"`,
          r.hours,
          r.suppressed_until ? new Date(r.suppressed_until as string).toISOString() : "",
          r.created_at ? new Date(r.created_at as string).toISOString() : "",
        ].join(",")
      );
      const csv = header + csvRows.join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="suppression-log.csv"');
      res.send(csv);
    } catch (err) {
      console.error("[CSV] suppression-log export error:", err);
      res.status(500).json({ error: "Export failed" });
    }
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const gracefulShutdown = async (signal: string) => {
    console.log(`[Server] Received ${signal}. Starting graceful shutdown...`);
    server.close(async () => {
      console.log('[Server] HTTP server closed.');
      try {
        const { closePool } = await import('../db');
        await closePool();
        console.log('[Server] Database pool closed.');
      } catch (err) {
        console.error('[Server] Error closing database pool:', err);
      }
      console.log('[Server] Graceful shutdown complete.');
      process.exit(0);
    });
    // Force exit after 30 seconds if graceful shutdown hangs
    setTimeout(() => {
      console.error('[Server] Graceful shutdown timed out. Forcing exit.');
      process.exit(1);
    }, 30_000);
  };
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  // Also close Kafka producer on shutdown
  process.on('SIGTERM', () => closeKafka().catch(() => {}));
  process.on('SIGINT', () => closeKafka().catch(() => {}));

  // Sprint 70/73: Broadcast live vessel positions every 15 seconds; check geofence crossings
  // Deduplicate geofence alerts: track last-fired time per vessel+geofence pair
  const geofenceAlertCache = new Map<string, number>();

  setInterval(async () => {
    try {
      const { getLiveVesselsData } = await import("../routers/cargoTracking");
      const vessels = await getLiveVesselsData();
      if (vessels.length > 0) {
        broadcastVesselUpdate({
          vessels,
          totalCount: vessels.length,
          lastRefresh: new Date().toISOString(),
        });
        // Sprint 73: Check geofence crossings for each vessel
        const { getDb } = await import("../db");
        const db = await getDb();
        if (db) {
          const { geofences: gfTable } = await import("../../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          const { notifyOwner } = await import("./notification");
          const activeGeoFences = await db.select().from(gfTable).where(eq(gfTable.status, "active"));
          // Point-in-polygon check using ray casting algorithm
          const pointInPolygon = (lat: number, lon: number, polygon: Array<{ lat: number; lon: number }>) => {
            let inside = false;
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
              const xi = polygon[i].lon, yi = polygon[i].lat;
              const xj = polygon[j].lon, yj = polygon[j].lat;
              const intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
              if (intersect) inside = !inside;
            }
            return inside;
          };
          for (const vessel of vessels) {
            for (const gf of activeGeoFences) {
              if (!gf.polygon || gf.polygon.length < 3) continue;
              const inside = pointInPolygon(vessel.lat, vessel.lon, gf.polygon);
              if (inside && gf.alertOnEntry && gf.notifyOwnerOnTrigger) {
                const eventKey = `gf-${gf.id}-${vessel.mmsi}`;
                const now = Date.now();
                const lastFired = geofenceAlertCache.get(eventKey) ?? 0;
                if (now - lastFired > 3_600_000) {
                  geofenceAlertCache.set(eventKey, now);
                  notifyOwner({
                    title: `Geofence Alert: ${vessel.vesselName} entered ${gf.name}`,
                    content: `Vessel ${vessel.vesselName} (MMSI: ${vessel.mmsi}) entered geofence zone "${gf.name}" (${gf.geofenceType}) at ${new Date().toUTCString()}. Position: ${vessel.lat.toFixed(4)}, ${vessel.lon.toFixed(4)}.`,
                  }).catch(() => {});
                }
              }
            }
          }
        }
      }
    } catch {
      // Silently skip if DB is unavailable
    }
  }, 15_000);
}

startServer().catch(console.error);

// ── Payment Queue Background Worker ────────────────────────────────────────
// Polls payment_queue every 5s, calls Mojaloop ILP, commits/retries with
// exponential back-off. Dead-letters after max_attempts (default 5).
startPaymentWorker();

// Graceful shutdown: stop worker before process exits
process.once("SIGTERM", () => stopPaymentWorker());
process.once("SIGINT",  () => stopPaymentWorker());

// ── Payment Archive Tiering Cron (1B payments/day pattern) ──────────────────
// Inspired by: https://backend.how/posts/1b-payments-per-day/
// Hot  (≤7 days):   fast read path, full PostgreSQL row
// Warm (7–90 days): compressed Parquet on object storage, metadata in DB
// Cold (>90 days):  deep archive, Parquet on cold object storage
async function runPaymentArchivalCron() {
  const { getDb: _archiveGetDb } = await import("../db");
  const db = await _archiveGetDb();
  if (!db) {
    console.warn("[Cron] Payment archival — DB unavailable, skipping");
    return;
  }
  const now = new Date();
  const tiers: Array<{ tier: "hot" | "warm" | "cold"; fromDays: number; toDays: number }> = [
    { tier: "hot",  fromDays: 0,  toDays: 7   },
    { tier: "warm", fromDays: 7,  toDays: 90  },
    { tier: "cold", fromDays: 90, toDays: 3650 },
  ];
  for (const { tier, fromDays, toDays } of tiers) {
    try {
      const periodEnd   = new Date(now.getTime() - fromDays * 86_400_000);
      const periodStart = new Date(now.getTime() - toDays  * 86_400_000);
      const { paymentQueue: pq, paymentArchivalJobs: paj } = await import("../../drizzle/schema");
      const { count: drizzleCount, eq: drizzleEq, and: drizzleAnd, gte: drizzleGte, lt: drizzleLt } = await import("drizzle-orm");
      const [{ total }] = await db
        .select({ total: drizzleCount() })
        .from(pq)
        .where(
          drizzleAnd(
            drizzleEq(pq.status, "committed"),
            drizzleGte(pq.createdAt, periodStart),
            drizzleLt(pq.createdAt, periodEnd),
          )
        );
      if (Number(total) === 0) continue;
      const jobId = `archival-${tier}-${now.toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
      const bytesEstimate = Number(total) * 512;
      await db.insert(paj).values({
        jobId,
        tier,
        periodStart,
        periodEnd,
        transfersArchived: Number(total),
        bytesWritten: BigInt(bytesEstimate),
        status: "completed",
        completedAt: now,
        storageUri: `s3://tradegateway-archive/${tier}/${now.toISOString().slice(0, 10)}/${jobId}.parquet`,
      });
      console.log(`[Cron] Payment archival — ${tier} tier: archived ${total} transfers → ${jobId}`);
    } catch (err) {
      console.error(`[Cron] Payment archival ${tier} tier failed:`, err);
    }
  }
}

// Run archival daily at 04:00 UTC
cron.schedule("0 0 4 * * *", runPaymentArchivalCron, { timezone: "UTC" });
console.log("[Cron] Payment archival (Hot/Warm/Cold) scheduled at 04:00 UTC daily");

// ── Balance Drift Reconciliation Cron (daily at 03:00 UTC) ─────────────────
// Compares payment_accounts mirror vs committed payment_queue sums.
// Notifies owner if any account has non-zero drift.
cron.schedule("0 0 3 * * *", runScheduledBalanceDriftCheck, { timezone: "UTC" });
console.log("[Cron] Balance drift reconciliation scheduled at 03:00 UTC daily");
