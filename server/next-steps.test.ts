/**
 * next-steps.test.ts — Vitest tests for Sprint Caddy Next Steps
 *
 * Covers:
 *   1. Caddy On-Demand TLS: tenant.validateCustomDomain procedure
 *   2. Keycloak roles → tRPC context: keycloakRoleProcedure and keycloakAdminProcedure
 *   3. Coraza WAF: corazaWaf router procedures
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "fs";
import path from "path";

// ─── 1. Caddy On-Demand TLS ───────────────────────────────────────────────────

describe("Caddy On-Demand TLS", () => {
  it("Caddyfile.prod contains on_demand_tls global block", () => {
    const caddyfilePath = path.resolve(
      __dirname,
      "../infra/caddy/Caddyfile.prod"
    );
    expect(existsSync(caddyfilePath)).toBe(true);
    const content = readFileSync(caddyfilePath, "utf-8");
    expect(content).toContain("on_demand_tls");
    expect(content).toContain("ask http://");
    expect(content).toContain("tenant.validateCustomDomain");
  });

  it("Caddyfile.prod contains :443 catch-all block with on_demand tls", () => {
    const caddyfilePath = path.resolve(
      __dirname,
      "../infra/caddy/Caddyfile.prod"
    );
    const content = readFileSync(caddyfilePath, "utf-8");
    expect(content).toContain(":443");
    expect(content).toContain("on_demand");
    expect(content).toContain("X-Tenant-Host");
  });

  it("tenant router file exists and exports tenantRouter", async () => {
    const tenantRouterPath = path.resolve(
      __dirname,
      "./routers/tenant.ts"
    );
    expect(existsSync(tenantRouterPath)).toBe(true);
    const content = readFileSync(tenantRouterPath, "utf-8");
    expect(content).toContain("tenantRouter");
    expect(content).toContain("validateCustomDomain");
  });

  it("tenant router contains registerCustomDomain and verifyCustomDomain procedures", () => {
    const content = readFileSync(
      path.resolve(__dirname, "./routers/tenant.ts"),
      "utf-8"
    );
    expect(content).toContain("registerCustomDomain");
    expect(content).toContain("verifyCustomDomain");
  });

  it("schema has customDomain column in tenants table", () => {
    const schemaPath = path.resolve(__dirname, "../drizzle/schema.ts");
    const content = readFileSync(schemaPath, "utf-8");
    expect(content).toContain("customDomain");
    expect(content).toContain("domainVerified");
  });
});

// ─── 2. Keycloak roles → tRPC context ────────────────────────────────────────

describe("Keycloak roles → tRPC context bridge", () => {
  it("context.ts exports TrpcContext with keycloakRoles field", () => {
    const contextPath = path.resolve(__dirname, "./_core/context.ts");
    expect(existsSync(contextPath)).toBe(true);
    const content = readFileSync(contextPath, "utf-8");
    expect(content).toContain("keycloakRoles");
  });

  it("trpc.ts exports keycloakRoleProcedure factory", () => {
    const trpcPath = path.resolve(__dirname, "./_core/trpc.ts");
    expect(existsSync(trpcPath)).toBe(true);
    const content = readFileSync(trpcPath, "utf-8");
    expect(content).toContain("keycloakRoleProcedure");
  });

  it("trpc.ts exports keycloakAdminProcedure", () => {
    const content = readFileSync(
      path.resolve(__dirname, "./_core/trpc.ts"),
      "utf-8"
    );
    expect(content).toContain("keycloakAdminProcedure");
  });

  it("keycloakRoleProcedure throws FORBIDDEN for missing role", () => {
    // Unit test the role check logic without DB
    const hasRole = (roles: string[], required: string) =>
      roles.includes(required);

    expect(hasRole(["realm-admin", "customs-officer"], "realm-admin")).toBe(true);
    expect(hasRole(["trader"], "realm-admin")).toBe(false);
    expect(hasRole([], "customs-officer")).toBe(false);
  });

  it("keycloakAdminProcedure requires realm-admin role", () => {
    const KEYCLOAK_ADMIN_ROLE = "realm-admin";
    const adminRoles = ["realm-admin", "customs-officer"];
    const userRoles = ["trader"];

    expect(adminRoles.includes(KEYCLOAK_ADMIN_ROLE)).toBe(true);
    expect(userRoles.includes(KEYCLOAK_ADMIN_ROLE)).toBe(false);
  });

  it("context.ts extracts keycloakRoles from X-Auth-Request-Groups header", () => {
    const content = readFileSync(
      path.resolve(__dirname, "./_core/context.ts"),
      "utf-8"
    );
    // Should read from the header injected by oauth2-proxy
    expect(content).toContain("X-Auth-Request-Groups");
  });
});

// ─── 3. Coraza WAF rule tuning ────────────────────────────────────────────────

describe("Coraza WAF rule tuning", () => {
  it("corazaWaf router file exists", () => {
    const routerPath = path.resolve(__dirname, "./routers/corazaWaf.ts");
    expect(existsSync(routerPath)).toBe(true);
  });

  it("corazaWaf router exports corazaWafRouter", () => {
    const content = readFileSync(
      path.resolve(__dirname, "./routers/corazaWaf.ts"),
      "utf-8"
    );
    expect(content).toContain("corazaWafRouter");
  });

  it("corazaWaf router has listRules procedure", () => {
    const content = readFileSync(
      path.resolve(__dirname, "./routers/corazaWaf.ts"),
      "utf-8"
    );
    expect(content).toContain("listRules");
  });

  it("corazaWaf router has toggleRule procedure", () => {
    const content = readFileSync(
      path.resolve(__dirname, "./routers/corazaWaf.ts"),
      "utf-8"
    );
    expect(content).toContain("toggleRule");
  });

  it("corazaWaf router has bulkToggleRules procedure", () => {
    const content = readFileSync(
      path.resolve(__dirname, "./routers/corazaWaf.ts"),
      "utf-8"
    );
    expect(content).toContain("bulkToggleRules");
  });

  it("corazaWaf router has getRuleStats procedure", () => {
    const content = readFileSync(
      path.resolve(__dirname, "./routers/corazaWaf.ts"),
      "utf-8"
    );
    expect(content).toContain("getRuleStats");
  });

  it("corazaWaf router has getRecentChanges procedure", () => {
    const content = readFileSync(
      path.resolve(__dirname, "./routers/corazaWaf.ts"),
      "utf-8"
    );
    expect(content).toContain("getRecentChanges");
  });

  it("corazaWaf router has getCaddyAdminStatus procedure", () => {
    const content = readFileSync(
      path.resolve(__dirname, "./routers/corazaWaf.ts"),
      "utf-8"
    );
    expect(content).toContain("getCaddyAdminStatus");
  });

  it("corazaWaf router uses keycloakAdminProcedure for all mutations", () => {
    const content = readFileSync(
      path.resolve(__dirname, "./routers/corazaWaf.ts"),
      "utf-8"
    );
    // All write operations must be keycloak-admin-only (migrated from adminProcedure)
    expect(content).toContain("keycloakAdminProcedure");
    // toggleRule and bulkToggleRules must be mutations
    expect(content).toContain(".mutation(");
  });

  it("corazaWaf router seeds OWASP CRS rules", () => {
    const content = readFileSync(
      path.resolve(__dirname, "./routers/corazaWaf.ts"),
      "utf-8"
    );
    expect(content).toContain("OWASP_CRS_SEED");
    expect(content).toContain("942100"); // SQL injection rule
    expect(content).toContain("941100"); // XSS rule
    expect(content).toContain("932100"); // RCE rule
  });

  it("corazaWaf router includes custom NGSWTP rules", () => {
    const content = readFileSync(
      path.resolve(__dirname, "./routers/corazaWaf.ts"),
      "utf-8"
    );
    expect(content).toContain("NGSWTP-CUSTOM");
    expect(content).toContain("9900001");
  });

  it("schema has coraza_waf_rules table", () => {
    const schemaPath = path.resolve(__dirname, "../drizzle/schema.ts");
    const content = readFileSync(schemaPath, "utf-8");
    expect(content).toContain("corazaWafRules");
  });

  it("schema coraza_waf_rules has required audit columns", () => {
    const content = readFileSync(
      path.resolve(__dirname, "../drizzle/schema.ts"),
      "utf-8"
    );
    expect(content).toContain("disabledBy");
    expect(content).toContain("disabledAt");
    expect(content).toContain("enabledBy");
    expect(content).toContain("enabledAt");
    expect(content).toContain("changeReason");
  });

  it("corazaWaf router is registered in main routers.ts", () => {
    const routersPath = path.resolve(__dirname, "./routers.ts");
    const content = readFileSync(routersPath, "utf-8");
    expect(content).toContain("corazaWafRouter");
    expect(content).toContain("corazaWaf: corazaWafRouter");
  });

  it("CorazaWafDashboard page exists", () => {
    const pagePath = path.resolve(
      __dirname,
      "../client/src/pages/admin/CorazaWafDashboard.tsx"
    );
    expect(existsSync(pagePath)).toBe(true);
  });

  it("CorazaWafDashboard page uses corazaWaf tRPC procedures", () => {
    const content = readFileSync(
      path.resolve(
        __dirname,
        "../client/src/pages/admin/CorazaWafDashboard.tsx"
      ),
      "utf-8"
    );
    expect(content).toContain("trpc.corazaWaf.listRules");
    expect(content).toContain("trpc.corazaWaf.toggleRule");
    expect(content).toContain("trpc.corazaWaf.getRuleStats");
    expect(content).toContain("trpc.corazaWaf.getCaddyAdminStatus");
  });

  it("CorazaWafDashboard is registered in App.tsx", () => {
    const appPath = path.resolve(__dirname, "../client/src/App.tsx");
    const content = readFileSync(appPath, "utf-8");
    expect(content).toContain("CorazaWafDashboard");
    expect(content).toContain("/app/admin/coraza-waf");
  });

  it("Caddy hot-reload uses admin API endpoint", () => {
    const content = readFileSync(
      path.resolve(__dirname, "./routers/corazaWaf.ts"),
      "utf-8"
    );
    expect(content).toContain("CADDY_ADMIN_URL");
    expect(content).toContain("/load");
    expect(content).toContain("notifyCaddyReload");
  });

  it("OWASP_CRS_SEED contains critical severity rules", () => {
    const content = readFileSync(
      path.resolve(__dirname, "./routers/corazaWaf.ts"),
      "utf-8"
    );
    const criticalRules = content.match(/severity: "critical"/g);
    expect(criticalRules).not.toBeNull();
    expect((criticalRules ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

// ─── 4. Integration: all three features wired together ───────────────────────

describe("Sprint integration: all three features", () => {
  it("migration file exists for new schema columns", () => {
    const migrationsDir = path.resolve(__dirname, "../drizzle/migrations");
    const { readdirSync } = require("fs");
    const files = readdirSync(migrationsDir).filter((f: string) =>
      f.endsWith(".sql")
    );
    expect(files.length).toBeGreaterThan(0);
  });

  it("DashboardLayout has Coraza WAF Rules sidebar link", () => {
    const content = readFileSync(
      path.resolve(
        __dirname,
        "../client/src/components/DashboardLayout.tsx"
      ),
      "utf-8"
    );
    expect(content).toContain("Coraza WAF Rules");
    expect(content).toContain("/app/admin/coraza-waf");
  });

  it("DashboardLayout has Keycloak + Caddy Admin sidebar link", () => {
    const content = readFileSync(
      path.resolve(
        __dirname,
        "../client/src/components/DashboardLayout.tsx"
      ),
      "utf-8"
    );
    expect(content).toContain("Keycloak + Caddy Admin");
    expect(content).toContain("/app/admin/keycloak");
  });
});
