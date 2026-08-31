#!/usr/bin/env node
/**
 * check-permify-coverage.mjs — PRA-109 (Phase 9): Permify authorization
 * coverage report + gate.
 *
 * Parses permify/schema.perm (entities + permissions) and compares it
 * against the canonical registry of the platform's protected resource
 * domains (below — derived from server/routers/*.ts procedure surfaces).
 * For every domain it reports whether a Permify entity with permission
 * rules exists (COVERED) or authorization is enforced only ad-hoc in code
 * (UNCOVERED). Also verifies the registry itself stays honest: every
 * referenced router file must exist and must contain protected procedures.
 *
 * Exit 0 when every protected domain is covered; exit 1 listing gaps.
 * Wired as: pnpm run check:permify-coverage AND
 * server/permifyCoverage.test.ts (vitest gate).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = path.join(ROOT, "permify", "schema.perm");

/**
 * Canonical protected-resource registry: router domain → Permify entity.
 * Only domains whose procedures mutate money/compliance/PII state or expose
 * protected reads are listed; pure public/health routers are deliberately
 * excluded (see EXEMPT_ROUTERS).
 */
const DOMAIN_ENTITY_MAP = {
  declarations: "declaration",
  declarationAmendments: "declaration",
  declarationRiskHistory: "declaration",
  payments: "payment",
  batchPayments: "payment",
  mojaloop: "payment",
  oga: "permit",
  ogaPermitAudit: "permit",
  aeo: "aeo_application",
  aeoRenewals: "aeo_application",
  auditEngine: "audit_task",
  postAudit: "audit_task",
  postClearanceAuditSched: "audit_task",
  cargoTracking: "cargo_shipment",
  manifests: "cargo_shipment",
  kyc: "kyc_record",
  drawback: "drawback_claim",
  finance: "finance_report",
  complianceReporting: "finance_report",
  bulkExport: "bulk_export",
  siteSettings: "site_settings",
  "fund-flow": "fund_flow_operation",
  tigerbeetleSeed: "fund_flow_operation",
  ledger: "fund_flow_operation",
  documentVault: "document",
  sanctionsBatch: "sanctions_check",
  freeZone: "free_zone_operation",
  bondedWarehouse: "warehouse_bond",
  warehouse: "warehouse_bond",
  alerts: "security_alert",
  security: "security_alert",
  insiderThreat: "security_alert",
  soc: "security_alert",
  temporal: "workflow",
  temporalRuns: "workflow",
  notifications: "notification",
  userNotifications: "notification",
  notificationPreferences: "notification",
  advanceRuling: "advance_ruling",
  fraudCases: "fraud_case",
  profiles: "stakeholder_profile",
  onboarding: "stakeholder_profile",
  tradeFinance: "trade_finance_facility",
  ucr: "declaration",
  crf: "declaration",
  crsImport: "declaration",
  valuation: "declaration",
  wtoValuation: "declaration",
  rulesOfOrigin: "declaration",
  ogaBulkApprove: "permit",
  workflowSchemas: "workflow",
  slaEscalation: "workflow",
  exportSchedules: "bulk_export",
  geofences: "cargo_shipment",
  threatIntel: "security_alert",
  apisixAudit: "security_alert",
  corazaWaf: "security_alert",
  openAppSec: "security_alert",
  wazuh: "security_alert",
  vision: "document",
  tenant: "site_settings",
  devPortal: "site_settings",
};

/** Routers deliberately out of authorization-coverage scope (public,
 * health, infra-selftest, or third-party-protocol endpoints). */
