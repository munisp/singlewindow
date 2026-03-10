/**
 * Sprint 79 — Public Certificate Verification Endpoint
 * GET /api/verify/:certNumber → JSON cert status (no auth required)
 * Used by QR codes on AfCFTA certificates of origin.
 * Sprint 83 — increment scanCount on every verification hit.
 */
import type { Express } from "express";
import { getDb } from "../db";
import { originCertificates } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";

export function registerCertVerifyRoute(app: Express) {
  app.get("/api/verify/:certNumber", async (req, res) => {
    try {
      const { certNumber } = req.params;
      if (!certNumber || certNumber.length > 100) {
        return res.status(400).json({ error: "Invalid certificate number" });
      }

      const db = await getDb();
      if (!db) {
        return res.status(503).json({ error: "Database unavailable" });
      }

      const [cert] = await db
        .select({
          id: originCertificates.id,
          certNumber: originCertificates.certNumber,
          certType: originCertificates.certType,
          status: originCertificates.status,
          exporterName: originCertificates.exporterName,
          importerName: originCertificates.importerName,
          originCountry: originCertificates.originCountry,
          destinationCountry: originCertificates.destinationCountry,
          goodsDescription: originCertificates.goodsDescription,
          hsCode: originCertificates.hsCode,
          approvedAt: originCertificates.approvedAt,
          expiresAt: originCertificates.expiresAt,
          invoiceNumber: originCertificates.invoiceNumber,
          originCriteria: originCertificates.originCriteria,
          scanCount: originCertificates.scanCount,
        })
        .from(originCertificates)
        .where(eq(originCertificates.certNumber, certNumber))
        .limit(1);

      if (!cert) {
        return res.status(404).json({
          valid: false,
          error: "Certificate not found",
          certNumber,
          verifiedAt: new Date().toISOString(),
        });
      }

      // Increment scan counter asynchronously (fire-and-forget, non-blocking)
      db.update(originCertificates)
        .set({ scanCount: sql`${originCertificates.scanCount} + 1` })
        .where(eq(originCertificates.id, cert.id))
        .catch((e: unknown) => console.error("[CertVerify] scanCount increment failed:", e));

      const now = new Date();
      const isExpired = cert.expiresAt ? cert.expiresAt < now : false;
      const isValid = cert.status === "approved" && !isExpired;

      return res.json({
        valid: isValid,
        certNumber: cert.certNumber,
        certType: cert.certType,
        status: cert.status,
        isExpired,
        exporterName: cert.exporterName,
        importerName: cert.importerName,
        originCountry: cert.originCountry,
        destinationCountry: cert.destinationCountry,
        goodsDescription: cert.goodsDescription,
        hsCode: cert.hsCode,
        invoiceNumber: cert.invoiceNumber,
        originCriteria: cert.originCriteria,
        approvedAt: cert.approvedAt?.toISOString() ?? null,
        expiresAt: cert.expiresAt?.toISOString() ?? null,
        scanCount: (cert.scanCount ?? 0) + 1, // return the post-increment count
        verifiedAt: now.toISOString(),
        verifiedBy: "TradeGateway™ NGSWTP Certificate Registry",
      });
    } catch (err) {
      console.error("[CertVerify] Error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
}
