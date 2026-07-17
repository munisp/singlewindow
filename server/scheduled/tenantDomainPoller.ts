// tenantDomainPoller.ts — Heartbeat handler for auto-verifying pending tenant custom domains.
// Runs every 15 minutes via project-level Heartbeat cron.
// For each tenant with a registered but unverified custom domain, performs a DNS TXT lookup
// for _ngswtp-verify.<domain>. If the expected token is found, marks the domain as verified.
//
// Cron creation (run after deploying the site):
//   manus-heartbeat create --name tenant-domain-poller
//     --cron "0 */15 * * * *" --path /api/scheduled/tenant-domain-poll
//     --description "Auto-verify pending tenant custom domains every 15 minutes"

import type { Request, Response } from "express";
import dns from "node:dns/promises";
import { sdk } from "../_core/sdk";
import * as db from "../db";

export async function tenantDomainPollerHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) {
      return res.status(403).json({ error: "cron-only endpoint" });
    }

    if (process.env.NODE_ENV !== "production") {
      // In dev/test: return a dry-run result without touching DNS
      return res.json({
        ok: true,
        mode: "dry-run",
        checked: 0,
        verified: 0,
        failed: 0,
        message: "DNS polling skipped in non-production environment",
      });
    }

    // Fetch all tenants with a pending custom domain
    const pendingTenants = await db.getTenantsWithPendingDomain();

    let verified = 0;
    let failed = 0;
    const results: Array<{ tenantId: string; domain: string; status: "verified" | "pending" | "error"; reason?: string }> = [];

    for (const tenant of pendingTenants) {
      const domain = tenant.customDomain!;
      const expectedToken = tenant.domainVerificationToken!;
      const verifyHost = `_ngswtp-verify.${domain}`;

      try {
        const records = await dns.resolveTxt(verifyHost);
        const flat = records.flat();
        const found = flat.some(r => r === expectedToken);

        if (found) {
          await db.markTenantDomainVerified(tenant.id);
          verified++;
          results.push({ tenantId: String(tenant.id), domain, status: "verified" });
          console.log(`[TenantDomainPoller] Verified domain ${domain} for tenant ${tenant.id}`);
        } else {
          results.push({ tenantId: String(tenant.id), domain, status: "pending", reason: "TXT record not found or token mismatch" });
        }
      } catch (dnsErr: any) {
        // ENOTFOUND / ENODATA are expected for unverified domains — not an error
        const isExpected = ["ENOTFOUND", "ENODATA", "ESERVFAIL"].includes(dnsErr.code);
        if (isExpected) {
          results.push({ tenantId: String(tenant.id), domain, status: "pending", reason: `DNS: ${dnsErr.code}` });
        } else {
          failed++;
          results.push({ tenantId: String(tenant.id), domain, status: "error", reason: String(dnsErr) });
          console.error(`[TenantDomainPoller] DNS error for ${domain}:`, dnsErr);
        }
      }
    }

    console.log(`[TenantDomainPoller] Checked ${pendingTenants.length}, verified ${verified}, failed ${failed}`);
    return res.json({
      ok: true,
      checked: pendingTenants.length,
      verified,
      failed,
      results,
    });
  } catch (err: any) {
    console.error("[TenantDomainPoller] Fatal error:", err);
    return res.status(500).json({
      error: String(err?.message ?? err),
      stack: err?.stack,
      context: { url: req.url, taskUid: (req as any).user?.taskUid },
      timestamp: new Date().toISOString(),
    });
  }
}
