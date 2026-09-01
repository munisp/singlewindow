/**
 * executive/briefing.ts — weekly ministerial PDF briefing (Phase 12 Mission C).
 *
 * Generates a real PDF (pdfkit, MIT) from the LIVE ministerial KPI pack and
 * JWS-signs the base64 payload with the platform envelope pattern
 * (EdDSA/Ed25519 over RFC 8785 JCS — server/lib/envelopeSign.ts).
 *
 * FAIL-CLOSED:
 *  - DB outage → KpiPackUnavailable propagates (route answers 503);
 *  - signing key unconfigured → throws; the route answers 503 and NO unsigned
 *    briefing is ever issued.
 */
import PDFDocument from "pdfkit";
import { signPayloadJws, signingConfigured } from "../lib/envelopeSign";
import { computeKpiSummary, type MinisterialKpiSummary } from "./kpiPack";

export class BriefingSigningUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BriefingSigningUnavailable";
  }
}

function renderKpiPdf(kpis: MinisterialKpiSummary): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: "Weekly Ministerial KPI Briefing" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("BlueEconomy Single Window — Weekly Ministerial KPI Briefing", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#555")
      .text(`Window: ${kpis.window.from.slice(0, 10)} → ${kpis.window.to.slice(0, 10)}`)
      .text(`Generated: ${kpis.generatedAt}`);
    doc.moveDown(1);
    doc.fillColor("#000");

    const rows: Array<[string, string]> = [
      ["Revenue collected (USD)", kpis.revenueCollectedUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })],
      ["Declarations cleared", String(kpis.declarationsCleared)],
      ["Declarations total (all-time)", String(kpis.declarationsTotal)],
      ["Average clearance time (hours)", String(kpis.avgClearanceHours)],
      ["Interceptions (sanctions + red lane)", String(kpis.interceptions)],
      ["Electronic lodgement coverage (%)", String(kpis.electronicCoveragePct)],
      ["OGA permit SLA compliance (%)", String(kpis.slaCompliancePct)],
    ];
    doc.fontSize(12);
    for (const [label, value] of rows) {
      doc.text(`${label}:`, { continued: true, width: 320 }).text(`  ${value}`, { align: "right" });
      doc.moveDown(0.3);
    }
    doc.moveDown(1);
    doc.fontSize(9).fillColor("#777")
      .text("Produced by blueeconomy-singlewindow from live platform data. Signed JWS-EdDSA over RFC 8785 JCS; verify with the platform public key.");
    doc.end();
  });
}

export interface SignedWeeklyBriefing {
  payload: string;          // base64 PDF
  signature: string;        // JWS compact serialization
  algorithm: "EdDSA";
  kid: string;
  contentType: "application/pdf";
  generatedAt: string;
}

/**
 * Build the weekly briefing: KPI pack → PDF → JWS-signed JSON envelope.
 * Throws BriefingSigningUnavailable when no signing key is configured.
 */
export async function buildSignedWeeklyBriefing(days = 7): Promise<SignedWeeklyBriefing> {
  if (!signingConfigured()) {
    throw new BriefingSigningUnavailable(
      "Weekly briefing unavailable: signing key not configured (env-only secrets policy). No unsigned briefing will be issued."
    );
  }
  const kpis = await computeKpiSummary(days);
  const pdf = await renderKpiPdf(kpis);
  // kid follows the platform convention `<producer>-<epoch>` (cf. the signed
  // API catalogue's "singlewindow-0"); BRIEFING_KEY_ID overrides the epoch.
  const epoch = (process.env.BRIEFING_KEY_ID ?? "0").trim();
  if (!/^\d+$/.test(epoch)) {
    throw new BriefingSigningUnavailable(
      "Weekly briefing unavailable: BRIEFING_KEY_ID must be a decimal epoch."
    );
  }
  const kid = `singlewindow-${epoch}`;
  const payload = pdf.toString("base64");
  const signed = signPayloadJws(
    {
      contentType: "application/pdf",
      generatedAt: kpis.generatedAt,
      window: kpis.window,
      payload,
    } as unknown as import("../lib/jcs").JsonValue,
    kid
  );
  return {
    payload,
    signature: signed.jws,
    algorithm: "EdDSA",
    kid: signed.kid,
    contentType: "application/pdf",
    generatedAt: kpis.generatedAt,
  };
}
