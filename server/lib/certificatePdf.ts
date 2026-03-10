/**
 * certificatePdf.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates a WTO-compliant AfCFTA Certificate of Origin PDF using pdfkit.
 *
 * Enhancements (v2):
 *   • NCS logo in the header (left side)
 *   • AfCFTA logo in the header (right side)
 *   • QR-code block pointing to the public verification URL
 *   • Public verify endpoint hint: GET /api/verify/:certNumber
 *
 * Layout follows the standard Form A / AfCFTA CO template:
 *   Box 1  — Exporter
 *   Box 2  — Certificate Number & Type
 *   Box 3  — Consignee / Importer
 *   Box 4  — Country of Origin
 *   Box 5  — Country of Destination
 *   Box 6  — Transport details
 *   Box 7  — Remarks
 *   Box 8  — Goods description (HS Code, quantity, weight)
 *   Box 9  — Origin criteria
 *   Box 10 — Declaration by exporter
 *   Box 11 — Certification by competent authority
 */

import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import path from "path";
import { fileURLToPath } from "url";
import type { OriginCertificate } from "../../drizzle/schema";

// ── Asset paths (bundled with the server) ─────────────────────────────────────
// Works in both CommonJS (__dirname) and ESM (import.meta.url)
const _dirname: string =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

const ASSETS_DIR      = path.resolve(_dirname, "../assets");
const NCS_LOGO_PATH    = path.join(ASSETS_DIR, "ncs-logo.png");
const AFCFTA_LOGO_PATH = path.join(ASSETS_DIR, "afcfta-logo.png");

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: Date | null | undefined): string {
  if (!d) return "N/A";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function certTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    form_a:       "Form A (GSP)",
    eur1:         "EUR.1",
    afcfta_co:    "AfCFTA Certificate of Origin",
    comesa_co:    "COMESA Certificate of Origin",
    ecowas_co:    "ECOWAS Certificate of Origin",
    bilateral_co: "Bilateral Certificate of Origin",
  };
  return labels[type] ?? type.toUpperCase();
}

function originCriteriaLabel(criteria: string): string {
  const labels: Record<string, string> = {
    wholly_obtained:          "A — Wholly obtained",
    substantial_transformation: "B — Substantial transformation",
    value_added_rule:         "C — Value-added rule (≥ 30% local content)",
    tariff_shift_rule:        "D — Tariff classification change (tariff shift rule)",
  };
  return labels[criteria] ?? criteria;
}

// ── PDF Generator ─────────────────────────────────────────────────────────────

