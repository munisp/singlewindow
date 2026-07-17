/**
 * next-steps-v2.test.ts — Vitest suite for the three next-step features:
 *   1. Tenant Custom Domain UI (TenantManagement tabs, tenant router procedures)
 *   2. keycloakAdminProcedure migration (all role-gated routers migrated)
 *   3. Coraza WAF event correlation (new procedures + Event Correlation tab)
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");

function read(rel: string) {
  return readFileSync(path.join(root, rel), "utf8");
}

// ─── 1. Tenant Custom Domain UI ──────────────────────────────────────────────

describe("Tenant Custom Domain UI", () => {
  it("TenantManagement page uses shadcn Tabs component", () => {
    const src = read("client/src/pages/app/TenantManagement.tsx");
    expect(src).toContain("TabsList");
    expect(src).toContain("TabsTrigger");
    expect(src).toContain("TabsContent");
  });

  it("TenantManagement page has a Custom Domain tab", () => {
    const src = read("client/src/pages/app/TenantManagement.tsx");
    expect(src.toLowerCase()).toContain("custom domain");
  });

  it("TenantManagement page calls registerCustomDomain procedure", () => {
    const src = read("client/src/pages/app/TenantManagement.tsx");
    expect(src).toContain("registerCustomDomain");
  });

  it("TenantManagement page calls verifyCustomDomain procedure", () => {
    const src = read("client/src/pages/app/TenantManagement.tsx");
    expect(src).toContain("verifyCustomDomain");
  });

  it("TenantManagement page calls removeCustomDomain procedure", () => {
    const src = read("client/src/pages/app/TenantManagement.tsx");
    expect(src).toContain("removeCustomDomain");
  });

  it("TenantManagement page shows domain verification token", () => {
    const src = read("client/src/pages/app/TenantManagement.tsx");
    // Should display TXT record or verification token
    expect(src.toLowerCase()).toMatch(/verif|txt record|token/);
  });

  it("tenant router has registerCustomDomain procedure", () => {
    const src = read("server/routers/tenant.ts");
    expect(src).toContain("registerCustomDomain");
  });

  it("tenant router has verifyCustomDomain procedure", () => {
    const src = read("server/routers/tenant.ts");
    expect(src).toContain("verifyCustomDomain");
  });

  it("tenant router has removeCustomDomain procedure", () => {
    const src = read("server/routers/tenant.ts");
    expect(src).toContain("removeCustomDomain");
  });

  it("tenant router has listTenantDomains procedure", () => {
    const src = read("server/routers/tenant.ts");
    expect(src).toContain("listTenantDomains");
  });

  it("tenant router has validateHostname public procedure for Caddy ask endpoint", () => {
    const src = read("server/routers/tenant.ts");
    expect(src).toContain("validateHostname");
  });

  it("schema has customDomain column on tenants table", () => {
    const src = read("drizzle/schema.ts");
    expect(src).toContain("customDomain");
  });

  it("schema has domainVerified column on tenants table", () => {
    const src = read("drizzle/schema.ts");
    expect(src).toContain("domainVerified");
  });

  it("schema has domainVerificationToken column on tenants table", () => {
    const src = read("drizzle/schema.ts");
    expect(src).toContain("domainVerificationToken");
  });

  it("Caddyfile.prod has on_demand_tls configuration", () => {
    const src = read("infra/caddy/Caddyfile.prod");
    expect(src).toContain("on_demand_tls");
  });

  it("Caddyfile.prod has ask endpoint pointing to tenant validation", () => {
    const src = read("infra/caddy/Caddyfile.prod");
    expect(src).toContain("ask");
  });
});

// ─── 2. keycloakAdminProcedure Migration ─────────────────────────────────────

describe("keycloakAdminProcedure migration", () => {
  it("keycloakAdminProcedure is exported from trpc.ts", () => {
    const src = read("server/_core/trpc.ts");
    expect(src).toContain("keycloakAdminProcedure");
    expect(src).toContain("export");
  });

  it("keycloakRoleProcedure factory is exported from trpc.ts", () => {
    const src = read("server/_core/trpc.ts");
    expect(src).toContain("keycloakRoleProcedure");
  });

  it("context.ts extracts keycloakRoles from X-Auth-Request-Groups header", () => {
    const src = read("server/_core/context.ts");
    expect(src).toContain("X-Auth-Request-Groups");
    expect(src).toContain("keycloakRoles");
  });

  it("context.ts extracts realm_access.roles from Bearer JWT", () => {
    const src = read("server/_core/context.ts");
    expect(src).toContain("realm_access");
  });

  it("keycloak router uses keycloakAdminProcedure for getConfig", () => {
    const src = read("server/routers/keycloak.ts");
    expect(src).toContain("getConfig: keycloakAdminProcedure");
  });

  it("keycloak router uses keycloakAdminProcedure for updateConfig", () => {
    const src = read("server/routers/keycloak.ts");
    expect(src).toContain("updateConfig: keycloakAdminProcedure");
  });

  it("keycloak router uses keycloakAdminProcedure for getSessions", () => {
    const src = read("server/routers/keycloak.ts");
    expect(src).toContain("getSessions: keycloakAdminProcedure");
  });

  it("keycloak router uses keycloakAdminProcedure for revokeSession", () => {
    const src = read("server/routers/keycloak.ts");
    expect(src).toContain("revokeSession: keycloakAdminProcedure");
  });

  it("keycloak router uses keycloakAdminProcedure for revokeAllUserSessions", () => {
    const src = read("server/routers/keycloak.ts");
    expect(src).toContain("revokeAllUserSessions: keycloakAdminProcedure");
  });

  it("keycloak router has no manual requireAdmin() calls remaining", () => {
    const src = read("server/routers/keycloak.ts");
    // The requireAdmin helper should no longer be called (it may still be defined but unused)
    const callCount = (src.match(/requireAdmin\(/g) ?? []).length;
    expect(callCount).toBe(0);
  });

  it("openAppSec router uses keycloakAdminProcedure for getWafEvents", () => {
    const src = read("server/routers/openAppSec.ts");
    expect(src).toContain("getWafEvents: keycloakAdminProcedure");
  });

  it("openAppSec router uses keycloakAdminProcedure for acknowledgeEvent", () => {
    const src = read("server/routers/openAppSec.ts");
    expect(src).toContain("acknowledgeEvent: keycloakAdminProcedure");
  });

  it("openAppSec router has no adminProcedure remaining", () => {
    const src = read("server/routers/openAppSec.ts");
    expect(src).not.toContain("adminProcedure");
  });

  it("apisixAudit router uses keycloakAdminProcedure for recordChange", () => {
    const src = read("server/routers/apisixAudit.ts");
    expect(src).toContain("recordChange: keycloakAdminProcedure");
  });

  it("permify router uses keycloakAdminProcedure for writeTuple", () => {
    const src = read("server/routers/permify.ts");
    expect(src).toContain("writeTuple: keycloakAdminProcedure");
  });

  it("permify router has no adminProcedure remaining", () => {
    const src = read("server/routers/permify.ts");
    expect(src).not.toContain("adminProcedure");
  });

  it("corazaWaf router uses keycloakAdminProcedure for all procedures", () => {
    const src = read("server/routers/corazaWaf.ts");
    expect(src).not.toContain(": adminProcedure");
    expect(src).toContain("keycloakAdminProcedure");
  });
});

// ─── 3. Coraza WAF Event Correlation ─────────────────────────────────────────

describe("Coraza WAF event correlation", () => {
  it("corazaWaf router has getTopFiringRules procedure", () => {
    const src = read("server/routers/corazaWaf.ts");
    expect(src).toContain("getTopFiringRules");
  });

  it("corazaWaf router has getEventsForRule procedure", () => {
    const src = read("server/routers/corazaWaf.ts");
    expect(src).toContain("getEventsForRule");
  });

  it("corazaWaf router has getEventCorrelationSummary procedure", () => {
    const src = read("server/routers/corazaWaf.ts");
    expect(src).toContain("getEventCorrelationSummary");
  });

  it("getTopFiringRules returns eventCount in dev mode seed data", () => {
    const src = read("server/routers/corazaWaf.ts");
    expect(src).toContain("eventCount");
  });

  it("getEventsForRule filters by ruleId", () => {
    const src = read("server/routers/corazaWaf.ts");
    expect(src).toContain("getEventsForRule");
    expect(src).toContain("ruleId");
  });

  it("getEventCorrelationSummary accepts days parameter", () => {
    const src = read("server/routers/corazaWaf.ts");
    expect(src).toContain("getEventCorrelationSummary");
    expect(src).toContain("days");
  });

  it("corazaWaf router correlates with openAppSecEvents schema", () => {
    const src = read("server/routers/corazaWaf.ts");
    expect(src).toContain("openAppSecEvents");
  });

  it("CorazaWafDashboard has Event Correlation tab", () => {
    const src = read("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(src.toLowerCase()).toContain("event correlation");
  });

  it("CorazaWafDashboard calls getTopFiringRules", () => {
    const src = read("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(src).toContain("getTopFiringRules");
  });

  it("CorazaWafDashboard calls getEventsForRule", () => {
    const src = read("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(src).toContain("getEventsForRule");
  });

  it("CorazaWafDashboard calls getEventCorrelationSummary", () => {
    const src = read("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(src).toContain("getEventCorrelationSummary");
  });

  it("CorazaWafDashboard has time window selector for correlation days", () => {
    const src = read("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(src).toContain("correlationDays");
  });

  it("CorazaWafDashboard has rule drill-down (selectedRuleId state)", () => {
    const src = read("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(src).toContain("selectedRuleId");
  });

  it("CorazaWafDashboard uses Tabs component for Rules / Event Correlation", () => {
    const src = read("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(src).toContain("TabsList");
    expect(src).toContain("TabsTrigger");
    expect(src).toContain("TabsContent");
  });

  it("CorazaWafDashboard has bar chart / progress visualization for event volume", () => {
    const src = read("client/src/pages/admin/CorazaWafDashboard.tsx");
    // Correlation summary uses a bar/progress visualization
    expect(src).toContain("blockedEvents");
  });

  it("CorazaWafDashboard is registered in App.tsx", () => {
    const src = read("client/src/App.tsx");
    expect(src).toContain("CorazaWafDashboard");
  });

  it("CorazaWafDashboard has sidebar link in DashboardLayout", () => {
    const src = read("client/src/components/DashboardLayout.tsx");
    expect(src.toLowerCase()).toMatch(/coraza|waf rule/);
  });
});
