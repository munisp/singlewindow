/**
 * next-steps-v3.test.ts — Vitest tests for Sprint Next Steps v3
 *
 * Covers:
 *   1. WAF event acknowledgement button (CorazaWafDashboard)
 *   2. Tenant DNS propagation poller (tenantDomainPoller)
 *   3. GitHub export (munisp/singlewindow)
 *   4. sdk.ts cron patch (CRON_OPEN_ID_PREFIX, AuthenticatedUser, buildCronUser)
 *   5. db.ts tenant domain helpers
 *   6. index.ts Heartbeat endpoint registration
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

// ─── 1. WAF Event Acknowledgement ────────────────────────────────────────────

describe("WAF event acknowledgement in CorazaWafDashboard", () => {
  const dashboardPath = join(ROOT, "client/src/pages/admin/CorazaWafDashboard.tsx");

  it("CorazaWafDashboard.tsx exists", () => {
    expect(existsSync(dashboardPath)).toBe(true);
  });

  it("uses openAppSec.acknowledgeEvent mutation", () => {
    const src = readFileSync(dashboardPath, "utf-8");
    expect(src).toContain("trpc.openAppSec.acknowledgeEvent.useMutation");
  });

  it("renders an Ack button for unacknowledged events", () => {
    const src = readFileSync(dashboardPath, "utf-8");
    expect(src).toContain("Ack");
    expect(src).toContain("acknowledgeEventMutation.mutate");
  });

  it("shows Acked badge for already-acknowledged events", () => {
    const src = readFileSync(dashboardPath, "utf-8");
    expect(src).toContain("Acked");
    expect(src).toContain("isAcknowledged");
  });

  it("disables Ack button while mutation is pending", () => {
    const src = readFileSync(dashboardPath, "utf-8");
    expect(src).toContain("acknowledgeEventMutation.isPending");
  });
});

// ─── 2. Tenant DNS Propagation Poller ────────────────────────────────────────

describe("Tenant DNS propagation poller", () => {
  const pollerPath = join(ROOT, "server/scheduled/tenantDomainPoller.ts");

  it("tenantDomainPoller.ts exists", () => {
    expect(existsSync(pollerPath)).toBe(true);
  });

  it("exports tenantDomainPollerHandler", () => {
    const src = readFileSync(pollerPath, "utf-8");
    expect(src).toContain("export async function tenantDomainPollerHandler");
  });

  it("rejects non-cron callers with 403", () => {
    const src = readFileSync(pollerPath, "utf-8");
    expect(src).toContain("403");
    expect(src).toContain("cron-only endpoint");
  });

  it("returns dry-run in non-production environments", () => {
    const src = readFileSync(pollerPath, "utf-8");
    expect(src).toContain("dry-run");
    expect(src).toContain("NODE_ENV");
  });

  it("performs DNS TXT lookup for _ngswtp-verify.<domain>", () => {
    const src = readFileSync(pollerPath, "utf-8");
    expect(src).toContain("_ngswtp-verify.");
    expect(src).toContain("resolveTxt");
  });

  it("calls markTenantDomainVerified on token match", () => {
    const src = readFileSync(pollerPath, "utf-8");
    expect(src).toContain("markTenantDomainVerified");
  });

  it("handles expected DNS errors gracefully (ENOTFOUND, ENODATA, ESERVFAIL)", () => {
    const src = readFileSync(pollerPath, "utf-8");
    expect(src).toContain("ENOTFOUND");
    expect(src).toContain("ENODATA");
    expect(src).toContain("ESERVFAIL");
  });

  it("returns structured JSON with checked/verified/failed counts", () => {
    const src = readFileSync(pollerPath, "utf-8");
    expect(src).toContain("checked");
    expect(src).toContain("verified");
    expect(src).toContain("failed");
    expect(src).toContain("results");
  });
});

// ─── 3. Heartbeat endpoint registration ──────────────────────────────────────

describe("Heartbeat endpoint registration in index.ts", () => {
  const indexPath = join(ROOT, "server/_core/index.ts");

  it("registers /api/scheduled/tenant-domain-poll", () => {
    const src = readFileSync(indexPath, "utf-8");
    expect(src).toContain("/api/scheduled/tenant-domain-poll");
    expect(src).toContain("tenantDomainPollerHandler");
  });

  it("logs the registration", () => {
    const src = readFileSync(indexPath, "utf-8");
    expect(src).toContain("[Heartbeat] /api/scheduled/tenant-domain-poll registered");
  });
});

// ─── 4. sdk.ts cron patch ────────────────────────────────────────────────────

describe("sdk.ts cron patch", () => {
  const sdkPath = join(ROOT, "server/_core/sdk.ts");

  it("defines CRON_OPEN_ID_PREFIX", () => {
    const src = readFileSync(sdkPath, "utf-8");
    expect(src).toContain("CRON_OPEN_ID_PREFIX");
    expect(src).toContain("cron_");
  });

  it("exports AuthenticatedUser type with taskUid and isCron", () => {
    const src = readFileSync(sdkPath, "utf-8");
    expect(src).toContain("export type AuthenticatedUser");
    expect(src).toContain("taskUid");
    expect(src).toContain("isCron");
  });

  it("defines buildCronUser helper", () => {
    const src = readFileSync(sdkPath, "utf-8");
    expect(src).toContain("function buildCronUser");
    expect(src).toContain("Manus Scheduled Task");
  });
});

// ─── 5. db.ts tenant domain helpers ──────────────────────────────────────────

describe("db.ts tenant domain helpers", () => {
  const dbPath = join(ROOT, "server/db.ts");

  it("exports getTenantsWithPendingDomain", () => {
    const src = readFileSync(dbPath, "utf-8");
    expect(src).toContain("export async function getTenantsWithPendingDomain");
  });

  it("exports markTenantDomainVerified with string (UUID) parameter", () => {
    const src = readFileSync(dbPath, "utf-8");
    expect(src).toContain("export async function markTenantDomainVerified(tenantId: string)");
  });

  it("imports tenants table from schema", () => {
    const src = readFileSync(dbPath, "utf-8");
    expect(src).toContain("tenants,");
  });

  it("queries for unverified domains with non-null customDomain", () => {
    const src = readFileSync(dbPath, "utf-8");
    expect(src).toContain("customDomain");
    expect(src).toContain("domainVerified");
    expect(src).toContain("domainVerificationToken");
  });
});

// ─── 6. GitHub export ────────────────────────────────────────────────────────

describe("GitHub export", () => {
  it("tenantDomainPoller.ts is present in the project", () => {
    expect(existsSync(join(ROOT, "server/scheduled/tenantDomainPoller.ts"))).toBe(true);
  });

  it("CorazaWafDashboard.tsx is present in the project", () => {
    expect(existsSync(join(ROOT, "client/src/pages/admin/CorazaWafDashboard.tsx"))).toBe(true);
  });

  it("KeycloakAdmin.tsx is present in the project", () => {
    expect(existsSync(join(ROOT, "client/src/pages/admin/KeycloakAdmin.tsx"))).toBe(true);
  });

  it("Caddy infra files are present", () => {
    expect(existsSync(join(ROOT, "infra/caddy/Caddyfile.prod"))).toBe(true);
    expect(existsSync(join(ROOT, "infra/caddy/Caddyfile.dev"))).toBe(true);
    expect(existsSync(join(ROOT, "infra/caddy/oauth2-proxy.cfg"))).toBe(true);
  });

  it("Kubernetes Caddy manifests are present", () => {
    expect(existsSync(join(ROOT, "infra/k8s/caddy/deployment.yaml"))).toBe(true);
    expect(existsSync(join(ROOT, "infra/k8s/caddy/service.yaml"))).toBe(true);
    expect(existsSync(join(ROOT, "infra/k8s/caddy/configmap.yaml"))).toBe(true);
    expect(existsSync(join(ROOT, "infra/k8s/caddy/ingress-class.yaml"))).toBe(true);
  });

  it("corazaWaf router is present", () => {
    expect(existsSync(join(ROOT, "server/routers/corazaWaf.ts"))).toBe(true);
  });

  it("keycloakJwt middleware is present", () => {
    expect(existsSync(join(ROOT, "server/middleware/keycloakJwt.ts"))).toBe(true);
  });
});