export async function generateCertificatePdf(cert: OriginCertificate): Promise<Buffer> {
  // Build the public verification URL
  const certRef = cert.certNumber ?? String(cert.id);
  const verifyUrl = `https://tradegateway.ng/verify/${certRef}`;

  // Pre-generate QR code as PNG buffer
  const qrBuffer: Buffer = await QRCode.toBuffer(verifyUrl, {
    type: "png",
    width: 120,
    margin: 1,
    color: { dark: "#0A1628", light: "#FFFFFF" },
  });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
      info: {
        Title:        `Certificate of Origin — ${certRef}`,
        Author:       "TradeGateway™ NGSWTP",
        Subject:      "AfCFTA Certificate of Origin",
        Keywords:     "AfCFTA, certificate of origin, trade, Nigeria",
        CreationDate: new Date(),
      },
    });

    doc.on("data",  (chunk: Buffer) => chunks.push(chunk));
    doc.on("end",   () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PAGE_W = doc.page.width - 80;  // usable width
    const LEFT   = 40;
    const GOLD   = "#C8952A";
    const NAVY   = "#0A1628";
    const GRAY   = "#6B7280";
    const LIGHT  = "#F3F4F6";

    // ── Header band ───────────────────────────────────────────────────────────
    const HEADER_H = 72;
    doc
      .rect(LEFT, 40, PAGE_W, HEADER_H)
      .fillAndStroke(NAVY, NAVY);

    // NCS logo — left side
    try {
      doc.image(NCS_LOGO_PATH, LEFT + 6, 44, { height: 64, fit: [64, 64] });
    } catch {
      // Logo not available — skip silently
    }

    // AfCFTA logo — right side
    try {
      doc.image(AFCFTA_LOGO_PATH, LEFT + PAGE_W - 70, 44, { height: 64, fit: [64, 64] });
    } catch {
      // Logo not available — skip silently
    }

    // Header text — centred
    doc
      .fillColor("#FFFFFF")
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("FEDERAL REPUBLIC OF NIGERIA", LEFT + 70, 50, { width: PAGE_W - 140, align: "center" });

    doc
      .fontSize(9)
      .font("Helvetica")
      .text(
        "NIGERIA CUSTOMS SERVICE — SINGLE WINDOW TRADE PLATFORM",
        LEFT + 70, 68, { width: PAGE_W - 140, align: "center" }
      );

    doc
      .fontSize(8)
      .fillColor("#D4A017")
      .text(
        "Issued under the AfCFTA Rules of Origin Protocol",
        LEFT + 70, 84, { width: PAGE_W - 140, align: "center" }
      );

    // ── Title bar ─────────────────────────────────────────────────────────────
    doc
      .rect(LEFT, 116, PAGE_W, 26)
      .fillAndStroke(GOLD, GOLD);

    doc
      .fillColor("#FFFFFF")
      .fontSize(12)
      .font("Helvetica-Bold")
      .text(certTypeLabel(cert.certType).toUpperCase(), LEFT + 10, 122, {
        width: PAGE_W - 20,
        align: "center",
      });

    let y = 148;

    // ── Helper: draw a labelled box ───────────────────────────────────────────
    function box(
      label: string,
      value: string,
      bx: number,
      by: number,
      bw: number,
      bh: number
    ) {
      doc.rect(bx, by, bw, bh).strokeColor("#D1D5DB").stroke();
      doc
        .fillColor(GRAY)
        .fontSize(7)
        .font("Helvetica-Bold")
        .text(label, bx + 4, by + 4, { width: bw - 8 });
      doc
        .fillColor(NAVY)
        .fontSize(9)
        .font("Helvetica")
        .text(value || "—", bx + 4, by + 15, { width: bw - 8, height: bh - 20 });
    }

    // ── Row 1: Exporter (left) + Cert Number (right) ──────────────────────────
    const COL2  = PAGE_W / 2 + LEFT;
    const COL_W = PAGE_W / 2;
    const ROW1_H = 70;

    box(
      "1. Exporter (Name, Address, Country)",
      `${cert.exporterName}\n${cert.exporterAddress}`,
      LEFT, y, COL_W, ROW1_H
    );

    box(
      "2. Certificate Number",
      `${certRef}\n\nIssued: ${formatDate(cert.approvedAt ?? cert.createdAt)}\nExpires: ${formatDate(cert.expiresAt)}`,
      COL2, y, COL_W, ROW1_H
    );

    y += ROW1_H;

    // ── Row 2: Importer (left) + Countries (right) ────────────────────────────
    const ROW2_H = 60;

    box(
      "3. Consignee / Importer (Name, Address, Country)",
      `${cert.importerName}\n${cert.importerAddress}`,
      LEFT, y, COL_W, ROW2_H
    );

    const QUARTER_W = COL_W / 2;
    box("4. Country of Origin",      cert.originCountry,      COL2,             y, QUARTER_W, ROW2_H);
    box("5. Country of Destination", cert.destinationCountry, COL2 + QUARTER_W, y, QUARTER_W, ROW2_H);

    y += ROW2_H;

    // ── Row 3: Goods description (full width) ─────────────────────────────────
    const ROW3_H = 75;
    box(
      "8. Goods Description (HS Code, Description, Quantity, Weight)",
      [
        `HS Code: ${cert.hsCode}`,
        `Description: ${cert.goodsDescription}`,
        cert.quantity     ? `Quantity: ${cert.quantity}`        : "",
        cert.grossWeight  ? `Gross Weight: ${cert.grossWeight}` : "",
        cert.netWeight    ? `Net Weight: ${cert.netWeight}`     : "",
        cert.invoiceNumber
          ? `Invoice No: ${cert.invoiceNumber} (${formatDate(cert.invoiceDate)})`
          : "",
      ].filter(Boolean).join("   |   "),
      LEFT, y, PAGE_W, ROW3_H
    );

    y += ROW3_H;

    // ── Row 4: Origin criteria + Local value added ────────────────────────────
    const ROW4_H = 45;
    box(
      "9. Origin Criteria",
      originCriteriaLabel(cert.originCriteria),
      LEFT, y, COL_W, ROW4_H
    );
    box(
      "9a. Local Value Added (%)",
      cert.localValueAddedPct != null ? `${cert.localValueAddedPct}%` : "Not specified",
      COL2, y, COL_W, ROW4_H
    );

    y += ROW4_H;

    // ── Row 5: Review notes (if any) ──────────────────────────────────────────
    if (cert.reviewNotes) {
      const ROW5_H = 40;
      box("7. Remarks / Review Notes", cert.reviewNotes, LEFT, y, PAGE_W, ROW5_H);
      y += ROW5_H;
    }

    // ── Signature + QR code row ───────────────────────────────────────────────
    const SIG_H   = 90;
    const QR_SIZE = 80;
    const QR_COL_W = QR_SIZE + 16;
    const SIG_COL_W = (PAGE_W - QR_COL_W) / 2;
    y += 8;

    // Exporter declaration
    doc.rect(LEFT, y, SIG_COL_W, SIG_H).strokeColor("#D1D5DB").stroke();
    doc
      .fillColor(GRAY).fontSize(7).font("Helvetica-Bold")
      .text("10. DECLARATION BY THE EXPORTER", LEFT + 4, y + 4, { width: SIG_COL_W - 8 });
    doc
      .fillColor(NAVY).fontSize(8).font("Helvetica")
      .text(
        "The undersigned hereby declares that the above details and statements are correct, " +
        "that all the goods were produced in the country shown in Box 4, and that they comply " +
        "with the origin requirements specified for these goods.",
        LEFT + 4, y + 16, { width: SIG_COL_W - 8 }
      );
    doc
      .fontSize(8)
      .text(`Place and date: Nigeria, ${formatDate(cert.createdAt)}`, LEFT + 4, y + 68, { width: SIG_COL_W - 8 });
    doc
      .fontSize(8)
      .text("Signature: ___________________________", LEFT + 4, y + 78, { width: SIG_COL_W - 8 });

    // Competent authority certification
    const SIG2_X = LEFT + SIG_COL_W;
    doc.rect(SIG2_X, y, SIG_COL_W, SIG_H).strokeColor("#D1D5DB").stroke();
    doc
      .fillColor(GRAY).fontSize(7).font("Helvetica-Bold")
      .text("11. CERTIFICATION BY COMPETENT AUTHORITY", SIG2_X + 4, y + 4, { width: SIG_COL_W - 8 });

    const isApproved = cert.status === "approved";
    doc
      .fillColor(isApproved ? "#065F46" : "#991B1B")
      .fontSize(11).font("Helvetica-Bold")
      .text(
        isApproved ? "✓ APPROVED" : `STATUS: ${cert.status.toUpperCase()}`,
        SIG2_X + 4, y + 18, { width: SIG_COL_W - 8, align: "center" }
      );

    if (isApproved) {
      doc
        .fillColor(NAVY).fontSize(8).font("Helvetica")
        .text(
          `Approved by: Nigeria Customs Service\nDate: ${formatDate(cert.approvedAt)}\n\n` +
          "This certificate is issued under the authority of the Federal Republic of Nigeria " +
          "in accordance with the AfCFTA Rules of Origin Protocol.",
          SIG2_X + 4, y + 34, { width: SIG_COL_W - 8 }
        );
    }

    // QR code column
    const QR_X = LEFT + SIG_COL_W * 2;
    doc.rect(QR_X, y, QR_COL_W, SIG_H).strokeColor("#D1D5DB").stroke();
    doc
      .fillColor(GRAY).fontSize(7).font("Helvetica-Bold")
      .text("VERIFY ONLINE", QR_X + 4, y + 4, { width: QR_COL_W - 8, align: "center" });

    // Embed QR code image
    try {
      doc.image(qrBuffer, QR_X + 8, y + 14, { width: QR_SIZE, height: QR_SIZE });
    } catch {
      // Fallback text if QR rendering fails
      doc
        .fillColor(NAVY).fontSize(7).font("Helvetica")
        .text(verifyUrl, QR_X + 4, y + 20, { width: QR_COL_W - 8 });
    }

    doc
      .fillColor(GRAY).fontSize(6).font("Helvetica")
      .text("Scan to verify", QR_X + 4, y + 96, { width: QR_COL_W - 8, align: "center" });

    y += SIG_H + 8;

    // ── Footer ────────────────────────────────────────────────────────────────
    doc
      .rect(LEFT, y, PAGE_W, 30)
      .fillAndStroke(LIGHT, "#D1D5DB");

    doc
      .fillColor(GRAY).fontSize(7).font("Helvetica")
      .text(
        `Generated by TradeGateway™ NGSWTP — Nigeria Single Window Trade Platform  |  ` +
        `Certificate ID: ${cert.id}  |  Generated: ${new Date().toUTCString()}`,
        LEFT + 4, y + 6, { width: PAGE_W - 8, align: "center" }
      );

    doc
      .fillColor(NAVY).fontSize(7).font("Helvetica-Bold")
      .text(
        `Verify authenticity at: ${verifyUrl}`,
        LEFT + 4, y + 18, { width: PAGE_W - 8, align: "center" }
      );

    doc.end();
  });
}
