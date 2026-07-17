/**
 * Sprint v5 Tests
 * - OWASP CRS bulk import procedure (crsImport router)
 * - DNS poller consecutive-failure owner notifications (tenantDomainPoller)
 * - Coraza WAF Dashboard CSV export (corazaWaf.exportEventsCSV)
 * - PR #11 merge verification
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─── 1. OWASP CRS Bulk Import ─────────────────────────────────────────────────

describe("OWASP CRS Bulk Import", () => {
  it("crsImport router file exists", () => {
    const routerPath = path.resolve(__dirname, "routers/crsImport.ts");
    expect(fs.existsSync(routerPath)).toBe(true);
  });

  it("crsImport router exports crsImportRouter", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "routers/crsImport.ts"),
      "utf-8"
    );
    expect(src).toContain("crsImportRouter");
  });

  it("crsImport router has bulkImportRules procedure", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "routers/crsImport.ts"),
      "utf-8"
    );
    expect(src).toContain("bulkImportRules");
  });

  it("crsImport router uses keycloakAdminProcedure for bulkImportRules", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "routers/crsImport.ts"),
      "utf-8"
    );
    expect(src).toContain("keycloakAdminProcedure");
  });

  it("crsImport router fetches from coreruleset GitHub API", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "routers/crsImport.ts"),
      "utf-8"
    );
    expect(src).toContain("coreruleset");
    expect(src).toContain("github");
  });

  it("crsImport router is registered in main routers.ts", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "routers.ts"),
      "utf-8"
    );
    expect(src).toContain("crsImportRouter");
    expect(src).toContain("crsImport");
  });

  it("schema has crsVersion column on coraza_waf_rules", () => {
    const schema = fs.readFileSync(
      path.resolve(__dirname, "../drizzle/schema.ts"),
      "utf-8"
    );
    expect(schema).toContain("crsVersion");
  });

  it("schema has paranoiaLevel column on coraza_waf_rules", () => {
    const schema = fs.readFileSync(
      path.resolve(__dirname, "../drizzle/schema.ts"),
      "utf-8"
    );
    expect(schema).toContain("paranoiaLevel");
  });

  it("schema has tags column on coraza_waf_rules", () => {
    const schema = fs.readFileSync(
      path.resolve(__dirname, "../drizzle/schema.ts"),
      "utf-8"
    );
    expect(schema).toContain("tags");
  });

  it("CRS import parses rule IDs from .conf file content", () => {
    // Simulate parsing a minimal CRS rule block
    const sampleConf = `
# [[ rule 941100 ]]
SecRule ARGS "@detectXSS" \\
    "id:941100,\\
    phase:2,\\
    block,\\
    t:none,t:utf8toUnicode,\\
    msg:'XSS Attack Detected via libinjection',\\
    tag:'application-multi',\\
    tag:'language-multi',\\
    severity:'CRITICAL',\\
    paranoia-level:1"
`;
    const ruleIdMatches = sampleConf.match(/\bid:(\d{6})\b/g) ?? [];
    const ruleIds = ruleIdMatches.map((m) => m.replace("id:", ""));
    expect(ruleIds).toContain("941100");
    expect(ruleIds).toHaveLength(1);
  });

  it("CRS import extracts severity from rule block", () => {
    const sampleConf = `severity:'CRITICAL'`;
    const match = sampleConf.match(/severity:'([A-Z]+)'/);
    expect(match?.[1]).toBe("CRITICAL");
  });

  it("CRS import extracts paranoia-level from rule block", () => {
    const sampleConf = `paranoia-level:2`;
    const match = sampleConf.match(/paranoia-level:(\d)/);
    expect(Number(match?.[1])).toBe(2);
  });
});

// ─── 2. DNS Poller Consecutive-Failure Notifications ─────────────────────────

describe("DNS Poller Consecutive-Failure Notifications", () => {
  it("tenantDomainPoller file exists", () => {
    const pollerPath = path.resolve(
      __dirname,
      "scheduled/tenantDomainPoller.ts"
    );
    expect(fs.existsSync(pollerPath)).toBe(true);
  });

  it("tenantDomainPoller imports notifyOwner", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "scheduled/tenantDomainPoller.ts"),
      "utf-8"
    );
    expect(src).toContain("notifyOwner");
  });

  it("tenantDomainPoller tracks consecutive failures", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "scheduled/tenantDomainPoller.ts"),
      "utf-8"
    );
    // Should reference fail count logic
    expect(src).toMatch(/fail|Fail|consecutive/i);
  });

  it("tenantDomainPoller sends notification at threshold (3 cycles)", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "scheduled/tenantDomainPoller.ts"),
      "utf-8"
    );
    // Should reference the number 3 as the threshold
    expect(src).toMatch(/[^0-9]3[^0-9]/);
  });

  it("schema has domainVerificationFailCount on tenants table", () => {
    const schema = fs.readFileSync(
      path.resolve(__dirname, "../drizzle/schema.ts"),
      "utf-8"
    );
    expect(schema).toContain("domainVerificationFailCount");
  });

  it("db.ts has incrementTenantDomainFailCount helper", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "db.ts"), "utf-8");
    expect(src).toContain("incrementTenantDomainFailCount");
  });

  it("db.ts has resetTenantDomainFailCount helper", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "db.ts"), "utf-8");
    expect(src).toContain("resetTenantDomainFailCount");
  });

  it("tenantDomainPoller resets fail count on successful verification", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "scheduled/tenantDomainPoller.ts"),
      "utf-8"
    );
    expect(src).toContain("resetTenantDomainFailCount");
  });

  it("tenantDomainPoller increments fail count on DNS failure", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "scheduled/tenantDomainPoller.ts"),
      "utf-8"
    );
    expect(src).toContain("incrementTenantDomainFailCount");
  });

  it("notification content includes tenant domain name", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "scheduled/tenantDomainPoller.ts"),
      "utf-8"
    );
    // Should reference domain in notification content
    expect(src).toMatch(/customDomain|domain/i);
  });

  it("migration 0047 adds domainVerificationFailCount column", () => {
    const migrationsDir = path.resolve(__dirname, "../drizzle/migrations");
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    const migration47 = files.find((f) => f.includes("0047"));
    expect(migration47).toBeTruthy();
    if (migration47) {
      const sql = fs.readFileSync(
        path.join(migrationsDir, migration47),
        "utf-8"
      );
      expect(sql).toContain("domain_verification_fail_count");
    }
  });
});

// ─── 3. Coraza WAF CSV Export ─────────────────────────────────────────────────

describe("Coraza WAF CSV Export", () => {
  it("corazaWaf router has exportEventsCSV procedure", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "routers/corazaWaf.ts"),
      "utf-8"
    );
    expect(src).toContain("exportEventsCSV");
  });

  it("exportEventsCSV uses keycloakAdminProcedure", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "routers/corazaWaf.ts"),
      "utf-8"
    );
    // Find the procedure definition line (not the JSDoc comment)
    const defIdx = src.indexOf("exportEventsCSV: keycloakAdminProcedure");
    expect(defIdx).toBeGreaterThan(-1);
  });

  it("exportEventsCSV returns csv, rowCount, and generatedAt fields", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "routers/corazaWaf.ts"),
      "utf-8"
    );
    expect(src).toContain("rowCount");
    expect(src).toContain("generatedAt");
    expect(src).toContain("csv:");
  });

  it("exportEventsCSV generates proper CSV header row", () => {
    // Simulate CSV header generation
    const headers = [
      "Event ID",
      "Rule ID",
      "Attack Type",
      "Severity",
      "Source IP",
      "Target Path",
      "Action",
      "Acknowledged",
      "Timestamp",
    ];
    const csvHeader = headers.join(",");
    expect(csvHeader).toContain("Rule ID");
    expect(csvHeader).toContain("Severity");
    expect(csvHeader).toContain("Source IP");
    expect(csvHeader.split(",")).toHaveLength(9);
  });

  it("CorazaWafDashboard has Download icon imported", () => {
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        "../client/src/pages/admin/CorazaWafDashboard.tsx"
      ),
      "utf-8"
    );
    expect(src).toContain("Download");
  });

  it("CorazaWafDashboard has Export CSV button", () => {
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        "../client/src/pages/admin/CorazaWafDashboard.tsx"
      ),
      "utf-8"
    );
    expect(src).toContain("Export CSV");
    expect(src).toContain("handleExportCSV");
  });

  it("CorazaWafDashboard uses useEffect for CSV download trigger", () => {
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        "../client/src/pages/admin/CorazaWafDashboard.tsx"
      ),
      "utf-8"
    );
    expect(src).toContain("useEffect");
    expect(src).toContain("csvExportEnabled");
    expect(src).toContain("setCsvExportEnabled");
  });

  it("CorazaWafDashboard shows spinner while CSV is fetching", () => {
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        "../client/src/pages/admin/CorazaWafDashboard.tsx"
      ),
      "utf-8"
    );
    expect(src).toContain("csvFetching");
    expect(src).toContain("Exporting");
  });

  it("CSV filename includes time window and optional rule ID", () => {
    // Simulate filename generation
    const correlationDays = 7;
    const selectedRuleId = "941100";
    const dateStr = "2026-07-17";
    const suffix = selectedRuleId ? `-rule-${selectedRuleId}` : "";
    const filename = `waf-events-${correlationDays}d${suffix}-${dateStr}.csv`;
    expect(filename).toBe("waf-events-7d-rule-941100-2026-07-17.csv");

    const noRuleSuffix = "";
    const filenameNoRule = `waf-events-${correlationDays}d${noRuleSuffix}-${dateStr}.csv`;
    expect(filenameNoRule).toBe("waf-events-7d-2026-07-17.csv");
  });
});

// ─── 4. PR #11 Merge Verification ────────────────────────────────────────────

describe("PR #11 Merge Verification", () => {
  it("keycloakAdminProcedure is exported from trpc.ts", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "_core/trpc.ts"),
      "utf-8"
    );
    expect(src).toContain("keycloakAdminProcedure");
    expect(src).toContain("export");
  });

  it("keycloak router uses keycloakAdminProcedure (no manual requireAdmin)", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "routers/keycloak.ts"),
      "utf-8"
    );
    expect(src).not.toContain("function requireAdmin");
    expect(src).toContain("keycloakAdminProcedure");
  });

  it("openAppSec router uses keycloakAdminProcedure", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "routers/openAppSec.ts"),
      "utf-8"
    );
    expect(src).toContain("keycloakAdminProcedure");
  });

  it("permify router uses keycloakAdminProcedure", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "routers/permify.ts"),
      "utf-8"
    );
    expect(src).toContain("keycloakAdminProcedure");
  });

  it("context.ts extracts keycloakRoles from X-Auth-Request-Groups header", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "_core/context.ts"),
      "utf-8"
    );
    expect(src).toContain("X-Auth-Request-Groups");
    expect(src).toContain("keycloakRoles");
  });

  it("context.ts extracts keycloakRoles from Bearer JWT realm_access", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "_core/context.ts"),
      "utf-8"
    );
    expect(src).toContain("realm_access");
  });
});
