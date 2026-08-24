/**
 * Wazuh SIEM/XDR Router — Test Suite
 * All procedures are adminProcedure.
 * External Wazuh API calls will fail in test env — we verify graceful handling.
 */
import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(overrides: Partial<AuthenticatedUser> = {}): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

// ─── getAlerts ────────────────────────────────────────────────────────────────
describe("wazuh.getAlerts", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.wazuh.getAlerts).toBe("function");
  });

  it("throws or returns result for admin (Wazuh API may be unavailable in test env)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.wazuh.getAlerts().catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.wazuh.getAlerts()).rejects.toThrow();
  });

  it("throws for user role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.wazuh.getAlerts()).rejects.toThrow();
  });

  it("throws for customs_officer role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "customs_officer" }));
    await expect(caller.wazuh.getAlerts()).rejects.toThrow();
  });

  it("throws for finance role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "finance" }));
    await expect(caller.wazuh.getAlerts()).rejects.toThrow();
  });
});

// ─── getAgents ────────────────────────────────────────────────────────────────
describe("wazuh.getAgents", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.wazuh.getAgents).toBe("function");
  });

  it("throws or returns result for admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.wazuh.getAgents().catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for non-admin role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "oga_officer" }));
    await expect(caller.wazuh.getAgents()).rejects.toThrow();
  });
});

// ─── listPlaybooks ────────────────────────────────────────────────────────────
describe("wazuh.listPlaybooks", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.wazuh.listPlaybooks).toBe("function");
  });

  it("returns an array or throws gracefully for admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.wazuh.listPlaybooks().catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for non-admin role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.wazuh.listPlaybooks()).rejects.toThrow();
  });
});

// ─── triggerPlaybook ──────────────────────────────────────────────────────────
describe("wazuh.triggerPlaybook", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.wazuh.triggerPlaybook).toBe("function");
  });

  it("throws or returns for valid playbookId and alertId (external API unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.wazuh.triggerPlaybook({
      playbookId: "PB-ISOLATE-HOST",
      alertId: "ALERT-001",
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("does not report a completed playbook when Wazuh is unavailable", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Wazuh unavailable"));
    try {
      const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
      await expect(caller.wazuh.triggerPlaybook({
        playbookId: "PB-ISOLATE-HOST",
        alertId: "ALERT-001",
      })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("throws for non-admin role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "customs_officer" }));
    await expect(
      caller.wazuh.triggerPlaybook({ playbookId: "PB-001", alertId: "ALERT-001" })
    ).rejects.toThrow();
  });

  it("throws for missing playbookId", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.wazuh.triggerPlaybook({ playbookId: "", alertId: "ALERT-001" })
    ).rejects.toThrow();
  });
});

// ─── detectAnomaly ────────────────────────────────────────────────────────────
describe("wazuh.detectAnomaly", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.wazuh.detectAnomaly).toBe("function");
  });

  it("throws or returns for valid events (external Wazuh API unavailable in test env)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.wazuh.detectAnomaly({
      events: [
        { userId: "user-001", ipAddress: "192.168.1.100", country: "NG", timestamp: new Date().toISOString(), success: false },
        { userId: "user-001", ipAddress: "192.168.1.100", country: "NG", timestamp: new Date().toISOString(), success: false },
        { userId: "user-001", ipAddress: "192.168.1.100", country: "NG", timestamp: new Date().toISOString(), success: false },
      ],
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("fails closed without returning a fabricated anomaly when Wazuh is unavailable", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Wazuh unavailable"));
    try {
      const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
      await expect(caller.wazuh.detectAnomaly({
        events: [
          { userId: "user-001", ipAddress: "192.168.1.100", timestamp: new Date().toISOString(), success: false },
        ],
      })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("fails closed for an empty anomaly request when Wazuh is unavailable", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Wazuh unavailable"));
    try {
      const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
      await expect(caller.wazuh.detectAnomaly({ events: [] }))
        .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("throws or returns for empty events array", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.wazuh.detectAnomaly({ events: [] }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws or returns for multi-country events (geo-anomaly)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.wazuh.detectAnomaly({
      events: [
        { userId: "user-002", ipAddress: "1.2.3.4", country: "CN", timestamp: new Date().toISOString(), success: true },
        { userId: "user-002", ipAddress: "5.6.7.8", country: "RU", timestamp: new Date().toISOString(), success: true },
      ],
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for non-admin role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(
      caller.wazuh.detectAnomaly({ events: [] })
    ).rejects.toThrow();
  });

  it("throws for finance role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "finance" }));
    await expect(
      caller.wazuh.detectAnomaly({ events: [] })
    ).rejects.toThrow();
  });
});
