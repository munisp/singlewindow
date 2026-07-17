/**
 * next-steps-v6.test.ts — Sprint v6 feature verification tests
 *
 * Covers:
 *   1. CRS dry-run preview modal (bulkImportRules accepts dryRun flag)
 *   2. Paranoia Level filter in listRules procedure
 *   3. domain_verification_events schema table + db helpers + tRPC procedures
 *   4. Domain Health tab in TenantManagement (frontend file assertions)
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), "utf-8");
}

// ─── 1. CRS Dry-Run Preview Modal ────────────────────────────────────────────

describe("CRS dry-run preview modal", () => {
  it("crsImport router accepts dryRun flag in bulkImportRules", () => {
    const content = readFile("server/routers/crsImport.ts");
    expect(content).toContain("dryRun");
  });

  it("CorazaWafDashboard renders the CRS preview modal", () => {
    const content = readFile("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(content).toContain("showCrsPreviewModal");
    expect(content).toContain("CRS Import Preview");
    expect(content).toContain("crsPreviewData");
  });

  it("CorazaWafDashboard calls bulkImportRules with dryRun:true before showing modal", () => {
    const content = readFile("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(content).toContain("dryRun: true");
    expect(content).toContain("crsDryRunMutation");
  });

  it("CorazaWafDashboard shows confirm import button that calls live import", () => {
    const content = readFile("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(content).toContain("handleConfirmCrsImport");
    expect(content).toContain("dryRun: false");
    expect(content).toContain("Confirm Import");
  });

  it("preview modal shows inserted/updated/skipped breakdown", () => {
    const content = readFile("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(content).toContain("crsPreviewData.inserted");
    expect(content).toContain("crsPreviewData.updated");
    expect(content).toContain("crsPreviewData.skipped");
    expect(content).toContain("crsPreviewData.uniqueRules");
  });

  it("preview modal shows CRS version and release name", () => {
    const content = readFile("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(content).toContain("crsPreviewData.crsVersion");
    expect(content).toContain("crsPreviewData.releaseName");
  });

  it("preview modal allows changing maxParanoiaLevel and re-runs dry-run", () => {
    const content = readFile("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(content).toContain("crsPreviewMaxPL");
    expect(content).toContain("maxParanoiaLevel");
  });
});

// ─── 2. Paranoia Level Filter ─────────────────────────────────────────────────

describe("Paranoia Level filter in Rules tab", () => {
  it("listRules procedure accepts paranoiaLevel filter", () => {
    const content = readFile("server/routers/corazaWaf.ts");
    expect(content).toContain("paranoiaLevel");
    expect(content).toContain("z.number().int().min(1).max(4)");
  });

  it("listRules applies paranoiaLevel filter to DB query", () => {
    const content = readFile("server/routers/corazaWaf.ts");
    expect(content).toContain("input?.paranoiaLevel !== undefined");
    expect(content).toContain("eq(corazaWafRules.paranoiaLevel, input.paranoiaLevel)");
  });

  it("CorazaWafDashboard renders Paranoia Level select filter", () => {
    const content = readFile("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(content).toContain("filterParanoiaLevel");
    expect(content).toContain("Paranoia Level");
    expect(content).toContain("PL 1 — Baseline");
    expect(content).toContain("PL 4 — Maximum");
  });

  it("CorazaWafDashboard passes paranoiaLevel to listRules query", () => {
    const content = readFile("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(content).toContain("paranoiaLevel: filterParanoiaLevel !== \"ALL\" ? Number(filterParanoiaLevel) : undefined");
  });

  it("Rules table shows PL column with ParanoiaLevelBadge", () => {
    const content = readFile("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(content).toContain("ParanoiaLevelBadge");
    expect(content).toContain("paranoiaLevel");
  });

  it("active filter banner appears when a PL filter is active", () => {
    const content = readFile("client/src/pages/admin/CorazaWafDashboard.tsx");
    expect(content).toContain("filterParanoiaLevel !== \"ALL\"");
    expect(content).toContain("Clear filter");
  });
});

// ─── 3. Domain Verification Events Table ─────────────────────────────────────

describe("domain_verification_events schema table", () => {
  it("schema.ts defines domainVerificationEvents table", () => {
    const content = readFile("drizzle/schema.ts");
    expect(content).toContain("domainVerificationEvents");
    expect(content).toContain("domain_verification_events");
  });

  it("schema.ts defines domain_verification_outcome enum", () => {
    const content = readFile("drizzle/schema.ts");
    expect(content).toContain("domainVerificationOutcomeEnum");
    expect(content).toContain("domain_verification_outcome");
    expect(content).toContain("\"success\"");
    expect(content).toContain("\"failure\"");
    expect(content).toContain("\"error\"");
  });

  it("schema.ts has tenant_id FK with cascade delete", () => {
    const content = readFile("drizzle/schema.ts");
    expect(content).toContain("onDelete: \"cascade\"");
  });

  it("schema.ts has indexes on tenant_id, domain, created_at, outcome", () => {
    const content = readFile("drizzle/schema.ts");
    expect(content).toContain("idx_dve_tenant_id");
    expect(content).toContain("idx_dve_domain");
    expect(content).toContain("idx_dve_created_at");
    expect(content).toContain("idx_dve_outcome");
  });

  it("migration 0048 creates domain_verification_events table", () => {
    const files = fs.readdirSync(path.join(root, "drizzle/migrations"));
    const migration0048 = files.find(f => f.startsWith("0048_"));
    expect(migration0048).toBeTruthy();
    const content = readFile(`drizzle/migrations/${migration0048}`);
    expect(content).toContain("domain_verification_events");
    expect(content).toContain("domain_verification_outcome");
  });
});

describe("domain verification event db helpers", () => {
  it("db.ts exports logDomainVerificationEvent", () => {
    const content = readFile("server/db.ts");
    expect(content).toContain("export async function logDomainVerificationEvent");
  });

  it("db.ts exports getDomainVerificationHistory", () => {
    const content = readFile("server/db.ts");
    expect(content).toContain("export async function getDomainVerificationHistory");
  });

  it("db.ts exports getDomainHealthSummary", () => {
    const content = readFile("server/db.ts");
    expect(content).toContain("export async function getDomainHealthSummary");
  });

  it("getDomainHealthSummary returns successRate, lastOutcome, lastCheckedAt", () => {
    const content = readFile("server/db.ts");
    expect(content).toContain("successRate");
    expect(content).toContain("lastOutcome");
    expect(content).toContain("lastCheckedAt");
  });
});

describe("tenant domain poller logs verification events", () => {
  it("poller imports logDomainVerificationEvent", () => {
    const content = readFile("server/scheduled/tenantDomainPoller.ts");
    expect(content).toContain("logDomainVerificationEvent");
  });

  it("poller logs success event on verified domain", () => {
    const content = readFile("server/scheduled/tenantDomainPoller.ts");
    // Success branch should call logDomainVerificationEvent with "success"
    expect(content).toContain("logDomainVerificationEvent(tenant.id, domain, \"success\")");
  });

  it("poller logs failure event on token mismatch", () => {
    const content = readFile("server/scheduled/tenantDomainPoller.ts");
    expect(content).toContain("\"TOKEN_MISMATCH\"");
    expect(content).toContain("logDomainVerificationEvent(tenant.id, domain, \"failure\"");
  });

  it("poller logs failure event on expected DNS errors (ENOTFOUND etc)", () => {
    const content = readFile("server/scheduled/tenantDomainPoller.ts");
    expect(content).toContain("DNS_LOOKUP_FAILED");
  });

  it("poller logs error event on unexpected DNS errors", () => {
    const content = readFile("server/scheduled/tenantDomainPoller.ts");
    expect(content).toContain("UNEXPECTED_ERROR");
    expect(content).toContain("logDomainVerificationEvent(tenant.id, domain, \"error\"");
  });
});

describe("tenant tRPC procedures for domain health", () => {
  it("tenant router exports getDomainVerificationHistory procedure", () => {
    const content = readFile("server/routers/tenant.ts");
    expect(content).toContain("getDomainVerificationHistory");
  });

  it("tenant router exports getDomainHealthSummary procedure", () => {
    const content = readFile("server/routers/tenant.ts");
    expect(content).toContain("getDomainHealthSummary");
  });

  it("tenant router imports getDomainVerificationHistory and getDomainHealthSummary from db", () => {
    const content = readFile("server/routers/tenant.ts");
    expect(content).toContain("import { getDomainVerificationHistory, getDomainHealthSummary } from \"../db\"");
  });
});

// ─── 4. Domain Health Tab in TenantManagement ─────────────────────────────────

describe("Domain Health tab in TenantManagement", () => {
  it("TenantManagement renders Domain Health tab trigger", () => {
    const content = readFile("client/src/pages/app/TenantManagement.tsx");
    expect(content).toContain("domain-health");
    expect(content).toContain("Domain Health");
  });

  it("Domain Health tab shows health summary cards", () => {
    const content = readFile("client/src/pages/app/TenantManagement.tsx");
    expect(content).toContain("domainHealthSummary");
    expect(content).toContain("successRate");
    expect(content).toContain("lastOutcome");
    expect(content).toContain("lastCheckedAt");
  });

  it("Domain Health tab shows event history table with outcome badges", () => {
    const content = readFile("client/src/pages/app/TenantManagement.tsx");
    expect(content).toContain("domainHealthHistory");
    expect(content).toContain("event.outcome");
    expect(content).toContain("event.errorCode");
    expect(content).toContain("event.detail");
  });

  it("Domain Health tab has tenant selector for tenants with custom domains", () => {
    const content = readFile("client/src/pages/app/TenantManagement.tsx");
    expect(content).toContain("healthTenantId");
    expect(content).toContain("Select Tenant");
    expect(content).toContain("r.customDomain");
  });

  it("TenantManagement queries getDomainVerificationHistory and getDomainHealthSummary", () => {
    const content = readFile("client/src/pages/app/TenantManagement.tsx");
    expect(content).toContain("trpc.tenant.getDomainVerificationHistory.useQuery");
    expect(content).toContain("trpc.tenant.getDomainHealthSummary.useQuery");
  });

  it("Domain Health tab imports HeartPulse icon", () => {
    const content = readFile("client/src/pages/app/TenantManagement.tsx");
    expect(content).toContain("HeartPulse");
  });
});
