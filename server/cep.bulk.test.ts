import { describe, it, expect, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock pg pool
vi.mock("./db", () => ({
  getPool: () => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
  }),
}));

const mockCtx: TrpcContext = {
  user: { id: 1, openId: "officer-001", role: "user", name: "Test Officer", email: "officer@example.com" } as any,
  req: {} as any,
  res: {} as any,
};

describe("cep.bulkAcknowledge", () => {
  it("rejects empty alertIds array", async () => {
    const caller = appRouter.createCaller(mockCtx);
    await expect(
      caller.cep.bulkAcknowledge({ alertIds: [], status: "resolved" })
    ).rejects.toThrow();
  });

  it("rejects more than 100 alertIds", async () => {
    const caller = appRouter.createCaller(mockCtx);
    const ids = Array.from({ length: 101 }, (_, i) => `CEP-2024-${String(i).padStart(4, "0")}`);
    await expect(
      caller.cep.bulkAcknowledge({ alertIds: ids, status: "resolved" })
    ).rejects.toThrow();
  });

  it("accepts valid bulk resolve input with resolution note", async () => {
    const caller = appRouter.createCaller(mockCtx);
    // With mocked pool returning empty rows (no rows updated = success: false per alert)
    const result = await caller.cep.bulkAcknowledge({
      alertIds: ["CEP-2024-0001", "CEP-2024-0002"],
      status: "resolved",
      resolutionNote: "Confirmed false positive after manual review",
    });
    expect(result).toHaveProperty("succeeded");
    expect(result).toHaveProperty("failed");
    expect(result).toHaveProperty("results");
    expect(result.results).toHaveLength(2);
  });

  it("accepts false_positive status", async () => {
    const caller = appRouter.createCaller(mockCtx);
    const result = await caller.cep.bulkAcknowledge({
      alertIds: ["CEP-2024-0003"],
      status: "false_positive",
    });
    expect(result.results[0].alertId).toBe("CEP-2024-0003");
  });

  it("accepts investigating status without resolution note", async () => {
    const caller = appRouter.createCaller(mockCtx);
    const result = await caller.cep.bulkAcknowledge({
      alertIds: ["CEP-2024-0004"],
      status: "investigating",
    });
    expect(result).toHaveProperty("succeeded");
  });

  it("rejects invalid status value", async () => {
    const caller = appRouter.createCaller(mockCtx);
    await expect(
      caller.cep.bulkAcknowledge({ alertIds: ["CEP-2024-0001"], status: "invalid" as any })
    ).rejects.toThrow();
  });

  it("rejects resolution note exceeding 1000 chars", async () => {
    const caller = appRouter.createCaller(mockCtx);
    await expect(
      caller.cep.bulkAcknowledge({
        alertIds: ["CEP-2024-0001"],
        status: "resolved",
        resolutionNote: "x".repeat(1001),
      })
    ).rejects.toThrow();
  });
});