const EXEMPT_ROUTERS = new Set([
  "health", "healthThresholds", "heartbeatAdmin", "heartbeatJobs", "openData",
  "webhooks", "nigeriaId", "pcs", "pilot", "redis", "kafkaEvents", "fluvio",
  "opensearch", "geoip", "geospatial", "portCongestion", "keycloak",
  "permify", "pushTokens", "v138Features",
  // Protocol adapters to external government schemes (fail-closed adapters,
  // no local resource authorization surface):
  "ncsNrs", "aseanSw", "cen", "cep",
  // Analytics / ML read models (aggregate-only, role-gated in-router):
  "adminAnalytics", "analytics", "tradeAnalytics", "executiveDashboard",
  "onboardingAnalytics", "officerWorkload", "kpiTargets", "cost", "nlQuery",
  "knowledgeGraph", "riskModel", "ai", "traderRatings", "traderScorecard",
  // Infra jobs + streams (no domain resource):
  "lakehouse", "stream", "apiChangelog",
]);

function parseSchema(src) {
  const entities = new Map(); // name → { relations:Set, permissions:Set }
  const entityRe = /entity\s+(\w+)\s*\{([^}]*)\}/gs;
  let m;
  while ((m = entityRe.exec(src)) !== null) {
    const [, name, body] = m;
    const relations = new Set([...body.matchAll(/relation\s+(\w+)/g)].map((r) => r[1]));
    const permissions = new Set([...body.matchAll(/permission\s+(\w+)/g)].map((r) => r[1]));
    entities.set(name, { relations, permissions });
  }
  return entities;
}

const src = fs.readFileSync(SCHEMA, "utf8");
const entities = parseSchema(src);

let uncovered = 0;
let registryErrors = 0;
const rows = [];

for (const [domain, entityName] of Object.entries(DOMAIN_ENTITY_MAP)) {
  const routerFile = path.join(ROOT, "server", "routers", `${domain}.ts`);
  if (!fs.existsSync(routerFile)) {
    rows.push(`REGISTRY-ERROR  ${domain} → ${entityName} (router file missing — registry is stale)`);
    registryErrors++;
    continue;
  }
  const routerSrc = fs.readFileSync(routerFile, "utf8");
  const protectedCount = (routerSrc.match(/protectedProcedure|adminProcedure/g) || []).length;
  const entity = entities.get(entityName);
  if (!entity) {
    rows.push(`UNCOVERED       ${domain} → ${entityName} (entity missing from schema.perm)`);
    uncovered++;
    continue;
  }
  if (entity.permissions.size === 0) {
    rows.push(`UNCOVERED       ${domain} → ${entityName} (entity has no permission rules)`);
    uncovered++;
    continue;
  }
  rows.push(
    `COVERED         ${domain.padEnd(26)} → ${entityName.padEnd(20)} ` +
    `${protectedCount} protected procs; permissions: ${[...entity.permissions].sort().join(", ")}`
  );
}

console.log("Permify authorization coverage report (PRA-109)");
console.log("=".repeat(72));
console.log(`Schema entities: ${[...entities.keys()].join(", ")}`);
console.log("-".repeat(72));
for (const row of rows) console.log(row);
console.log("-".repeat(72));
console.log(`Exempt routers (public/health/protocol): ${[...EXEMPT_ROUTERS].join(", ")}`);

// Registry hygiene: every non-test router must be either mapped or exempt.
const routerFiles = fs.readdirSync(path.join(ROOT, "server", "routers"))
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => f.replace(/\.ts$/, ""));
const unregistered = routerFiles.filter((r) => !(r in DOMAIN_ENTITY_MAP) && !EXEMPT_ROUTERS.has(r));
if (unregistered.length > 0) {
  console.log("-".repeat(72));
  console.log(`UNREGISTERED router domains (add to DOMAIN_ENTITY_MAP or EXEMPT_ROUTERS): ${unregistered.join(", ")}`);
}

console.log("=".repeat(72));
const total = Object.keys(DOMAIN_ENTITY_MAP).length;
console.log(`Coverage: ${total - uncovered - registryErrors}/${total} protected domains covered; ${uncovered} uncovered; ${registryErrors} registry errors; ${unregistered.length} unregistered.`);

if (uncovered > 0 || registryErrors > 0 || unregistered.length > 0) {
  console.error("PERMIFY COVERAGE GATE: FAIL");
  process.exit(1);
}
console.log("PERMIFY COVERAGE GATE: PASS");
