/**
 * clearanceCertificate.db.test.ts — Phase 13 REAL DB-gated regression test for
 * declarations.generateClearanceCertificate (PRA-043 harness pattern).
 *
 * Runs the mutation against a fresh PostgreSQL database carrying the full
 * migration chain (server/testutils/pgTestHarness.ts). Only the storage
 * boundary (S3 proxy) is mocked — the captured upload is asserted to be a
 * REAL PDF (%PDF magic bytes) and the certificate row is read back from the
 * real database. Skips cleanly with a printed reason when PostgreSQL is down.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { createTestDatabase } from "./testutils/pgTestHarness";

// ─── Storage boundary mock (captures the uploaded bytes) ────────────────────

const uploads: Array<{ key: string; data: Buffer; contentType: string }> = [];
vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string, data: Buffer | Uint8Array | string, contentType?: string) => {
    uploads.push({ key, data: Buffer.from(data as Buffer), contentType: contentType ?? "" });
    return { key, url: `https://storage.test/${key}` };
  }),
  storageDelete: vi.fn(async () => {}),
  storageGet: vi.fn(async (key: string) => ({ key, url: `https://storage.test/${key}` })),
}));

const tdb = await createTestDatabase("clearance_cert");
if (tdb) process.env.DATABASE_URL = tdb.url;
const describeDb = tdb ? describe : describe.skip;

// Lazy imports: DATABASE_URL must be set before server/db.ts (and anything in
// the appRouter import graph that touches a pool at module load) is evaluated.
const { appRouter } = await import("./routers");
const { closePool, createDeclaration, updateDeclaration, getDb } = await import("./db");
const { clearanceCertificates } = await import("../drizzle/schema");
const { eq } = await import("drizzle-orm");

afterAll(async () => {
  await closePool();
  await tdb?.close();
});

const TRADER = 902;

function makeTraderCtx(userId = TRADER): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `test-${userId}`,
      email: `trader${userId}@example.com`,
      name: `Trader ${userId}`,
      loginMethod: "keycloak",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as TrpcContext["user"],
    keycloakRoles: [],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describeDb("generateClearanceCertificate against real PostgreSQL (Phase 13)", () => {
  it("uploads a real PDF and persists the certificate row transactionally", async () => {
    const decl = await createDeclaration({
      declarationNumber: "DECL-2026-CERTDB",
      traderId: TRADER,
      declarationType: "import",
      hsCode: "870380",
      goodsDescription: "Electric vehicles",
      countryOfOrigin: "CN",
      countryOfDestination: "NG",
      portOfEntry: "APAPA",
      invoiceValue: "120000.00",
      invoiceCurrency: "USD",
      dutyAmount: "9000.00",
      vatAmount: "6750.00",
      totalDue: "15750.00",
    });
    await updateDeclaration(decl.id, { status: "cleared", clearedAt: new Date() });

    uploads.length = 0;
    const caller = appRouter.createCaller(makeTraderCtx());
    const result = await caller.declarations.generateClearanceCertificate({ id: decl.id });
    expect(result.format).toBe("pdf");

    // The uploaded object is a REAL PDF — never an HTML fallback.
    expect(uploads).toHaveLength(1);
    expect(uploads[0].contentType).toBe("application/pdf");
    expect(uploads[0].data.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // The certificate row is durably persisted — read back through a fresh query.
    const db = await getDb();
    const rows = await db!
      .select()
      .from(clearanceCertificates)
      .where(eq(clearanceCertificates.declarationId, decl.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      declarationId: decl.id,
      traderId: TRADER,
      declarationRef: "DECL-2026-CERTDB",
      fileKey: uploads[0].key,
      fileUrl: `https://storage.test/${uploads[0].key}`,
      currency: "USD",
      generatedBy: TRADER,
    });

    // listMyCertificates reads back the persisted row for the owner.
    const mine = await caller.declarations.listMyCertificates({});
    expect(mine.certificates.map((c) => c.declarationRef)).toContain("DECL-2026-CERTDB");
  });
});
