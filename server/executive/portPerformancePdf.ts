/**
 * executive/portPerformancePdf.ts — signed port performance PDF report
 * (Phase 16 Wave P2). Mirrors executive/briefing.ts exactly: a real PDF
 * (pdfkit, MIT) rendered from the LIVE port performance report and JWS-signed
 * with the platform envelope pattern (EdDSA/Ed25519 over RFC 8785 JCS —
 * server/lib/envelopeSign.ts), using the SAME kid convention
 * (`singlewindow-<epoch>`, BRIEFING_KEY_ID) as /v1/briefings/weekly.
 *
 * FAIL-CLOSED:
 *  - signing key unconfigured → throws BriefingSigningUnavailable; the route
 *    answers 503 and NO unsigned PDF is ever issued;
 *  - DB outage → KpiPackUnavailable propagates (route answers 503);
 *  - metrics with no data render as "no data for this period" in the PDF —
 *    no figure is ever fabricated.
 */
import PDFDocument from "pdfkit";
import { signPayloadJws, signingConfigured } from "../lib/envelopeSign";
import { BriefingSigningUnavailable } from "./briefing";
import {
  computePortPerformanceReport,
  type ComputeOptions,
  type PortPerformanceMetric,
  type PortPerformancePeriod,
  type PortPerformanceReport,
} from "./portPerformance";

const METRIC_LABELS: Array<[keyof PortPerformanceReport["metrics"], string]> = [
  ["cargo_throughput_tonnes", "Cargo throughput"],
  ["vessel_calls", "Vessel calls"],
  ["teu_in", "TEU in"],
  ["teu_out", "TEU out"],
  ["transshipment_volume_teu", "Transshipment volume"],
  ["export_tonnes", "Export tonnage"],
  ["import_tonnes", "Import tonnage"],
];

function fmtMetric(m: PortPerformanceMetric): string {
  if (m.value == null) return `no data for this period (source: ${m.source})`;
  const delta = m.delta_pct == null ? "" : ` (${m.delta_pct > 0 ? "+" : ""}${m.delta_pct}% vs prior period)`;
  return `${m.value.toLocaleString("en-US")} ${m.unit}${delta}`;
}

function renderReportPdf(report: PortPerformanceReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: "Port Performance Report" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("BlueEconomy — Port Performance Report", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#555")
      .text(`Period: ${report.period} (${report.period_start.slice(0, 10)} → ${report.period_end.slice(0, 10)})`)
      .text(`Generated: ${report.generated_at}`);
    doc.moveDown(1);
    doc.fillColor("#000");

    for (const [key, label] of METRIC_LABELS) {
      const m = report.metrics[key];
      doc.fontSize(12).text(`${label}:`, { continued: true, width: 200 })
        .fontSize(11).text(`  ${fmtMetric(m)}`);
      doc.fontSize(8).fillColor("#777").text(`source: ${m.source}`).fillColor("#000");
      doc.moveDown(0.4);
    }
    doc.moveDown(1);
    doc.fontSize(9).fillColor("#777")
      .text("Produced by blueeconomy-singlewindow from live platform data; metrics with no data are reported honestly as empty. Signed JWS-EdDSA over RFC 8785 JCS; verify with the platform public key.");
    doc.end();
  });
}

export interface SignedPortPerformancePdf {
  payload: string;          // base64 PDF
  signature: string;        // JWS compact serialization
  algorithm: "EdDSA";
  kid: string;
  contentType: "application/pdf";
  generatedAt: string;
}

/**
 * Build the signed port performance PDF: report → PDF → JWS-signed envelope.
 * Throws BriefingSigningUnavailable when no signing key is configured.
 */
export async function buildSignedPortPerformancePdf(
  period: PortPerformancePeriod,
  opts: ComputeOptions = {}
): Promise<SignedPortPerformancePdf> {
  if (!signingConfigured()) {
    throw new BriefingSigningUnavailable(
      "Port performance PDF unavailable: signing key not configured (env-only secrets policy). No unsigned report will be issued."
    );
  }
  const report = await computePortPerformanceReport(period, opts);
  const pdf = await renderReportPdf(report);
  const epoch = (process.env.BRIEFING_KEY_ID ?? "0").trim();
  if (!/^\d+$/.test(epoch)) {
    throw new BriefingSigningUnavailable(
      "Port performance PDF unavailable: BRIEFING_KEY_ID must be a decimal epoch."
    );
  }
  const kid = `singlewindow-${epoch}`;
  const payload = pdf.toString("base64");
  const signed = signPayloadJws(
    {
      contentType: "application/pdf",
      generatedAt: report.generated_at,
      period: report.period,
      periodStart: report.period_start,
      periodEnd: report.period_end,
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
    generatedAt: report.generated_at,
  };
}
