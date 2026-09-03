/**
 * clearanceCertificatePdf.ts — in-process clearance-certificate PDF renderer
 * (Phase 13). Replaces the former `manus-md-to-pdf || wkhtmltopdf || chromium`
 * shell-out chain (and its silent HTML "fallback") with a real pdfkit render,
 * following the server/executive/briefing.ts pattern.
 *
 * FAIL-CLOSED: the returned promise rejects on any render error — the caller
 * (declarations.generateClearanceCertificate) never substitutes an HTML file
 * or a fabricated download for a failed PDF.
 */
import PDFDocument from "pdfkit";
import type { declarations } from "../drizzle/schema";

export type ClearanceCertificateDeclaration = typeof declarations.$inferSelect;

const ACCENT = "#D4A017";
const INK = "#0A1628";
const MUTED = "#6b7280";

function row(doc: PDFKit.PDFDocument, label: string, value: string) {
  doc
    .fontSize(10)
    .fillColor(MUTED)
    .text(label, { continued: true, width: 210 })
    .fillColor(INK)
    .text(`  ${value}`);
  doc.moveDown(0.25);
}

function section(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.6);
  doc
    .fontSize(9)
    .fillColor(ACCENT)
    .text(title.toUpperCase(), { characterSpacing: 1 });
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .lineWidth(0.5)
    .strokeColor("#e5e7eb")
    .stroke();
  doc.moveDown(0.4);
}

/**
 * Renders the customs clearance certificate as a real PDF buffer (starts with
 * the %PDF magic bytes). Rejects on render failure.
 */
export function renderClearanceCertificatePdf(
  decl: ClearanceCertificateDeclaration,
  clearedDate: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 56,
      info: {
        Title: `Customs Clearance Certificate CERT-${decl.declarationNumber}`,
        Author: "National Trade Gateway Single Window Platform",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const currency = decl.invoiceCurrency ?? "USD";
    const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "N/A" : String(v));

    // Header
    doc
      .fontSize(20)
      .fillColor(INK)
      .text("NATIONAL TRADE GATEWAY", { align: "center", characterSpacing: 1 });
    doc.fontSize(12).fillColor(ACCENT).text("CUSTOMS CLEARANCE CERTIFICATE", { align: "center" });
    doc
      .moveTo(doc.page.margins.left, doc.y + 6)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y + 6)
      .lineWidth(2)
      .strokeColor(ACCENT)
      .stroke();
    doc.moveDown(1.2);
    doc
      .fontSize(9)
      .fillColor(MUTED)
      .text(`Certificate No: CERT-${decl.declarationNumber}  |  Issued: ${clearedDate}`, { align: "center" });
    doc.moveDown(1);

    // Clearance banner
    doc
      .roundedRect(doc.page.margins.left, doc.y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 56, 6)
      .lineWidth(1.5)
      .strokeColor("#16a34a")
      .fillAndStroke("#f0fdf4", "#16a34a");
    const bannerTop = doc.y + 10;
    doc
      .fontSize(13)
      .fillColor("#16a34a")
      .text("GOODS RELEASED FOR COLLECTION", doc.page.margins.left, bannerTop, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
      });
    doc
      .fontSize(8.5)
      .fillColor("#374151")
      .text(
        "This certificate confirms that the goods described below have been assessed, duties paid, and released by the Customs Authority.",
        doc.page.margins.left + 12,
        doc.y + 2,
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 24, align: "center" }
      );
    doc.y = bannerTop + 56;

    section(doc, "Declaration Details");
    row(doc, "Declaration Number", fmt(decl.declarationNumber));
    row(doc, "Unique Consignment Reference", fmt(decl.ucr));
    row(doc, "Declaration Type", (decl.declarationType ?? "").replace(/_/g, " ").toUpperCase() || "N/A");
    row(doc, "Date Submitted", decl.submittedAt ? new Date(decl.submittedAt).toLocaleDateString("en-GB") : "N/A");
    row(doc, "Date Cleared", clearedDate);

    section(doc, "Goods Information");
    row(doc, "Goods Description", fmt(decl.goodsDescription));
    row(doc, "HS Code", fmt(decl.hsCode));
    row(doc, "Country of Origin", fmt(decl.countryOfOrigin));
    row(doc, "Port of Entry", fmt(decl.portOfEntry));
    row(doc, "Number of Packages", fmt(decl.numberOfPackages));
    row(doc, "Gross Weight", decl.grossWeight ? `${decl.grossWeight} kg` : "N/A");

    section(doc, "Duties & Taxes");
    row(doc, "Invoice Value", `${currency} ${fmt(decl.invoiceValue)}`);
    row(doc, "Duty Amount", `${currency} ${decl.dutyAmount ?? "0.00"}`);
    row(doc, "VAT Amount", `${currency} ${decl.vatAmount ?? "0.00"}`);
    row(doc, "Total Paid", `${currency} ${decl.totalDue ?? "0.00"}`);

    // Signatures
    doc.moveDown(2.5);
    const sigY = doc.y;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const labels = [
      "Customs Officer\nNational Trade Gateway",
      "Commissioner of Customs\nNational Trade Authority",
      "Official Stamp",
    ];
    labels.forEach((label, i) => {
      const x = doc.page.margins.left + (width / 3) * i;
      doc
        .moveTo(x + 10, sigY)
        .lineTo(x + width / 3 - 10, sigY)
        .lineWidth(0.75)
        .strokeColor("#374151")
        .stroke();
      doc.fontSize(8).fillColor(MUTED).text(label, x + 10, sigY + 6, { width: width / 3 - 20, align: "center" });
    });
    doc.y = sigY + 34;

    // Footer
    doc.moveDown(1.5);
    doc
      .fontSize(7.5)
      .fillColor("#9ca3af")
      .text(
        `This certificate is issued electronically by the National Trade Gateway Single Window Platform.\nVerify authenticity at: tradegateway.gov | Certificate No: CERT-${decl.declarationNumber}`,
        { align: "center" }
      );

    doc.end();
  });
}
