import "dotenv/config";
// Override DATABASE_URL to use local PostgreSQL (ignoring platform-injected TiDB URL)
process.env.DATABASE_URL = "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import cron from "node-cron";

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
    const processingStatuses = ["submitted", "under_review", "inspection_required", "payment_pending"];
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

async function runNightlyJobs() {
  await runNightlyRiskScan();
  await runPermitExpiryCheck();
  await runSLABreachScan();
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

// Schedule: second(0) minute(0) hour(2) day(*) month(*) weekday(*) = 02:00 UTC daily
cron.schedule("0 0 2 * * *", runNightlyJobs, { timezone: "UTC" });
console.log("[Cron] Nightly jobs scheduled at 02:00 UTC daily (risk scan + permit expiry check + SLA breach scan)");

// Port congestion alert scan — every 15 minutes
cron.schedule("0 */15 * * * *", runPortCongestionAlertScan, { timezone: "UTC" });
console.log("[Cron] Port congestion alert scan scheduled every 15 minutes");

// Daily digest — every day at 08:00 UTC
cron.schedule("0 0 8 * * *", () => runNotificationDigest("daily"), { timezone: "UTC" });
console.log("[Cron] Daily notification digest scheduled at 08:00 UTC");

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
          sql`${declarations.status} IN ('submitted','under_review','inspection_required','payment_pending')`,
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

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
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
  });
}

startServer().catch(console.error);
