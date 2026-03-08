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

// Schedule: second(0) minute(0) hour(2) day(*) month(*) weekday(*) = 02:00 UTC daily
cron.schedule("0 0 2 * * *", runNightlyRiskScan, { timezone: "UTC" });
console.log("[Cron] Nightly risk scan scheduled at 02:00 UTC daily");

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
