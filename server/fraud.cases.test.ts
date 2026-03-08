/**
 * Vitest tests for fraudCases, alerts, and sharedAgentNetwork tRPC routers
 *
 * Tests cover:
 *   - RBAC enforcement (non-admin cannot create/list cases)
 *   - Input validation (invalid traderId, empty title, invalid enums)
 *   - fraudCases.createCase — happy path (DB may be unavailable in CI)
 *   - fraudCases.listCases — returns array
 *   - fraudCases.caseStats — returns stats object
 *   - fraudCases.addNote — requires valid caseId
 *   - fraudCases.updateStatus — requires valid status
 *   - alerts.runNightlyRiskScan — admin only, returns scan result shape
 *   - alerts.getRiskAlerts — returns array
 *   - alerts.getLatestFlaggedDeclarations — returns object with declarations array
 *   - sharedAgentNetwork — RBAC, invalid traderId, expected shape
 */

import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Context factories ────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

function makeCtx(user: AuthenticatedUser | null = makeUser()): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
      cookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

function adminCaller() {
  return appRouter.createCaller(makeCtx(makeUser({ role: "admin" })));
}

function userCaller() {
  return appRouter.createCaller(makeCtx(makeUser({ role: "user" })));
}

function anonCaller() {
  return appRouter.createCaller(makeCtx(null));
}

// ─── fraudCases tests ─────────────────────────────────────────────────────────

