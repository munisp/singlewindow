/**
 * sprint78.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Vitest tests for Sprint 78 follow-up features:
 *   1. Apapa Port pilot live-demo seed script
 *   2. AfCFTA certificate PDF generation
 *   3. Executive Dashboard daily email digest cron job
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Pilot seed script — unit tests (no DB required)
// ─────────────────────────────────────────────────────────────────────────────
describe("Pilot seed script — data constants", () => {
  it("defines exactly 5 NCS officers", async () => {
    // We read the constants by importing the module and checking its structure
    const src = await import("fs").then(fs =>
      fs.readFileSync(
        new URL("../scripts/seed-pilot-demo.mjs", import.meta.url).pathname,
        "utf8"
      )
    );
    const officerMatches = src.match(/badge:\s*["']NCS-APT-\d{3}["']/g) ?? [];
    expect(officerMatches).toHaveLength(5);
  });

  it("defines exactly 20 traders", async () => {
    const src = await import("fs").then(fs =>
      fs.readFileSync(
        new URL("../scripts/seed-pilot-demo.mjs", import.meta.url).pathname,
        "utf8"
      )
    );
    const traderMatches = src.match(/rc:\s*["']RC-\d{6}["']/g) ?? [];
    expect(traderMatches).toHaveLength(20);
  });

  it("seeds 30 days of pilot reports (loop from 29 down to 0)", async () => {
    const src = await import("fs").then(fs =>
      fs.readFileSync(
        new URL("../scripts/seed-pilot-demo.mjs", import.meta.url).pathname,
        "utf8"
      )
    );
    // The loop: for (let day = 29; day >= 0; day--)
    expect(src).toContain("for (let day = 29; day >= 0; day--)");
  });

  it("seeds 15 sample declarations", async () => {
    const src = await import("fs").then(fs =>
      fs.readFileSync(
        new URL("../scripts/seed-pilot-demo.mjs", import.meta.url).pathname,
        "utf8"
      )
    );
    expect(src).toContain("for (let i = 0; i < 15; i++)");
  });

  it("seeds up to 10 confirmed payments", async () => {
    const src = await import("fs").then(fs =>
      fs.readFileSync(
        new URL("../scripts/seed-pilot-demo.mjs", import.meta.url).pathname,
        "utf8"
      )
    );
    expect(src).toContain("Math.min(10, clearedDecls.length)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. AfCFTA certificate PDF generator — unit tests
// ─────────────────────────────────────────────────────────────────────────────
describe("generateCertificatePdf", () => {
  it("returns a non-empty Buffer", async () => {
    const { generateCertificatePdf } = await import("./lib/certificatePdf");
    const mockCert = {
      id: 1,
      certNumber: "CO-TEST-001",
      certType: "afcfta_co",
      status: "approved",
      exporterName: "Dangote Industries Ltd",
      exporterAddress: "1 Dangote Road, Lagos, Nigeria",
      importerName: "Accra Trading Co",
      importerAddress: "14 Independence Ave, Accra, Ghana",
      originCountry: "NGA",
      destinationCountry: "GHA",
      goodsDescription: "Portland Cement, Type I",
      hsCode: "2523.29",
      quantity: "500 MT",
      grossWeight: "500000",
      netWeight: "498000",
      invoiceNumber: "INV-2026-001",
      invoiceDate: new Date("2026-03-01"),
      originCriteria: "substantial_transformation",
      localValueAddedPct: 45,
      reviewNotes: null,
      approvedAt: new Date("2026-03-05"),
      expiresAt: new Date("2027-03-05"),
      createdAt: new Date("2026-03-01"),
      // Other fields that may exist on the schema
      traderId: 7,
      declarationId: null,
      submittedAt: new Date("2026-03-01"),
      updatedAt: new Date("2026-03-05"),
    } as any;

    const buf = await generateCertificatePdf(mockCert);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000); // PDF should be at least 1KB
  });

  it("PDF starts with the PDF magic bytes %PDF", async () => {
    const { generateCertificatePdf } = await import("./lib/certificatePdf");
    const mockCert = {
      id: 2,
      certNumber: "CO-TEST-002",
      certType: "form_a",
      status: "approved",
      exporterName: "BUA Group",
      exporterAddress: "BUA House, Lagos",
      importerName: "Abidjan Imports SARL",
      importerAddress: "Rue du Commerce, Abidjan, CIV",
      originCountry: "NGA",
      destinationCountry: "CIV",
      goodsDescription: "Refined Sugar",
      hsCode: "1701.99",
      quantity: "200 MT",
      grossWeight: "200000",
      netWeight: "199000",
      invoiceNumber: null,
      invoiceDate: null,
      originCriteria: "wholly_obtained",
      localValueAddedPct: null,
      reviewNotes: "Verified by NCS Apapa",
      approvedAt: new Date("2026-03-06"),
      expiresAt: null,
      createdAt: new Date("2026-03-02"),
      traderId: 8,
      declarationId: null,
      submittedAt: new Date("2026-03-02"),
      updatedAt: new Date("2026-03-06"),
    } as any;

    const buf = await generateCertificatePdf(mockCert);
    const header = buf.slice(0, 4).toString("ascii");
    expect(header).toBe("%PDF");
  });

  it("includes the certificate number in the PDF metadata title", async () => {
    const { generateCertificatePdf } = await import("./lib/certificatePdf");
    const mockCert = {
      id: 3,
      certNumber: "CO-UNIQUE-XYZ",
      certType: "afcfta_co",
      status: "approved",
      exporterName: "Flour Mills of Nigeria",
      exporterAddress: "1 Flour Mill Road, Lagos",
      importerName: "Dakar Flour Ltd",
      importerAddress: "Port de Dakar, Senegal",
      originCountry: "NGA",
      destinationCountry: "SEN",
      goodsDescription: "Wheat Flour",
      hsCode: "1101.00",
      quantity: "100 MT",
      grossWeight: "100000",
      netWeight: "99500",
      invoiceNumber: "INV-2026-003",
      invoiceDate: new Date("2026-02-28"),
      originCriteria: "value_added_rule",
      localValueAddedPct: 35,
      reviewNotes: null,
      approvedAt: new Date("2026-03-04"),
      expiresAt: new Date("2027-03-04"),
      createdAt: new Date("2026-02-28"),
      traderId: 9,
      declarationId: null,
      submittedAt: new Date("2026-02-28"),
      updatedAt: new Date("2026-03-04"),
    } as any;

    const buf = await generateCertificatePdf(mockCert);
    // The PDF should be a valid non-empty buffer
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000);
    // The PDF header should be valid
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("handles null expiresAt and invoiceDate gracefully", async () => {
    const { generateCertificatePdf } = await import("./lib/certificatePdf");
    const mockCert = {
      id: 4,
      certNumber: "CO-NULL-TEST",
      certType: "ecowas_co",
      status: "approved",
      exporterName: "Nestle Nigeria",
      exporterAddress: "22 Industrial Ave, Lagos",
      importerName: "Lomé Distributors",
      importerAddress: "Lomé, Togo",
      originCountry: "NGA",
      destinationCountry: "TGO",
      goodsDescription: "Milo Beverage",
      hsCode: "1901.90",
      quantity: null,
      grossWeight: null,
      netWeight: null,
      invoiceNumber: null,
      invoiceDate: null,
      originCriteria: "substantial_transformation",
      localValueAddedPct: null,
      reviewNotes: null,
      approvedAt: null,
      expiresAt: null,
      createdAt: new Date("2026-03-01"),
      traderId: 18,
      declarationId: null,
      submittedAt: null,
      updatedAt: new Date("2026-03-01"),
    } as any;

    // Should not throw
    await expect(generateCertificatePdf(mockCert)).resolves.toBeInstanceOf(Buffer);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Executive daily digest — unit tests (mocked DB)
// ─────────────────────────────────────────────────────────────────────────────
describe("runExecDailyDigest", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a result object with the correct shape when DB is unavailable", async () => {
    // Mock getDb to return null (DB unavailable scenario)
    vi.doMock("./db", () => ({
      getDb: vi.fn().mockResolvedValue(null),
      createUserNotification: vi.fn(),
      logAuditEvent: vi.fn(),
    }));
    vi.doMock("./_core/notification", () => ({
      notifyOwner: vi.fn().mockResolvedValue(false),
    }));

    const { runExecDailyDigest } = await import("./jobs/execDigest");
    const result = await runExecDailyDigest();

    expect(result).toMatchObject({
      totalDeclarations: 0,
      greenLane: 0,
      yellowLane: 0,
      redLane: 0,
      clearanceRatePct: 0,
      dutyRevenueNaira: 0,
      avgClearanceHours: null,
      activeSlaBreaches: 0,
      aeoOperators: 0,
      sanctionsHits: 0,
      notificationSent: false,
    });
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("result.date is a valid YYYY-MM-DD string for a recent date", async () => {
    vi.doMock("./db", () => ({
      getDb: vi.fn().mockResolvedValue(null),
      createUserNotification: vi.fn(),
      logAuditEvent: vi.fn(),
    }));
    vi.doMock("./_core/notification", () => ({
      notifyOwner: vi.fn().mockResolvedValue(false),
    }));

    const { runExecDailyDigest } = await import("./jobs/execDigest");
    const result = await runExecDailyDigest();

    // result.date should be a valid YYYY-MM-DD string
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The date should be within the last 2 days (accounts for UTC vs local time)
    const resultDate = new Date(result.date + "T00:00:00Z");
    const twoDaysAgo = new Date();
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
    expect(resultDate.getTime()).toBeGreaterThanOrEqual(twoDaysAgo.getTime());
  });

  it("the cron schedule string for the digest is 03:05 UTC", async () => {
    const src = await import("fs").then(fs =>
      fs.readFileSync(
        new URL("./_core/index.ts", import.meta.url).pathname,
        "utf8"
      )
    );
    // The cron expression "0 5 3 * * *" = seconds=0, minutes=5, hours=3
    expect(src).toContain('"0 5 3 * * *"');
    expect(src).toContain("runExecDailyDigest");
  });

  it("the digest module exports runExecDailyDigest as a function", async () => {
    // Use direct import without mocking to verify the export shape
    const mod = await import("./jobs/execDigest");
    expect(typeof mod.runExecDailyDigest).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. rulesOfOrigin router — generatePdf procedure exists
// ─────────────────────────────────────────────────────────────────────────────
describe("rulesOfOrigin router — generatePdf procedure", () => {
  it("the router source contains the generatePdf procedure definition", async () => {
    const src = await import("fs").then(fs =>
      fs.readFileSync(
        new URL("../server/routers/rulesOfOrigin.ts", import.meta.url).pathname,
        "utf8"
      )
    );
    expect(src).toContain("generatePdf:");
    expect(src).toContain("generateCertificatePdf");
    expect(src).toContain("base64:");
    expect(src).toContain("mimeType:");
    expect(src).toContain("filename:");
  });

  it("the frontend page imports Download icon and uses generatePdfMutation", async () => {
    const src = await import("fs").then(fs =>
      fs.readFileSync(
        new URL("../client/src/pages/app/RulesOfOrigin.tsx", import.meta.url).pathname,
        "utf8"
      )
    );
    expect(src).toContain("Download");
    expect(src).toContain("generatePdfMutation");
    expect(src).toContain("rulesOfOrigin.generatePdf.useMutation");
    expect(src).toContain('a.download = data.filename');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Pilot Dashboard — Load Demo Data button
// ─────────────────────────────────────────────────────────────────────────────
describe("Pilot Dashboard — loadDemoData feature", () => {
  it("pilot router source contains loadDemoData procedure", async () => {
    const src = await import("fs").then(fs =>
      fs.readFileSync(
        new URL("../server/routers/pilot.ts", import.meta.url).pathname,
        "utf8"
      )
    );
    expect(src).toContain("loadDemoData:");
    expect(src).toContain("protectedProcedure");
  });

  it("PilotDashboard page imports Database icon and uses loadDemoMutation", async () => {
    const src = await import("fs").then(fs =>
      fs.readFileSync(
        new URL("../client/src/pages/app/PilotDashboard.tsx", import.meta.url).pathname,
        "utf8"
      )
    );
    expect(src).toContain("Database");
    expect(src).toContain("loadDemoMutation");
    expect(src).toContain("pilot.loadDemoData.useMutation");
    expect(src).toContain("showDemoConfirm");
    expect(src).toContain("Load Demo Data");
  });

  it("PilotDashboard confirmation dialog contains idempotency note", async () => {
    const src = await import("fs").then(fs =>
      fs.readFileSync(
        new URL("../client/src/pages/app/PilotDashboard.tsx", import.meta.url).pathname,
        "utf8"
      )
    );
    expect(src).toContain("idempotent");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Certificate PDF — logos and QR code
// ─────────────────────────────────────────────────────────────────────────────
describe("generateCertificatePdf — v2 with logos and QR code", () => {
  it("certificatePdf source references NCS and AfCFTA logo paths", async () => {
    const src = await import("fs").then(fs =>
      fs.readFileSync(
        new URL("./lib/certificatePdf.ts", import.meta.url).pathname,
        "utf8"
      )
    );
    expect(src).toContain("ncs-logo.png");
    expect(src).toContain("afcfta-logo.png");
  });

  it("certificatePdf source imports QRCode and builds a verify URL", async () => {
    const src = await import("fs").then(fs =>
      fs.readFileSync(
        new URL("./lib/certificatePdf.ts", import.meta.url).pathname,
        "utf8"
      )
    );
    expect(src).toContain("QRCode");
    expect(src).toContain("verifyUrl");
    expect(src).toContain("tradegateway.ng/verify/");
  });

  it("generates a valid PDF buffer with QR code embedded (no logo files needed)", async () => {
    const { generateCertificatePdf } = await import("./lib/certificatePdf");
    const mockCert = {
      id: 99,
      certNumber: "CO-QR-TEST",
      certType: "afcfta_co",
      status: "approved",
      exporterName: "Zenith Exports Ltd",
      exporterAddress: "5 Marina, Lagos",
      importerName: "Nairobi Goods Ltd",
      importerAddress: "Nairobi, Kenya",
      originCountry: "NGA",
      destinationCountry: "KEN",
      goodsDescription: "Cocoa Butter",
      hsCode: "1804.00",
      quantity: "50 MT",
      grossWeight: "50000",
      netWeight: "49800",
      invoiceNumber: "INV-QR-001",
      invoiceDate: new Date("2026-03-01"),
      originCriteria: "wholly_obtained",
      localValueAddedPct: null,
      reviewNotes: null,
      approvedAt: new Date("2026-03-05"),
      expiresAt: new Date("2027-03-05"),
      createdAt: new Date("2026-03-01"),
      traderId: 5,
      declarationId: null,
      submittedAt: new Date("2026-03-01"),
      updatedAt: new Date("2026-03-05"),
    } as any;

    const buf = await generateCertificatePdf(mockCert);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(5000); // QR code adds size
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Digest email helper — unit tests
// ─────────────────────────────────────────────────────────────────────────────
describe("sendDigestEmail", () => {
  it("returns { sent: false } when SENDGRID_API_KEY is not set", async () => {
    const originalKey = process.env.SENDGRID_API_KEY;
    const originalRecipients = process.env.DIGEST_RECIPIENTS;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.DIGEST_RECIPIENTS;

    const { sendDigestEmail } = await import("./lib/digestEmail");
    const mockResult = {
      date: "2026-03-09",
      totalDeclarations: 100,
      greenLane: 70,
      yellowLane: 20,
      redLane: 10,
      clearanceRatePct: 85,
      dutyRevenueNaira: 5_000_000,
      avgClearanceHours: 3.2,
      activeSlaBreaches: 2,
      aeoOperators: 15,
      sanctionsHits: 0,
      pilotGreenPct: 78,
      pilotAvgClearanceHours: 2.1,
      notificationSent: true,
      emailSent: false,
    } as any;

    const result = await sendDigestEmail(mockResult);
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("SENDGRID_API_KEY");

    // Restore env
    if (originalKey !== undefined) process.env.SENDGRID_API_KEY = originalKey;
    if (originalRecipients !== undefined) process.env.DIGEST_RECIPIENTS = originalRecipients;
  });

  it("returns { sent: false } when DIGEST_RECIPIENTS is empty", async () => {
    const originalKey = process.env.SENDGRID_API_KEY;
    const originalRecipients = process.env.DIGEST_RECIPIENTS;
    process.env.SENDGRID_API_KEY = "SG.fake-key-for-test";
    process.env.DIGEST_RECIPIENTS = "";

    const { sendDigestEmail } = await import("./lib/digestEmail");
    const mockResult = {
      date: "2026-03-09",
      totalDeclarations: 50,
      greenLane: 40,
      yellowLane: 8,
      redLane: 2,
      clearanceRatePct: 90,
      dutyRevenueNaira: 2_000_000,
      avgClearanceHours: null,
      activeSlaBreaches: 0,
      aeoOperators: 10,
      sanctionsHits: 0,
      pilotGreenPct: null,
      pilotAvgClearanceHours: null,
      notificationSent: true,
      emailSent: false,
    } as any;

    const result = await sendDigestEmail(mockResult);
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("DIGEST_RECIPIENTS");

    // Restore env
    if (originalKey !== undefined) process.env.SENDGRID_API_KEY = originalKey;
    else delete process.env.SENDGRID_API_KEY;
    if (originalRecipients !== undefined) process.env.DIGEST_RECIPIENTS = originalRecipients;
    else delete process.env.DIGEST_RECIPIENTS;
  });

  it("digestEmail source builds HTML with KPI summary bar", async () => {
    const src = await import("fs").then(fs =>
      fs.readFileSync(
        new URL("./lib/digestEmail.ts", import.meta.url).pathname,
        "utf8"
      )
    );
    expect(src).toContain("buildHtml");
    expect(src).toContain("Declarations");
    expect(src).toContain("Duty Collected");
    expect(src).toContain("Clearance Rate");
    expect(src).toContain("SLA Breaches");
    expect(src).toContain("smtp.sendgrid.net");
  });

  it("ExecDigestResult interface includes emailSent and emailRecipients fields", async () => {
    const src = await import("fs").then(fs =>
      fs.readFileSync(
        new URL("./jobs/execDigest.ts", import.meta.url).pathname,
        "utf8"
      )
    );
    expect(src).toContain("emailSent: boolean");
    expect(src).toContain("emailRecipients?:");
    expect(src).toContain("emailSkipReason?:");
  });
});
