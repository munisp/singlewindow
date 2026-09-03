/**
 * clearanceCertificate.test.ts — Phase 13 regression tests for
 * declarations.generateClearanceCertificate.
 *
 * Covers (with the storage boundary mocked — S3 is out of process):
 *  1. The pdfkit renderer emits a REAL PDF (%PDF magic bytes) — no shell-out
 *     chain, no HTML fallback.
 *  2. Happy path through the router: PDF uploaded, certificate record
 *     persisted, download URL returned.
 *  3. FAIL-CLOSED persistence: a failing DB insert fails the request (500),
 *     no download is issued, and the uploaded object is cleaned up
 *     best-effort. (Formerly `catch { /* Non-fatal *\/ }`.)
 *  4. DB unavailable → 500, no certificate issued.
 *  5. Non-cleared declarations are refused before any render/upload.
 *
 * The real-PostgreSQL persistence path is covered by
 * clearanceCertificate.db.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

// ─── Storage boundary mock (captures uploads, observes cleanup) ─────────────

const storageState = {
  uploads: [] as Array<{ key: string; data: Buffer; contentType: string }>,
  deletes: [] as string[],
};

vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string, data: Buffer | Uint8Array | string, contentType?: string) => {
    storageState.uploads.push({ key, data: Buffer.from(data as Buffer), contentType: contentType ?? "" });
    return { key, url: `https://storage.test/${key}` };
  }),
  storageDelete: vi.fn(async (key: string) => {
    storageState.deletes.push(key);
  }),
  storageGet: vi.fn(async (key: string) => ({ key, url: `https://storage.test/${key}` })),
}));

// ─── db mock (importOriginal + targeted overrides) ───────────────────────────

const dbState = {
  declaration: null as null | Record<string, unknown>,
  insertError: null as null | Error,
  inserted: [] as Array<Record<string, unknown>>,
  dbDown: false,
};

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDeclarationById: vi.fn(async () => dbState.declaration),
    getDb: vi.fn(async () => {
      if (dbState.dbDown) return null;
      return {
        insert: () => ({
          values: async (values: Record<string, unknown>) => {
            if (dbState.insertError) throw dbState.insertError;
            dbState.inserted.push(values);
          },
        }),
      };
    }),
  };
});

import { appRouter } from "./routers";
import { renderClearanceCertificatePdf } from "./clearanceCertificatePdf";

function makeCtx(userId = 42, role = "user"): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `test-${userId}`,
      email: `trader${userId}@example.com`,
      name: `Trader ${userId}`,
      loginMethod: "keycloak",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as TrpcContext["user"],
    keycloakRoles: [],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function clearedDeclaration(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    declarationNumber: "DECL-2026-CERT",
    traderId: 42,
    status: "cleared",
    declarationType: "import",
    ucr: "UCR-123",
    hsCode: "870380",
    goodsDescription: "Electric vehicles",
    countryOfOrigin: "CN",
    portOfEntry: "APAPA",
    numberOfPackages: 4,
    grossWeight: "1200.00",
    invoiceValue: "120000.00",
    invoiceCurrency: "USD",
    dutyAmount: "9000.00",
    vatAmount: "6750.00",
    totalDue: "15750.00",
    submittedAt: new Date("2026-08-01T09:00:00Z"),
    clearedAt: new Date("2026-08-14T15:30:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  storageState.uploads = [];
  storageState.deletes = [];
  dbState.declaration = clearedDeclaration();
  dbState.insertError = null;
  dbState.inserted = [];
  dbState.dbDown = false;
});

describe("renderClearanceCertificatePdf", () => {
  it("emits a real in-process PDF (%PDF magic bytes, EOF trailer)", async () => {
    const pdf = await renderClearanceCertificatePdf(
      clearedDeclaration() as never,
      "14 August 2026"
    );
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.subarray(pdf.length - 6).toString("latin1")).toContain("%%EOF");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

describe("declarations.generateClearanceCertificate", () => {
  it("uploads a real PDF and persists the certificate record", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.declarations.generateClearanceCertificate({ id: 1001 });
    expect(result.format).toBe("pdf");
    expect(result.url).toContain("https://storage.test/clearance-certificates/DECL-2026-CERT");

    expect(storageState.uploads).toHaveLength(1);
    expect(storageState.uploads[0].contentType).toBe("application/pdf");
    expect(storageState.uploads[0].data.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    expect(dbState.inserted).toHaveLength(1);
    expect(dbState.inserted[0]).toMatchObject({
      declarationId: 1001,
      traderId: 42,
      declarationRef: "DECL-2026-CERT",
      currency: "USD",
      generatedBy: 42,
    });
    expect(storageState.deletes).toHaveLength(0);
  });

  it("FAILS the request (500) and cleans up the uploaded object when persistence fails", async () => {
    dbState.insertError = new Error("relation clearance_certificates: insert failed");
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.declarations.generateClearanceCertificate({ id: 1001 })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    // The PDF was uploaded but the record could not be persisted → the
    // certificate is NOT delivered and the orphaned object is deleted.
    expect(storageState.uploads).toHaveLength(1);
    expect(storageState.deletes).toEqual([storageState.uploads[0].key]);
  });

  it("fails closed (500) when the database is unavailable", async () => {
    dbState.dbDown = true;
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.declarations.generateClearanceCertificate({ id: 1001 })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(dbState.inserted).toHaveLength(0);
    expect(storageState.deletes).toEqual([storageState.uploads[0]?.key].filter(Boolean));
  });

  it("refuses non-cleared declarations before any render or upload", async () => {
    dbState.declaration = clearedDeclaration({ status: "submitted" });
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.declarations.generateClearanceCertificate({ id: 1001 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storageState.uploads).toHaveLength(0);
    expect(dbState.inserted).toHaveLength(0);
  });

  it("enforces ownership for trader-role callers", async () => {
    dbState.declaration = clearedDeclaration({ traderId: 99 });
    const caller = appRouter.createCaller(makeCtx(42, "user"));
    await expect(
      caller.declarations.generateClearanceCertificate({ id: 1001 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storageState.uploads).toHaveLength(0);
  });
});