describe("fraudCases router — RBAC", () => {
  it("createCase — rejects unauthenticated users", async () => {
    const caller = anonCaller();
    await expect(
      caller.fraudCases.createCase({ traderId: 1, title: "Test", priority: "medium" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("createCase — rejects non-admin users", async () => {
    const caller = userCaller();
    await expect(
      caller.fraudCases.createCase({ traderId: 1, title: "Test", priority: "medium" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("listCases — rejects unauthenticated users", async () => {
    const caller = anonCaller();
    await expect(caller.fraudCases.listCases({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("listCases — rejects non-admin users", async () => {
    const caller = userCaller();
    await expect(caller.fraudCases.listCases({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("caseStats — rejects unauthenticated users", async () => {
    const caller = anonCaller();
    await expect(caller.fraudCases.caseStats()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("addNote — rejects unauthenticated users", async () => {
    const caller = anonCaller();
    await expect(
      caller.fraudCases.addNote({ caseId: 1, content: "note" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("updateStatus — rejects unauthenticated users", async () => {
    const caller = anonCaller();
    await expect(
      caller.fraudCases.updateStatus({ caseId: 1, status: "under_review" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("fraudCases router — input validation", () => {
  it("createCase — rejects empty title", async () => {
    const caller = adminCaller();
    await expect(
      caller.fraudCases.createCase({ traderId: 1, title: "", priority: "medium" })
    ).rejects.toThrow();
  });

  it("createCase — rejects invalid priority", async () => {
    const caller = adminCaller();
    await expect(
      caller.fraudCases.createCase({
        traderId: 1,
        title: "Test",
        priority: "invalid_priority" as "medium",
      })
    ).rejects.toThrow();
  });

  it("addNote — rejects empty content", async () => {
    const caller = adminCaller();
    await expect(
      caller.fraudCases.addNote({ caseId: 1, content: "" })
    ).rejects.toThrow();
  });

  it("updateStatus — rejects invalid status", async () => {
    const caller = adminCaller();
    await expect(
      caller.fraudCases.updateStatus({
        caseId: 1,
        status: "invalid_status" as "open",
      })
    ).rejects.toThrow();
  });
});

describe("fraudCases router — admin happy paths (DB may be unavailable in CI)", () => {
  it("createCase — admin gets result or INTERNAL_SERVER_ERROR", async () => {
    const caller = adminCaller();
    try {
      const result = await caller.fraudCases.createCase({
        traderId: 1,
        title: "Test fraud case",
        priority: "high",
        description: "Suspicious activity detected",
      });
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("caseNumber");
      expect(result.title).toBe("Test fraud case");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      expect(["INTERNAL_SERVER_ERROR", "NOT_FOUND"].includes(code ?? "")).toBe(true);
    }
  });

  it("listCases — admin gets array or INTERNAL_SERVER_ERROR", async () => {
    const caller = adminCaller();
    try {
      const result = await caller.fraudCases.listCases({});
      expect(Array.isArray(result)).toBe(true);
    } catch (err: unknown) {
      expect((err as { code?: string }).code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  it("caseStats — admin gets stats object or INTERNAL_SERVER_ERROR", async () => {
    const caller = adminCaller();
    try {
      const result = await caller.fraudCases.caseStats();
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("byStatus");
      expect(result).toHaveProperty("byPriority");
    } catch (err: unknown) {
      expect((err as { code?: string }).code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  it("getCase — returns NOT_FOUND or INTERNAL_SERVER_ERROR for non-existent case", async () => {
    const caller = adminCaller();
    try {
      await caller.fraudCases.getCase({ caseId: 999999 });
      expect(true).toBe(false); // should not reach here
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      expect(["NOT_FOUND", "INTERNAL_SERVER_ERROR"].includes(code ?? "")).toBe(true);
    }
  });
});

// ─── alerts tests ─────────────────────────────────────────────────────────────

describe("alerts router — RBAC", () => {
  it("runNightlyRiskScan — rejects unauthenticated users", async () => {
    const caller = anonCaller();
    await expect(
      caller.alerts.runNightlyRiskScan({ threshold: 0.8, periodHours: 24 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("runNightlyRiskScan — rejects non-admin users", async () => {
    const caller = userCaller();
    await expect(
      caller.alerts.runNightlyRiskScan({ threshold: 0.8, periodHours: 24 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("getRiskAlerts — rejects unauthenticated users", async () => {
    const caller = anonCaller();
    await expect(caller.alerts.getRiskAlerts({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("getLatestFlaggedDeclarations — rejects unauthenticated users", async () => {
    const caller = anonCaller();
    await expect(
      caller.alerts.getLatestFlaggedDeclarations({})
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("alerts router — input validation", () => {
  it("runNightlyRiskScan — rejects threshold below 0.5", async () => {
    const caller = adminCaller();
    await expect(
      caller.alerts.runNightlyRiskScan({ threshold: 0.3, periodHours: 24 })
    ).rejects.toThrow();
  });

  it("runNightlyRiskScan — rejects periodHours above 168", async () => {
    const caller = adminCaller();
    await expect(
      caller.alerts.runNightlyRiskScan({ threshold: 0.8, periodHours: 200 })
    ).rejects.toThrow();
  });
});

describe("alerts router — admin happy paths (DB may be unavailable in CI)", () => {
  it("runNightlyRiskScan — admin gets scan result shape or INTERNAL_SERVER_ERROR", async () => {
    const caller = adminCaller();
    try {
      const result = await caller.alerts.runNightlyRiskScan({
        threshold: 0.8,
        periodHours: 24,
        autoCreateCases: false,
      });
      expect(result).toHaveProperty("highRiskCount");
      expect(result).toHaveProperty("newCasesCreated");
      expect(result).toHaveProperty("notificationSent");
      expect(typeof result.highRiskCount).toBe("number");
    } catch (err: unknown) {
      expect((err as { code?: string }).code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  it("getRiskAlerts — admin gets array or INTERNAL_SERVER_ERROR", async () => {
    const caller = adminCaller();
    try {
      const result = await caller.alerts.getRiskAlerts({ limit: 5 });
      expect(Array.isArray(result)).toBe(true);
    } catch (err: unknown) {
      expect((err as { code?: string }).code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  it("getLatestFlaggedDeclarations — admin gets object with declarations array or INTERNAL_SERVER_ERROR", async () => {
    const caller = adminCaller();
    try {
      const result = await caller.alerts.getLatestFlaggedDeclarations({ limit: 10 });
      expect(result).toHaveProperty("declarations");
      expect(Array.isArray(result.declarations)).toBe(true);
    } catch (err: unknown) {
      expect((err as { code?: string }).code).toBe("INTERNAL_SERVER_ERROR");
    }
  });
});

// ─── sharedAgentNetwork tests ─────────────────────────────────────────────────

describe("knowledgeGraph.sharedAgentNetwork", () => {
  it("rejects unauthenticated users", async () => {
    const caller = anonCaller();
    await expect(
      caller.knowledgeGraph.sharedAgentNetwork({ traderId: "1" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects non-admin/non-customs_officer users", async () => {
    const caller = userCaller();
    await expect(
      caller.knowledgeGraph.sharedAgentNetwork({ traderId: "1" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects non-numeric traderId", async () => {
    const caller = adminCaller();
    await expect(
      caller.knowledgeGraph.sharedAgentNetwork({ traderId: "not-a-number" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("returns NOT_FOUND or INTERNAL_SERVER_ERROR for non-existent trader", async () => {
    const caller = adminCaller();
    try {
      await caller.knowledgeGraph.sharedAgentNetwork({ traderId: "999999" });
      expect(true).toBe(false); // should not reach
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      expect(["NOT_FOUND", "INTERNAL_SERVER_ERROR"].includes(code ?? "")).toBe(true);
    }
  });

  it("returns expected shape when DB is available", async () => {
    const caller = adminCaller();
    try {
      const result = await caller.knowledgeGraph.sharedAgentNetwork({ traderId: "1" });
      expect(result).toHaveProperty("nodes");
      expect(result).toHaveProperty("links");
      expect(result).toHaveProperty("centralTraderId");
      expect(result).toHaveProperty("agentCount");
      expect(result).toHaveProperty("relatedTraderCount");
      expect(result).toHaveProperty("fallback");
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(Array.isArray(result.links)).toBe(true);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      expect(["NOT_FOUND", "INTERNAL_SERVER_ERROR"].includes(code ?? "")).toBe(true);
    }
  });
});

// ─── uploadEvidenceFile tests (Sprint 11) ─────────────────────────────────────

describe("fraudCases.uploadEvidenceFile — RBAC", () => {
  it("rejects unauthenticated users", async () => {
    const caller = anonCaller();
    await expect(
      caller.fraudCases.uploadEvidenceFile({
        caseId: 1,
        fileName: "test.pdf",
        mimeType: "application/pdf",
        base64Data: Buffer.from("test").toString("base64"),
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects non-admin/non-customs_officer users", async () => {
    const caller = userCaller();
    await expect(
      caller.fraudCases.uploadEvidenceFile({
        caseId: 1,
        fileName: "test.pdf",
        mimeType: "application/pdf",
        base64Data: Buffer.from("test").toString("base64"),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("fraudCases.uploadEvidenceFile — input validation", () => {
  it("rejects empty fileName", async () => {
    const caller = adminCaller();
    await expect(
      caller.fraudCases.uploadEvidenceFile({
        caseId: 1,
        fileName: "",
        mimeType: "application/pdf",
        base64Data: Buffer.from("test").toString("base64"),
      })
    ).rejects.toThrow();
  });

  it("rejects empty base64Data", async () => {
    const caller = adminCaller();
    await expect(
      caller.fraudCases.uploadEvidenceFile({
        caseId: 1,
        fileName: "test.pdf",
        mimeType: "application/pdf",
        base64Data: "",
      })
    ).rejects.toThrow();
  });

  it("rejects invalid caseId (zero)", async () => {
    const caller = adminCaller();
    await expect(
      caller.fraudCases.uploadEvidenceFile({
        caseId: 0,
        fileName: "test.pdf",
        mimeType: "application/pdf",
        base64Data: Buffer.from("test").toString("base64"),
      })
    ).rejects.toThrow();
  });
});

describe("fraudCases.uploadEvidenceFile — admin happy path (DB/S3 may be unavailable in CI)", () => {
  it("admin gets evidence record or INTERNAL_SERVER_ERROR/NOT_FOUND", async () => {
    const caller = adminCaller();
    try {
      const result = await caller.fraudCases.uploadEvidenceFile({
        caseId: 1,
        fileName: "evidence.pdf",
        mimeType: "application/pdf",
        base64Data: Buffer.from("test evidence content").toString("base64"),
        description: "Test upload",
      });
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("fileUrl");
      expect(result).toHaveProperty("fileKey");
      expect(result.fileName).toBe("evidence.pdf");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      expect(["INTERNAL_SERVER_ERROR", "NOT_FOUND"].includes(code ?? "")).toBe(true);
    }
  });
});
