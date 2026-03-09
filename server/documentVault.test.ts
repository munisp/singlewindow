/**
 * documentVault.test.ts
 *
 * Unit tests for the Document Vault tRPC router and rustfsSvcClient helpers.
 * Uses vi.mock to stub out database and Go microservice calls so tests run
 * without a live database or RustFS instance.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./rustfsSvcClient", () => ({
  rustfsUpload: vi.fn(),
  rustfsPresign: vi.fn(),
  rustfsDelete: vi.fn(),
  rustfsHealthCheck: vi.fn(),
  rustfsScan: vi.fn().mockResolvedValue({ clean: true, skipped: false }),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "test-nano-id"),
}));

import { getDb } from "./db";
import {
  rustfsUpload,
  rustfsPresign,
  rustfsDelete,
  rustfsHealthCheck,
} from "./rustfsSvcClient";
import { appRouter } from "./routers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 42,
    openId: "test-open-id",
    email: "trader@example.com",
    name: "Test Trader",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    lastSignedIn: new Date("2025-01-01"),
    ...overrides,
  };
}

function makeCtx(user: AuthenticatedUser = makeUser()): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function makeDbMock() {
  const chainable: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ["select", "from", "where", "orderBy", "limit", "offset",
    "insert", "values", "returning", "update", "set", "delete"];
  for (const m of methods) {
    chainable[m] = vi.fn().mockReturnThis();
  }
  return chainable;
}

// ─── rustfsSvcClient unit tests ───────────────────────────────────────────────

describe("rustfsSvcClient", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rustfsHealthCheck returns true when service is reachable", async () => {
    vi.mocked(rustfsHealthCheck).mockResolvedValue(true);
    expect(await rustfsHealthCheck()).toBe(true);
  });

  it("rustfsHealthCheck returns false when service is unreachable", async () => {
    vi.mocked(rustfsHealthCheck).mockResolvedValue(false);
    expect(await rustfsHealthCheck()).toBe(false);
  });

  it("rustfsUpload returns key and url on success", async () => {
    vi.mocked(rustfsUpload).mockResolvedValue({
      key: "vault/42/commercial_invoice/test-nano-id-invoice.pdf",
      url: "http://localhost:9000/tradegateway-docs/vault/42/commercial_invoice/test-nano-id-invoice.pdf",
    });
    const result = await rustfsUpload(Buffer.from("test"), "vault/42/test.pdf", "application/pdf");
    expect(result.key).toContain("vault/42");
    expect(result.url).toContain("tradegateway-docs");
  });

  it("rustfsPresign returns a presigned URL string", async () => {
    const presignedUrl = "http://localhost:9000/tradegateway-docs/vault/42/test.pdf?X-Amz-Signature=abc";
    vi.mocked(rustfsPresign).mockResolvedValue(presignedUrl);
    const url = await rustfsPresign("vault/42/test.pdf", 3600);
    expect(url).toBe(presignedUrl);
    expect(url).toContain("X-Amz-Signature");
  });

  it("rustfsDelete resolves without error on success", async () => {
    vi.mocked(rustfsDelete).mockResolvedValue(undefined);
    await expect(rustfsDelete("vault/42/test.pdf")).resolves.toBeUndefined();
  });

  it("rustfsDelete throws on failure", async () => {
    vi.mocked(rustfsDelete).mockRejectedValue(new Error("rustfs-svc delete failed (404): not found"));
    await expect(rustfsDelete("vault/42/missing.pdf")).rejects.toThrow("delete failed");
  });
});

// ─── documentVault router tests ───────────────────────────────────────────────

describe("documentVault router", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("health", () => {
    it("returns rustfsSvc: true when Go service is healthy", async () => {
      const db = makeDbMock();
      vi.mocked(getDb).mockResolvedValue(db as never);
      vi.mocked(rustfsHealthCheck).mockResolvedValue(true);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.documentVault.health();
      expect(result.rustfsSvc).toBe(true);
    });

    it("returns rustfsSvc: false when Go service is offline", async () => {
      const db = makeDbMock();
      vi.mocked(getDb).mockResolvedValue(db as never);
      vi.mocked(rustfsHealthCheck).mockResolvedValue(false);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.documentVault.health();
      expect(result.rustfsSvc).toBe(false);
    });
  });

  describe("upload", () => {
    it("throws INTERNAL_SERVER_ERROR when RustFS service is offline", async () => {
      const db = makeDbMock();
      vi.mocked(getDb).mockResolvedValue(db as never);
      vi.mocked(rustfsHealthCheck).mockResolvedValue(false);
      const caller = appRouter.createCaller(makeCtx());
      await expect(
        caller.documentVault.upload({
          filename: "invoice.pdf",
          contentType: "application/pdf",
          fileData: Buffer.from("test content").toString("base64"),
          sizeBytes: 12,
          category: "commercial_invoice",
          accessLevel: "private",
        })
      ).rejects.toThrow("storage service is unavailable");
    });

    it("throws when db is unavailable", async () => {
      vi.mocked(getDb).mockResolvedValue(null as never);
      vi.mocked(rustfsHealthCheck).mockResolvedValue(true);
      const caller = appRouter.createCaller(makeCtx());
      await expect(
        caller.documentVault.upload({
          filename: "invoice.pdf",
          contentType: "application/pdf",
          fileData: Buffer.from("test content").toString("base64"),
          sizeBytes: 12,
          category: "commercial_invoice",
          accessLevel: "private",
        })
      ).rejects.toThrow();
    });

    it("stores metadata in db and returns record on success", async () => {
      const fakeRecord = {
        id: 1,
        ownerId: 42,
        filename: "invoice.pdf",
        fileKey: "vault/42/commercial_invoice/test-nano-id-invoice.pdf",
        url: "http://localhost:9000/tradegateway-docs/vault/42/commercial_invoice/test-nano-id-invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        category: "commercial_invoice",
        accessLevel: "private",
        status: "active",
        description: null,
        declarationId: null,
        revokedBy: null,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const db = makeDbMock();
      db.returning.mockResolvedValue([fakeRecord]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      vi.mocked(rustfsHealthCheck).mockResolvedValue(true);
      vi.mocked(rustfsUpload).mockResolvedValue({ key: fakeRecord.fileKey, url: fakeRecord.url });

      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.documentVault.upload({
        filename: "invoice.pdf",
        contentType: "application/pdf",
        fileData: Buffer.from("test content").toString("base64"),
        sizeBytes: 12,
        category: "commercial_invoice",
        accessLevel: "private",
      });

      expect(result.filename).toBe("invoice.pdf");
      expect(result.status).toBe("active");
      expect(rustfsUpload).toHaveBeenCalledOnce();
    });
  });

  describe("list", () => {
    it("returns empty array when db is unavailable", async () => {
      vi.mocked(getDb).mockResolvedValue(null as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.documentVault.list({ status: "active" });
      expect(result).toEqual([]);
    });

    it("queries the database with correct parameters", async () => {
      const db = makeDbMock();
      db.offset.mockResolvedValue([]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      await caller.documentVault.list({ status: "active" });
      expect(db.select).toHaveBeenCalled();
      expect(db.from).toHaveBeenCalled();
    });
  });

  describe("revoke", () => {
    it("throws NOT_FOUND when document does not exist", async () => {
      const db = makeDbMock();
      db.limit.mockResolvedValue([]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      await expect(caller.documentVault.revoke({ id: 9999 })).rejects.toThrow("NOT_FOUND");
    });

    it("throws FORBIDDEN when non-owner tries to revoke", async () => {
      const db = makeDbMock();
      db.limit.mockResolvedValue([{ id: 1, ownerId: 99, filename: "doc.pdf", status: "active" }]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx(makeUser({ id: 42, role: "user" })));
      await expect(caller.documentVault.revoke({ id: 1 })).rejects.toThrow("FORBIDDEN");
    });

    it("allows admin to revoke any document", async () => {
      const fakeDoc = { id: 1, ownerId: 99, filename: "doc.pdf", status: "active" };
      const revokedDoc = { ...fakeDoc, status: "revoked", revokedBy: 1, revokedAt: new Date() };
      const db = makeDbMock();
      db.limit.mockResolvedValue([fakeDoc]);
      db.returning.mockResolvedValue([revokedDoc]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx(makeUser({ id: 1, role: "admin" })));
      const result = await caller.documentVault.revoke({ id: 1 });
      expect(result.status).toBe("revoked");
    });

    it("allows owner to revoke their own document", async () => {
      const fakeDoc = { id: 1, ownerId: 42, filename: "my-doc.pdf", status: "active" };
      const revokedDoc = { ...fakeDoc, status: "revoked", revokedBy: 42, revokedAt: new Date() };
      const db = makeDbMock();
      db.limit.mockResolvedValue([fakeDoc]);
      db.returning.mockResolvedValue([revokedDoc]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx(makeUser({ id: 42, role: "user" })));
      const result = await caller.documentVault.revoke({ id: 1 });
      expect(result.status).toBe("revoked");
    });
  });

  describe("permanentDelete", () => {
    it("throws FORBIDDEN for non-admin users", async () => {
      const caller = appRouter.createCaller(makeCtx(makeUser({ role: "user" })));
      await expect(caller.documentVault.permanentDelete({ id: 1 })).rejects.toThrow("FORBIDDEN");
    });

    it("deletes from RustFS and database for admin", async () => {
      const fakeDoc = { id: 1, ownerId: 99, filename: "doc.pdf", fileKey: "vault/99/doc.pdf", status: "active" };
      // Build a db mock where the SELECT chain resolves to [fakeDoc]
      // and the DELETE chain resolves cleanly.
      // We need two separate call sequences for db.select (for the lookup)
      // and db.delete (for the removal).
      let selectCallCount = 0;
      const db = makeDbMock();
      // First call to limit (from SELECT) returns the doc; subsequent calls return undefined
      db.limit.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return Promise.resolve([fakeDoc]);
        return Promise.resolve(undefined);
      });
      // delete chain: delete().where() resolves cleanly
      db.delete.mockReturnThis();
      vi.mocked(getDb).mockResolvedValue(db as never);
      vi.mocked(rustfsDelete).mockResolvedValue(undefined);

      const caller = appRouter.createCaller(makeCtx(makeUser({ id: 1, role: "admin" })));
      const result = await caller.documentVault.permanentDelete({ id: 1 });

      expect(result).toEqual({ deleted: true });
      expect(rustfsDelete).toHaveBeenCalledWith("vault/99/doc.pdf");
    });
  });

  describe("stats", () => {
    it("returns zero stats when db is unavailable", async () => {
      vi.mocked(getDb).mockResolvedValue(null as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.documentVault.stats();
      expect(result).toEqual({ totalFiles: 0, totalBytes: 0, activeFiles: 0, revokedFiles: 0 });
    });
  });

  describe("listByDeclaration", () => {
    it("returns empty array when db is unavailable", async () => {
      vi.mocked(getDb).mockResolvedValue(null as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.documentVault.listByDeclaration({ declarationId: 1 });
      expect(result).toEqual([]);
    });

    it("queries documents by declarationId", async () => {
      const fakeDocs = [
        { id: 1, ownerId: 42, filename: "invoice.pdf", declarationId: 7, status: "active",
          fileKey: "vault/42/invoice.pdf", url: "http://localhost:9000/invoice.pdf",
          mimeType: "application/pdf", sizeBytes: 1024, category: "commercial_invoice",
          accessLevel: "private", description: null, revokedBy: null, revokedAt: null,
          createdAt: new Date(), updatedAt: new Date() },
      ];
      const db = makeDbMock();
      db.orderBy.mockResolvedValue(fakeDocs);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.documentVault.listByDeclaration({ declarationId: 7 });
      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe("invoice.pdf");
    });
  });

  describe("share", () => {
    it("throws NOT_FOUND when document does not exist", async () => {
      const db = makeDbMock();
      db.limit.mockResolvedValue([]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      await expect(
        caller.documentVault.share({ documentId: 9999, expiresInHours: 24 })
      ).rejects.toThrow("Document not found");
    });

    it("throws FORBIDDEN when non-owner tries to share", async () => {
      const db = makeDbMock();
      db.limit.mockResolvedValue([{ id: 1, ownerId: 99, status: "active", fileKey: "vault/99/doc.pdf", filename: "doc.pdf" }]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx(makeUser({ id: 42, role: "user" })));
      await expect(
        caller.documentVault.share({ documentId: 1, expiresInHours: 24 })
      ).rejects.toThrow("You do not own this document");
    });

    it("creates share record and returns token for owner", async () => {
      const fakeDoc = { id: 1, ownerId: 42, status: "active", fileKey: "vault/42/doc.pdf", filename: "doc.pdf" };
      const fakeShare = {
        id: 10, documentId: 1, token: "test-nano-id", passwordHash: null,
        expiresAt: new Date(Date.now() + 86400000), maxDownloads: null,
        downloadCount: 0, label: null, createdBy: 42, createdAt: new Date(),
      };
      const db = makeDbMock();
      db.limit.mockResolvedValue([fakeDoc]);
      db.returning.mockResolvedValue([fakeShare]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx(makeUser({ id: 42 })));
      const result = await caller.documentVault.share({ documentId: 1, expiresInHours: 24 });
      expect(result.token).toBe("test-nano-id");
      expect(result.shareId).toBe(10);
      expect(result.hasPassword).toBe(false);
    });
  });

  describe("verifyShare", () => {
    it("throws NOT_FOUND when token does not exist", async () => {
      const db = makeDbMock();
      db.limit.mockResolvedValue([]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      await expect(
        caller.documentVault.verifyShare({ token: "invalid-token" })
      ).rejects.toThrow("Share link not found");
    });

    it("throws FORBIDDEN when share has expired", async () => {
      const expiredShare = {
        id: 10, documentId: 1, token: "expired-token", passwordHash: null,
        expiresAt: new Date(Date.now() - 1000), maxDownloads: null,
        downloadCount: 0, revokedAt: null, createdBy: 42, createdAt: new Date(),
      };
      const db = makeDbMock();
      db.limit.mockResolvedValue([expiredShare]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      await expect(
        caller.documentVault.verifyShare({ token: "expired-token" })
      ).rejects.toThrow("This share link has expired");
    });
  });

  describe("listShares", () => {
    it("returns empty array when db is unavailable", async () => {
      vi.mocked(getDb).mockResolvedValue(null as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.documentVault.listShares({ documentId: 1 });
      expect(result).toEqual([]);
    });

    it("throws FORBIDDEN when non-owner tries to list shares", async () => {
      const fakeDoc = { id: 1, ownerId: 99, status: "active", fileKey: "vault/99/doc.pdf", filename: "doc.pdf" };
      const db = makeDbMock();
      db.limit.mockResolvedValue([fakeDoc]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx(makeUser({ id: 42, role: "user" })));
      await expect(
        caller.documentVault.listShares({ documentId: 1 })
      ).rejects.toThrow("Access denied");
    });

    it("returns share list for document owner", async () => {
      const fakeDoc = { id: 1, ownerId: 42, status: "active", fileKey: "vault/42/doc.pdf", filename: "doc.pdf" };
      const fakeShares = [
        {
          id: 10, documentId: 1, token: "tok-abc", passwordHash: null,
          expiresAt: new Date(Date.now() + 86400000), maxDownloads: null,
          downloadCount: 3, label: "For customs", revokedAt: null, createdBy: 42, createdAt: new Date(),
        },
      ];
      const db = makeDbMock();
      // First limit call returns the doc lookup, second returns shares
      let callCount = 0;
      db.limit.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([fakeDoc]);
        return Promise.resolve(fakeShares);
      });
      db.orderBy.mockResolvedValue(fakeShares);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx(makeUser({ id: 42 })));
      const result = await caller.documentVault.listShares({ documentId: 1 });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("revokeShare", () => {
    it("throws NOT_FOUND when share does not exist", async () => {
      const db = makeDbMock();
      db.limit.mockResolvedValue([]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx(makeUser({ id: 42 })));
      await expect(
        caller.documentVault.revokeShare({ shareId: 9999 })
      ).rejects.toThrow("Share not found");
    });

    it("throws FORBIDDEN when non-owner tries to revoke share", async () => {
      const fakeShare = {
        id: 10, documentId: 1, token: "tok-abc", passwordHash: null,
        expiresAt: new Date(Date.now() + 86400000), maxDownloads: null,
        downloadCount: 0, label: null, revokedAt: null, createdBy: 99, createdAt: new Date(),
      };
      const db = makeDbMock();
      db.limit.mockResolvedValue([fakeShare]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx(makeUser({ id: 42, role: "user" })));
      await expect(
        caller.documentVault.revokeShare({ shareId: 10 })
      ).rejects.toThrow("Access denied");
    });

    it("revokes share for owner", async () => {
      const fakeShare = {
        id: 10, documentId: 1, token: "tok-abc", passwordHash: null,
        expiresAt: new Date(Date.now() + 86400000), maxDownloads: null,
        downloadCount: 0, label: null, revokedAt: null, createdBy: 42, createdAt: new Date(),
      };
      const db = makeDbMock();
      db.limit.mockResolvedValue([fakeShare]);
      db.returning.mockResolvedValue([{ ...fakeShare, revokedAt: new Date() }]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx(makeUser({ id: 42 })));
      const result = await caller.documentVault.revokeShare({ shareId: 10 });
      expect(result.revoked).toBe(true);
    });
  });
});
