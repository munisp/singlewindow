/**
 * digestEmail.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends the Executive Dashboard daily digest as a formatted HTML email via
 * Nodemailer + SendGrid SMTP.
 *
 * Configuration (all optional — gracefully skipped if not set):
 *   SENDGRID_API_KEY   — SendGrid API key (starts with "SG.")
 *   DIGEST_FROM_EMAIL  — Sender address (default: noreply@tradegateway.ng)
 *   DIGEST_RECIPIENTS  — Comma-separated recipient list
 *
 * If SENDGRID_API_KEY or DIGEST_RECIPIENTS is not set, the function returns
 * { sent: false, reason: "..." } without throwing, so the cron job is never
 * blocked by missing email config.
 */

import nodemailer from "nodemailer";
import type { ExecDigestResult } from "../jobs/execDigest";

// ── Config ────────────────────────────────────────────────────────────────────

function getEmailConfig() {
  const apiKey     = process.env.SENDGRID_API_KEY ?? "";
  const fromEmail  = process.env.DIGEST_FROM_EMAIL ?? "noreply@tradegateway.ng";
  const recipients = (process.env.DIGEST_RECIPIENTS ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return { apiKey, fromEmail, recipients };
}

// ── HTML template ─────────────────────────────────────────────────────────────

function buildHtml(result: ExecDigestResult): string {
  const fmt = (n: number) => n.toLocaleString("en-NG");
  const fmtNaira = (n: number) =>
    n >= 1_000_000_000
      ? `₦${(n / 1_000_000_000).toFixed(2)}B`
      : n >= 1_000_000
      ? `₦${(n / 1_000_000).toFixed(1)}M`
      : `₦${fmt(Math.round(n))}`;

  const totalDecls = result.totalDeclarations;
  const greenPct   = totalDecls > 0 ? Math.round((result.greenLane  / totalDecls) * 100) : 0;
  const yellowPct  = totalDecls > 0 ? Math.round((result.yellowLane / totalDecls) * 100) : 0;
  const redPct     = totalDecls > 0 ? Math.round((result.redLane    / totalDecls) * 100) : 0;

  const pilotSection = (result.pilotGreenPct !== null || result.pilotAvgClearanceHours !== null)
    ? `
      <tr><td colspan="2" style="padding:16px 0 4px;font-weight:700;color:#0A1628;border-top:2px solid #D4A017;">
        Apapa Port Pilot (Yesterday)
      </td></tr>
      ${result.pilotGreenPct !== null
        ? `<tr><td style="padding:4px 0;color:#6B7280;">Green-lane rate</td><td style="padding:4px 0;font-weight:600;color:#065F46;">${result.pilotGreenPct}%</td></tr>`
        : ""}
      ${result.pilotAvgClearanceHours !== null
        ? `<tr><td style="padding:4px 0;color:#6B7280;">Avg clearance time</td><td style="padding:4px 0;font-weight:600;color:#0A1628;">${result.pilotAvgClearanceHours}h</td></tr>`
        : ""}
    `
    : "";

  // Onboarding drop-off table — colour-coded by severity
  const dropOffSection = (result.onboardingDropOff && result.onboardingDropOff.length > 0)
    ? `
      <tr><td colspan="2" style="padding:16px 0 8px;font-weight:700;color:#0A1628;border-top:2px solid #E5E7EB;">
        Onboarding Drop-off (Last 7 Days)
      </td></tr>
      <tr><td colspan="2" style="padding-bottom:8px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse;">
          <thead>
            <tr style="background:#F9FAFB;">
              <th style="padding:6px 8px;text-align:left;color:#6B7280;font-weight:600;border-bottom:1px solid #E5E7EB;">Step</th>
              <th style="padding:6px 8px;text-align:right;color:#6B7280;font-weight:600;border-bottom:1px solid #E5E7EB;">Completions</th>
              <th style="padding:6px 8px;text-align:right;color:#6B7280;font-weight:600;border-bottom:1px solid #E5E7EB;">Drop-off</th>
            </tr>
          </thead>
          <tbody>
            ${result.onboardingDropOff.map(s => {
              const rate = s.dropOffRate;
              const bg   = rate >= 50 ? "#FEF2F2" : rate >= 25 ? "#FFFBEB" : "#F0FDF4";
              const col  = rate >= 50 ? "#991B1B" : rate >= 25 ? "#92400E" : "#065F46";
              return `<tr style="background:${bg};">
                <td style="padding:6px 8px;color:#0A1628;border-bottom:1px solid #E5E7EB;">${s.step}</td>
                <td style="padding:6px 8px;text-align:right;color:#0A1628;border-bottom:1px solid #E5E7EB;">${s.completions}</td>
                <td style="padding:6px 8px;text-align:right;font-weight:700;color:${col};border-bottom:1px solid #E5E7EB;">${rate}%</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </td></tr>
    `
    : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TradeGateway Executive Digest — ${result.date}</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#0A1628;padding:24px 32px;">
            <p style="margin:0;font-size:11px;color:#D4A017;letter-spacing:2px;text-transform:uppercase;">
              Nigeria Customs Service — Single Window Trade Platform
            </p>
            <h1 style="margin:8px 0 0;font-size:22px;color:#ffffff;">
              Executive Daily Digest
            </h1>
            <p style="margin:4px 0 0;font-size:13px;color:#94A3B8;">
              ${result.date} &nbsp;·&nbsp; Generated at ${new Date().toUTCString()}
            </p>
          </td>
        </tr>

        <!-- KPI summary bar -->
        <tr>
          <td style="background:#D4A017;padding:12px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="color:#ffffff;font-size:12px;">
                  <strong style="font-size:20px;">${fmt(result.totalDeclarations)}</strong><br>Declarations
                </td>
                <td align="center" style="color:#ffffff;font-size:12px;">
                  <strong style="font-size:20px;">${fmtNaira(result.dutyRevenueNaira)}</strong><br>Duty Collected
                </td>
                <td align="center" style="color:#ffffff;font-size:12px;">
                  <strong style="font-size:20px;">${result.clearanceRatePct}%</strong><br>Clearance Rate
                </td>
                <td align="center" style="color:#ffffff;font-size:12px;">
                  <strong style="font-size:20px;">${result.activeSlaBreaches}</strong><br>SLA Breaches
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Detail table -->
        <tr>
          <td style="padding:24px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">

              <!-- Declarations section -->
              <tr><td colspan="2" style="padding-bottom:8px;font-weight:700;color:#0A1628;border-bottom:2px solid #E5E7EB;">
                Declarations
              </td></tr>
              <tr>
                <td style="padding:6px 0;color:#6B7280;">Total submitted</td>
                <td style="padding:6px 0;font-weight:600;color:#0A1628;">${fmt(result.totalDeclarations)}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6B7280;">Green lane</td>
                <td style="padding:4px 0;font-weight:600;color:#065F46;">${fmt(result.greenLane)} &nbsp;<span style="color:#6B7280;font-weight:400;">(${greenPct}%)</span></td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6B7280;">Yellow lane</td>
                <td style="padding:4px 0;font-weight:600;color:#92400E;">${fmt(result.yellowLane)} &nbsp;<span style="color:#6B7280;font-weight:400;">(${yellowPct}%)</span></td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6B7280;">Red lane</td>
                <td style="padding:4px 0;font-weight:600;color:#991B1B;">${fmt(result.redLane)} &nbsp;<span style="color:#6B7280;font-weight:400;">(${redPct}%)</span></td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6B7280;">Avg clearance time</td>
                <td style="padding:4px 0;font-weight:600;color:#0A1628;">${result.avgClearanceHours != null ? `${result.avgClearanceHours}h` : "N/A"}</td>
              </tr>

              <!-- Revenue section -->
              <tr><td colspan="2" style="padding:16px 0 8px;font-weight:700;color:#0A1628;border-top:2px solid #E5E7EB;">
                Revenue
              </td></tr>
              <tr>
                <td style="padding:4px 0;color:#6B7280;">Duty collected</td>
                <td style="padding:4px 0;font-weight:600;color:#065F46;">${fmtNaira(result.dutyRevenueNaira)}</td>
              </tr>

              <!-- Compliance section -->
              <tr><td colspan="2" style="padding:16px 0 8px;font-weight:700;color:#0A1628;border-top:2px solid #E5E7EB;">
                Compliance
              </td></tr>
              <tr>
                <td style="padding:4px 0;color:#6B7280;">Active SLA breaches</td>
                <td style="padding:4px 0;font-weight:600;color:${result.activeSlaBreaches > 0 ? "#991B1B" : "#065F46"};">${fmt(result.activeSlaBreaches)}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6B7280;">AEO operators</td>
                <td style="padding:4px 0;font-weight:600;color:#0A1628;">${fmt(result.aeoOperators)}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6B7280;">Sanctions hits</td>
                <td style="padding:4px 0;font-weight:600;color:${result.sanctionsHits > 0 ? "#991B1B" : "#065F46"};">${fmt(result.sanctionsHits)}</td>
              </tr>

              ${pilotSection}

              ${dropOffSection}

            </table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding:0 32px 24px;">
            <a href="https://tradegateway.ng/app/executive-dashboard"
               style="display:inline-block;background:#0A1628;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">
              Open Executive Dashboard →
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F3F4F6;padding:16px 32px;font-size:11px;color:#9CA3AF;border-top:1px solid #E5E7EB;">
            TradeGateway™ NGSWTP — Nigeria Single Window Trade Platform<br>
            This is an automated digest. To manage recipients, update the DIGEST_RECIPIENTS environment variable.
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
  `.trim();
}

// ── Send function ─────────────────────────────────────────────────────────────

export interface DigestEmailResult {
  sent: boolean;
  recipients?: string[];
  reason?: string;
  error?: string;
}

export async function sendDigestEmail(result: ExecDigestResult): Promise<DigestEmailResult> {
  const { apiKey, fromEmail, recipients } = getEmailConfig();

  if (!apiKey) {
    return { sent: false, reason: "SENDGRID_API_KEY not set — email delivery skipped" };
  }
  if (recipients.length === 0) {
    return { sent: false, reason: "DIGEST_RECIPIENTS not set — email delivery skipped" };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.sendgrid.net",
      port: 587,
      secure: false,
      auth: {
        user: "apikey",
        pass: apiKey,
      },
    });

    const subject =
      `[TradeGateway Digest ${result.date}] ` +
      `${result.totalDeclarations.toLocaleString("en-NG")} decls · ` +
      `${result.dutyRevenueNaira >= 1_000_000
        ? `₦${(result.dutyRevenueNaira / 1_000_000).toFixed(1)}M`
        : `₦${Math.round(result.dutyRevenueNaira).toLocaleString("en-NG")}`} duty · ` +
      `${result.clearanceRatePct}% cleared`;

    const html = buildHtml(result);

    // Plain-text fallback
    const text = [
      `TradeGateway Executive Digest — ${result.date}`,
      ``,
      `Declarations: ${result.totalDeclarations}`,
      `  Green: ${result.greenLane} | Yellow: ${result.yellowLane} | Red: ${result.redLane}`,
      `  Clearance rate: ${result.clearanceRatePct}%`,
      `  Avg clearance: ${result.avgClearanceHours != null ? `${result.avgClearanceHours}h` : "N/A"}`,
      ``,
      `Duty collected: ${result.dutyRevenueNaira >= 1_000_000
        ? `₦${(result.dutyRevenueNaira / 1_000_000).toFixed(1)}M`
        : `₦${Math.round(result.dutyRevenueNaira)}`}`,
      ``,
      `Compliance:`,
      `  SLA breaches: ${result.activeSlaBreaches}`,
      `  AEO operators: ${result.aeoOperators}`,
      `  Sanctions hits: ${result.sanctionsHits}`,
      ``,
      result.pilotGreenPct !== null
        ? `Apapa Pilot: ${result.pilotGreenPct}% green, ${result.pilotAvgClearanceHours ?? "N/A"}h avg`
        : "",
      ``,
      `View full dashboard: https://tradegateway.ng/app/executive-dashboard`,
    ].filter(l => l !== undefined).join("\n");

    await transporter.sendMail({
      from: `"TradeGateway™ NGSWTP" <${fromEmail}>`,
      to: recipients.join(", "),
      subject,
      text,
      html,
    });

    console.log(`[Digest Email] Sent to ${recipients.length} recipient(s): ${recipients.join(", ")}`);
    return { sent: true, recipients };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Digest Email] Failed to send:", msg);
    return { sent: false, error: msg };
  }
}
