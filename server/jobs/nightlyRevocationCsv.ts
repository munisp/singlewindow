/**
 * nightlyRevocationCsv.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Nightly job that emails the previous day's certificate revocation log as a
 * CSV attachment to all active compliance officer email addresses stored in the
 * `compliance_email_schedule` table.
 *
 * Gracefully skipped if:
 *   - SENDGRID_API_KEY is not set
 *   - No active recipients are configured
 *   - DB is unavailable
 *
 * Scheduled at 04:00 UTC daily from server/_core/index.ts.
 */
import nodemailer from "nodemailer";
import { getDb } from "../db";
import {
  complianceEmailSchedule,
  originCertificates,
} from "../../drizzle/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";

export interface NightlyRevocationCsvResult {
  sent: boolean;
  recipients: string[];
  rowCount: number;
  reason?: string;
}

export async function runNightlyRevocationCsv(): Promise<NightlyRevocationCsvResult> {
  const apiKey    = process.env.SENDGRID_API_KEY ?? "";
  const fromEmail = process.env.DIGEST_FROM_EMAIL ?? "noreply@tradegateway.ng";

  if (!apiKey) {
    console.log("[NightlyRevocationCsv] SENDGRID_API_KEY not set — skipping");
    return { sent: false, recipients: [], rowCount: 0, reason: "SENDGRID_API_KEY not set" };
  }

  const db = await getDb();
  if (!db) {
    console.warn("[NightlyRevocationCsv] DB unavailable — skipping");
    return { sent: false, recipients: [], rowCount: 0, reason: "DB unavailable" };
  }

  // Load active recipients
  const schedules = await db
    .select()
    .from(complianceEmailSchedule)
    .where(eq(complianceEmailSchedule.isActive, true));

  if (schedules.length === 0) {
    console.log("[NightlyRevocationCsv] No active recipients configured — skipping");
    return { sent: false, recipients: [], rowCount: 0, reason: "No active recipients" };
  }

  // Build yesterday's window (UTC)
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const dayStart = new Date(yesterday); dayStart.setHours(0, 0, 0, 0);
  const dayEnd   = new Date(yesterday); dayEnd.setHours(23, 59, 59, 999);
  const dateLabel = yesterday.toISOString().slice(0, 10);

  // Fetch revoked certs from yesterday
  const rows = await db
    .select({
      certNumber:        originCertificates.certNumber,
      certType:          originCertificates.certType,
      exporterName:      originCertificates.exporterName,
      importerName:      originCertificates.importerName,
      originCountry:     originCertificates.originCountry,
      approvedAt:        originCertificates.approvedAt,
      revokedAt:         originCertificates.revokedAt,
      revokedBy:         originCertificates.revokedBy,
      revocationReason:  originCertificates.revocationReason,
    })
    .from(originCertificates)
    .where(
      and(
        eq(originCertificates.status, "revoked"),
        gte(originCertificates.revokedAt, dayStart),
        lte(originCertificates.revokedAt, dayEnd)
      )
    )
    .orderBy(desc(originCertificates.revokedAt))
    .limit(5000);

  // Build CSV
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const header = "Cert Number,Type,Exporter,Importer,Origin Country,Approved At,Revoked At,Revoked By (User ID),Reason";
  const lines = rows.map(r =>
    [
      r.certNumber, r.certType, r.exporterName, r.importerName ?? "",
      r.originCountry ?? "",
      r.approvedAt ? new Date(r.approvedAt).toISOString() : "",
      r.revokedAt  ? new Date(r.revokedAt).toISOString()  : "",
      r.revokedBy  ?? "", r.revocationReason ?? "",
    ].map(escape).join(",")
  );
  const csvContent = [header, ...lines].join("\n");
  const filename   = `revocation-log-${dateLabel}.csv`;

  const recipientEmails = schedules.map(s => s.recipientEmail);

  try {
    const transporter = nodemailer.createTransport({
      host:   "smtp.sendgrid.net",
      port:   587,
      secure: false,
      auth: { user: "apikey", pass: apiKey },
    });

    const subject =
      rows.length > 0
        ? `[TradeGateway] Revocation Log ${dateLabel} — ${rows.length} certificate(s) revoked`
        : `[TradeGateway] Revocation Log ${dateLabel} — No revocations yesterday`;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#0A1628;padding:20px 24px;">
          <h1 style="color:#D4A017;margin:0;font-size:20px;">TradeGateway™ NGSWTP</h1>
          <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Nightly Compliance Report</p>
        </div>
        <div style="padding:24px;background:#f8fafc;border:1px solid #e2e8f0;">
          <h2 style="color:#0A1628;font-size:16px;margin:0 0 12px;">
            Certificate Revocation Log — ${dateLabel}
          </h2>
          <p style="color:#334155;font-size:14px;margin:0 0 16px;">
            ${rows.length > 0
              ? `<strong>${rows.length}</strong> certificate(s) were revoked yesterday. The full log is attached as a CSV file.`
              : "No certificates were revoked yesterday. The empty log is attached for audit completeness."}
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <tr style="background:#e2e8f0;">
              <th style="padding:8px 12px;text-align:left;color:#0A1628;">Metric</th>
              <th style="padding:8px 12px;text-align:right;color:#0A1628;">Value</th>
            </tr>
            <tr>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">Revocations yesterday</td>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:bold;color:${rows.length > 0 ? "#dc2626" : "#16a34a"};">${rows.length}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">Report period</td>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${dateLabel} 00:00–23:59 UTC</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;">Attachment</td>
              <td style="padding:8px 12px;text-align:right;">${filename}</td>
            </tr>
          </table>
          <p style="color:#64748b;font-size:12px;margin:16px 0 0;">
            This is an automated nightly report from TradeGateway™ NGSWTP.<br>
            To unsubscribe or change recipients, visit the Admin → Compliance Email Settings page.
          </p>
        </div>
      </div>`;

    await transporter.sendMail({
      from:        `"TradeGateway™ NGSWTP" <${fromEmail}>`,
      to:          recipientEmails.join(", "),
      subject,
      html,
      attachments: [
        {
          filename,
          content: csvContent,
          contentType: "text/csv",
        },
      ],
    });

    // Update lastSentAt for all active schedules
    await db
      .update(complianceEmailSchedule)
      .set({ lastSentAt: now, lastSentRows: rows.length, updatedAt: now })
      .where(eq(complianceEmailSchedule.isActive, true));

    console.log(
      `[NightlyRevocationCsv] Sent ${filename} (${rows.length} rows) to ${recipientEmails.join(", ")}`
    );
    return { sent: true, recipients: recipientEmails, rowCount: rows.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[NightlyRevocationCsv] Email failed: ${msg}`);
    return { sent: false, recipients: [], rowCount: rows.length, reason: msg };
  }
}
