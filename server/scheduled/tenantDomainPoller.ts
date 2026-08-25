// tenantDomainPoller.ts — Heartbeat handler for auto-verifying pending tenant custom domains.
// Runs every 15 minutes via project-level Heartbeat cron.
//
// For each tenant with a registered but unverified custom domain:
//   1. Performs a DNS TXT lookup for _ngswtp-verify.<domain>.
//   2. If the expected token is found → marks domain as verified and resets fail count.
//   3. If not found → increments domainVerificationFailCount.
//      At 3 consecutive failures → sends an owner notification via notifyOwner().
//
// Cron creation (run after deploying the site):
//   manus-heartbeat create --name tenant-domain-poller
//     --cron "0 */15 * * * *" --path /api/scheduled/tenant-domain-poll
//     --description "Auto-verify pending tenant custom domains every 15 minutes"

import type { Request, Response } from "express";
import dns from "node:dns/promises";
import { sdk } from "../_core/sdk";
import { notifyOwner } from "../_core/notification";
import * as db from "../db";
import { logDomainVerificationEvent } from "../db";

/** Number of consecutive DNS failures before an owner notification is sent. */
const FAIL_THRESHOLD = 3;

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
        notified: 0,
        message: "DNS polling skipped in non-production environment",
      });
    }

    // Fetch all tenants with a pending custom domain
    const pendingTenants = await db.getTenantsWithPendingDomain();

    let verified = 0;
    let failed = 0;
    let notified = 0;
    const results: Array<{
      tenantId: string;
      domain: string;
      status: "verified" | "pending" | "error";
      failCount?: number;
      notificationSent?: boolean;
      reason?: string;
    }> = [];

    for (const tenant of pendingTenants) {
      const domain = tenant.customDomain!;
      const expectedToken = tenant.domainVerificationToken!;
      const verifyHost = `_ngswtp-verify.${domain}`;

      try {
        const records = await dns.resolveTxt(verifyHost);
        const flat = records.flat();
        const found = flat.some(r => r === expectedToken);

        if (found) {
          // ── Verified ─────────────────────────────────────────────────────
          await db.markTenantDomainVerified(tenant.id);
          await db.resetTenantDomainFailCount(tenant.id);
          await logDomainVerificationEvent(tenant.id, domain, "success");
          verified++;
          results.push({ tenantId: String(tenant.id), domain, status: "verified" });
          console.log(`[TenantDomainPoller] Verified domain ${domain} for tenant ${tenant.id}`);
        } else {
          // ── TXT record present but token mismatch ─────────────────────────
          const updated = await db.incrementTenantDomainFailCount(tenant.id);
          const newFailCount = updated?.domainVerificationFailCount ?? 0;
          let notificationSent = false;

          if (newFailCount >= FAIL_THRESHOLD) {
            // Send owner notification on reaching the threshold (and every THRESHOLD thereafter)
            if (newFailCount % FAIL_THRESHOLD === 0) {
              const sent = await notifyOwner({
                title: `⚠️ Tenant domain verification failing: ${domain}`,
                content: [
                  `Tenant **${tenant.name}** (ID: ${tenant.id}) has failed DNS verification`,
                  `for custom domain **${domain}** for ${newFailCount} consecutive polling cycles.`,
                  ``,
                  `**Verification host:** \`${verifyHost}\``,
                  `**Expected TXT token:** \`${expectedToken}\``,
                  ``,
                  `If the domain is not verified soon, Caddy will stop renewing its TLS certificate.`,
                  `Please contact the tenant or remove the domain to prevent certificate expiry.`,
                ].join("\n"),
              });
              notificationSent = sent;
              if (sent) notified++;
              console.warn(
                `[TenantDomainPoller] Sent failure notification for ${domain} (failCount=${newFailCount})`
              );
            }
          }

          await logDomainVerificationEvent(tenant.id, domain, "failure", "TOKEN_MISMATCH", "TXT record found but token mismatch");
          failed++;
          results.push({
            tenantId: String(tenant.id),
            domain,
            status: "pending",
            failCount: newFailCount,
            notificationSent,
            reason: "TXT record found but token mismatch",
          });
        }
      } catch (dnsErr: any) {
        // ENOTFOUND / ENODATA are expected for unverified domains — increment fail count
        const errorCode = typeof dnsErr.code === "string" && dnsErr.code.length > 0
          ? dnsErr.code
          : "DNS_LOOKUP_FAILED";
        const isExpected = ["ENOTFOUND", "ENODATA", "ESERVFAIL"].includes(errorCode);

        const updated = await db.incrementTenantDomainFailCount(tenant.id);
        const newFailCount = updated?.domainVerificationFailCount ?? 0;
        let notificationSent = false;

        if (newFailCount >= FAIL_THRESHOLD && newFailCount % FAIL_THRESHOLD === 0) {
          const sent = await notifyOwner({
            title: `⚠️ Tenant domain DNS lookup failing: ${domain}`,
            content: [
              `Tenant **${tenant.name}** (ID: ${tenant.id}) has had ${newFailCount} consecutive`,
              `DNS lookup failures for custom domain **${domain}**.`,
              ``,
              `**DNS error code:** \`${errorCode}\``,
              `**Verification host:** \`${verifyHost}\``,
              ``,
              `This may indicate the domain no longer resolves or has been removed from DNS.`,
              `Caddy will stop renewing the TLS certificate if verification continues to fail.`,
            ].join("\n"),
          });
          notificationSent = sent;
          if (sent) notified++;
          console.warn(
            `[TenantDomainPoller] Sent DNS error notification for ${domain} (${errorCode}, failCount=${newFailCount})`
          );
        }

        if (isExpected) {
          await logDomainVerificationEvent(tenant.id, domain, "failure", errorCode, `DNS lookup failed: ${errorCode}`);
          results.push({
            tenantId: String(tenant.id),
            domain,
            status: "pending",
            failCount: newFailCount,
            notificationSent,
            reason: `DNS: ${errorCode}`,
          });
        } else {
          await logDomainVerificationEvent(tenant.id, domain, "error", errorCode, String(dnsErr).slice(0, 512));
          failed++;
          results.push({
            tenantId: String(tenant.id),
            domain,
            status: "error",
            failCount: newFailCount,
            notificationSent,
            reason: String(dnsErr),
          });
          console.error(`[TenantDomainPoller] Unexpected DNS error for ${domain}:`, dnsErr);
        }
      }
    }

    console.log(
      `[TenantDomainPoller] Checked ${pendingTenants.length}, verified ${verified}, ` +
      `failed ${failed}, notifications sent ${notified}`
    );

    return res.json({
      ok: true,
      checked: pendingTenants.length,
      verified,
      failed,
      notified,
      results,
    });
  } catch (err: any) {
    console.error("[TenantDomainPoller] Fatal error:", err);
    return res.status(500).json({
      error: String(err?.message ?? err),
      stack: err?.stack,
      context: { url: req.url },
      timestamp: new Date().toISOString(),
    });
  }
}
