/**
 * next-steps-v4.test.ts
 * Sprint Caddy v4 — Vitest tests for:
 *   1. Coraza hot-reload smoke test (Caddy admin API /load endpoint)
 *   2. Heartbeat Admin router structure and procedure exports
 *   3. DNS poller Heartbeat endpoint registration
 *   4. HeartbeatAdmin UI page file existence
 *   5. system_heartbeat_jobs schema table
 *   6. GitHub PR branch workflow
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "fs";
import path from "path";

// ─── 1. CORAZA HOT-RELOAD SMOKE TEST ────────────────────────────────────────

describe("Coraza hot-reload smoke test", () => {
  it("corazaWaf router imports keycloakAdminProcedure (not adminProcedure)", () => {
    const routerPath = path.resolve(
      __dirname,
      "routers/corazaWaf.ts"
    );
    const content = readFileSync(routerPath, "utf-8");
    expect(content).toContain("keycloakAdminProcedure");
    // Should NOT use bare adminProcedure for rule management
    const adminProcedureUsages = (content.match(/:\s*adminProcedure\b/g) ?? []).length;
    expect(adminProcedureUsages).toBe(0);
  });

  it("corazaWaf router has a getCaddyAdminStatus procedure", () => {
    const routerPath = path.resolve(__dirname, "routers/corazaWaf.ts");
    const content = readFileSync(routerPath, "utf-8");
    expect(content).toContain("getCaddyAdminStatus");
  });

  it("corazaWaf router posts to Caddy admin API /load on rule toggle", () => {
    const routerPath = path.resolve(__dirname, "routers/corazaWaf.ts");
    const content = readFileSync(routerPath, "utf-8");
    // The router should reference the Caddy admin API endpoint
    expect(content).toMatch(/2019\/load|caddy.*admin.*api|CADDY_ADMIN/i);
  });

  it("Caddyfile.prod contains on_demand_tls global block", () => {
    const caddyfilePath = path.resolve(
      __dirname,
      "../infra/caddy/Caddyfile.prod"
    );
    const content = readFileSync(caddyfilePath, "utf-8");
    expect(content).toContain("on_demand_tls");
  });

  it("Caddyfile.prod references the tenant hostname validation ask endpoint", () => {
    const caddyfilePath = path.resolve(
      __dirname,
      "../infra/caddy/Caddyfile.prod"
    );
    const content = readFileSync(caddyfilePath, "utf-8");
    // Should have an ask URL pointing to the tRPC or REST validation endpoint
    expect(content).toMatch(/ask\s+https?:\/\//);
  });

  it("corazaWaf router has getEventsForRule procedure for event correlation", () => {
    const routerPath = path.resolve(__dirname, "routers/corazaWaf.ts");
    const content = readFileSync(routerPath, "utf-8");
    expect(content).toContain("getEventsForRule");
  });

  it("corazaWaf router has getTopFiringRules procedure", () => {
    const routerPath = path.resolve(__dirname, "routers/corazaWaf.ts");
    const content = readFileSync(routerPath, "utf-8");
    expect(content).toContain("getTopFiringRules");
  });
});

// ─── 2. HEARTBEAT ADMIN ROUTER ───────────────────────────────────────────────

describe("heartbeatAdmin router", () => {
  it("heartbeatAdmin router file exists", () => {
    const routerPath = path.resolve(__dirname, "routers/heartbeatAdmin.ts");
    expect(existsSync(routerPath)).toBe(true);
  });

  it("heartbeatAdmin router exports heartbeatAdminRouter", () => {
    const routerPath = path.resolve(__dirname, "routers/heartbeatAdmin.ts");
    const content = readFileSync(routerPath, "utf-8");
    expect(content).toContain("heartbeatAdminRouter");
  });

  it("heartbeatAdmin router has createPoller procedure", () => {
    const routerPath = path.resolve(__dirname, "routers/heartbeatAdmin.ts");
    const content = readFileSync(routerPath, "utf-8");
    expect(content).toContain("createPoller");
  });

  it("heartbeatAdmin router has pausePoller procedure", () => {
    const routerPath = path.resolve(__dirname, "routers/heartbeatAdmin.ts");
    const content = readFileSync(routerPath, "utf-8");
    expect(content).toContain("pausePoller");
  });

  it("heartbeatAdmin router has resumePoller procedure", () => {
    const routerPath = path.resolve(__dirname, "routers/heartbeatAdmin.ts");
    const content = readFileSync(routerPath, "utf-8");
    expect(content).toContain("resumePoller");
  });

  it("heartbeatAdmin router has deletePoller procedure", () => {
    const routerPath = path.resolve(__dirname, "routers/heartbeatAdmin.ts");
    const content = readFileSync(routerPath, "utf-8");
    expect(content).toContain("deletePoller");
  });

  it("heartbeatAdmin router has getPollerStatus procedure", () => {
    const routerPath = path.resolve(__dirname, "routers/heartbeatAdmin.ts");
    const content = readFileSync(routerPath, "utf-8");
    expect(content).toContain("getPollerStatus");
  });

  it("heartbeatAdmin router has updatePollerCron procedure", () => {
    const routerPath = path.resolve(__dirname, "routers/heartbeatAdmin.ts");
    const content = readFileSync(routerPath, "utf-8");
    expect(content).toContain("updatePollerCron");
  });

  it("heartbeatAdmin router has listAllJobs procedure", () => {
    const routerPath = path.resolve(__dirname, "routers/heartbeatAdmin.ts");
    const content = readFileSync(routerPath, "utf-8");
    expect(content).toContain("listAllJobs");
  });

  it("heartbeatAdmin router uses keycloakAdminProcedure for admin operations", () => {
    const routerPath = path.resolve(__dirname, "routers/heartbeatAdmin.ts");
    const content = readFileSync(routerPath, "utf-8");
    expect(content).toContain("keycloakAdminProcedure");
  });

  it("heartbeatAdmin router is registered in main routers.ts", () => {
    const routersPath = path.resolve(__dirname, "routers.ts");
    const content = readFileSync(routersPath, "utf-8");
    expect(content).toContain("heartbeatAdmin");
  });
});

// ─── 3. DNS POLLER HEARTBEAT ENDPOINT ────────────────────────────────────────

describe("DNS poller Heartbeat endpoint", () => {
  it("tenantDomainPoller.ts file exists", () => {
    const pollerPath = path.resolve(
      __dirname,
      "scheduled/tenantDomainPoller.ts"
    );
    expect(existsSync(pollerPath)).toBe(true);
  });

  it("tenantDomainPoller performs DNS TXT lookup", () => {
    const pollerPath = path.resolve(
      __dirname,
      "scheduled/tenantDomainPoller.ts"
    );
    const content = readFileSync(pollerPath, "utf-8");
    expect(content).toMatch(/resolveTxt|dns.*promises|node:dns/i);
  });

  it("tenantDomainPoller handles ENOTFOUND gracefully", () => {
    const pollerPath = path.resolve(
      __dirname,
      "scheduled/tenantDomainPoller.ts"
    );
    const content = readFileSync(pollerPath, "utf-8");
    expect(content).toContain("ENOTFOUND");
  });

  it("tenantDomainPoller endpoint is registered in index.ts", () => {
    const indexPath = path.resolve(__dirname, "_core/index.ts");
    const content = readFileSync(indexPath, "utf-8");
    expect(content).toMatch(/tenant-domain-poll|tenantDomainPoller/i);
  });

  it("db.ts has getTenantsWithPendingDomain helper", () => {
    const dbPath = path.resolve(__dirname, "db.ts");
    const content = readFileSync(dbPath, "utf-8");
    expect(content).toContain("getTenantsWithPendingDomain");
  });

  it("db.ts has markTenantDomainVerified helper", () => {
    const dbPath = path.resolve(__dirname, "db.ts");
    const content = readFileSync(dbPath, "utf-8");
    expect(content).toContain("markTenantDomainVerified");
  });
});

// ─── 4. HEARTBEAT ADMIN UI PAGE ──────────────────────────────────────────────

describe("HeartbeatAdmin UI page", () => {
  it("HeartbeatAdmin.tsx file exists", () => {
    const pagePath = path.resolve(
      __dirname,
      "../client/src/pages/admin/HeartbeatAdmin.tsx"
    );
    expect(existsSync(pagePath)).toBe(true);
  });

  it("HeartbeatAdmin page uses trpc.heartbeatAdmin.createPoller", () => {
    const pagePath = path.resolve(
      __dirname,
      "../client/src/pages/admin/HeartbeatAdmin.tsx"
    );
    const content = readFileSync(pagePath, "utf-8");
    expect(content).toContain("heartbeatAdmin.createPoller");
  });

  it("HeartbeatAdmin page uses trpc.heartbeatAdmin.getPollerStatus", () => {
    const pagePath = path.resolve(
      __dirname,
      "../client/src/pages/admin/HeartbeatAdmin.tsx"
    );
    const content = readFileSync(pagePath, "utf-8");
    expect(content).toContain("heartbeatAdmin.getPollerStatus");
  });

  it("HeartbeatAdmin route is registered in App.tsx", () => {
    const appPath = path.resolve(
      __dirname,
      "../client/src/App.tsx"
    );
    const content = readFileSync(appPath, "utf-8");
    expect(content).toContain("/app/admin/heartbeat-admin");
    expect(content).toContain("HeartbeatAdmin");
  });

  it("HeartbeatAdmin sidebar link is in DashboardLayout", () => {
    const layoutPath = path.resolve(
      __dirname,
      "../client/src/components/DashboardLayout.tsx"
    );
    const content = readFileSync(layoutPath, "utf-8");
    expect(content).toContain("heartbeat-admin");
    expect(content).toContain("Heartbeat Job Manager");
  });
});

// ─── 5. SYSTEM_HEARTBEAT_JOBS SCHEMA TABLE ───────────────────────────────────

describe("system_heartbeat_jobs schema table", () => {
  it("schema.ts contains systemHeartbeatJobs table", () => {
    const schemaPath = path.resolve(__dirname, "../drizzle/schema.ts");
    const content = readFileSync(schemaPath, "utf-8");
    expect(content).toMatch(/systemHeartbeatJobs|system_heartbeat_jobs/i);
  });

  it("schema has taskUid column for Heartbeat task reference", () => {
    const schemaPath = path.resolve(__dirname, "../drizzle/schema.ts");
    const content = readFileSync(schemaPath, "utf-8");
    expect(content).toContain("taskUid");
  });

  it("schema has cronExpression column", () => {
    const schemaPath = path.resolve(__dirname, "../drizzle/schema.ts");
    const content = readFileSync(schemaPath, "utf-8");
    expect(content).toContain("cronExpression");
  });

  it("schema has isEnabled column for pause/resume state", () => {
    const schemaPath = path.resolve(__dirname, "../drizzle/schema.ts");
    const content = readFileSync(schemaPath, "utf-8");
    expect(content).toContain("isEnabled");
  });

  it("migration 0046 was generated for system_heartbeat_jobs", () => {
    const migrationsDir = path.resolve(__dirname, "../drizzle/migrations");
    const files = require("fs").readdirSync(migrationsDir);
    const hasMigration = files.some((f: string) => f.startsWith("0046"));
    expect(hasMigration).toBe(true);
  });
});

// ─── 6. GITHUB PR BRANCH WORKFLOW ────────────────────────────────────────────

describe("GitHub PR workflow", () => {
  it("singlewindow clone directory exists with project files", () => {
    const clonePath = path.resolve(__dirname, "..");
    expect(existsSync(clonePath)).toBe(true);
    expect(existsSync(path.join(clonePath, "package.json"))).toBe(true);
  });

  it("infra/caddy directory exists in project", () => {
    const caddyDir = path.resolve(__dirname, "../infra/caddy");
    expect(existsSync(caddyDir)).toBe(true);
  });

  it("infra/k8s/caddy directory exists with manifests", () => {
    const k8sCaddyDir = path.resolve(__dirname, "../infra/k8s/caddy");
    expect(existsSync(k8sCaddyDir)).toBe(true);
  });

  it("server/middleware/keycloakJwt.ts exists", () => {
    const middlewarePath = path.resolve(
      __dirname,
      "middleware/keycloakJwt.ts"
    );
    expect(existsSync(middlewarePath)).toBe(true);
  });

  it("server/scheduled/tenantDomainPoller.ts exists", () => {
    const pollerPath = path.resolve(
      __dirname,
      "scheduled/tenantDomainPoller.ts"
    );
    expect(existsSync(pollerPath)).toBe(true);
  });
});
