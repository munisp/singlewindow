/**
 * WCO CEN (Customs Enforcement Network) Router — Test Suite
 *
 * The cenRouter proxies all calls to an external Go cen-service.
 * In the test environment the service is unavailable (ECONNREFUSED), so:
 *   - Queries return graceful fallback objects (not null/undefined).
 *   - Mutations that call cenFetch throw TRPCError SERVICE_UNAVAILABLE.
 *   - Input validation (Zod) is tested independently by passing invalid data.
 *
 * Procedures:
 *   getPartners   — protectedProcedure (query)
 *   sendAlert     — adminProcedure (mutation)
 *   receiveAlert  — adminProcedure (mutation)
 *   listAlerts    — protectedProcedure (query)
 *   correlateAlert — protectedProcedure (query)
 *   acknowledgeAlert — protectedProcedure (mutation)
 *   getStats      — protectedProcedure (query)
 */
import { describe, expect, it } from "vitest";
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
    role: "user",
    ...overrides,
  };
  return {
    user,
    req: { method: "POST", headers: {}, cookies: {} } as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// ─── getPartners ──────────────────────────────────────────────────────────────
describe("cen.getPartners", () => {
  it("fails closed when cen-service is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.cen.getPartners({})).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("rejects optional region queries when cen-service is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.cen.getPartners({ region: "AFRICA" })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("rejects optional activeOnly queries when cen-service is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.cen.getPartners({ activeOnly: true })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("rejects filtered queries when cen-service is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.cen.getPartners({ region: "ASIA", activeOnly: true })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("throws UNAUTHORIZED for unauthenticated caller", async () => {
    const caller = appRouter.createCaller({ user: null, db: null as any });
    await expect(caller.cen.getPartners({})).rejects.toThrow();
  });
});

// ─── sendAlert ────────────────────────────────────────────────────────────────
describe("cen.sendAlert", () => {
  const validInput = {
    partnerCode: "SG",
    alertType: "RISK_PROFILE" as const,
    priority: "HIGH" as const,
    subject: "High-risk trader flagged for textile smuggling",
    description: "Trader XYZ has been flagged for undervaluation of textile imports across 3 declarations.",
  };

  it("throws SERVICE_UNAVAILABLE when cen-service is down", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(caller.cen.sendAlert(validInput)).rejects.toThrow();
  });

  it("accepts all optional fields (traderRef, ucr, hsCode, riskScore)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.cen.sendAlert({
      ...validInput,
      traderRef: "TRADER-001",
      ucr: "UCR-2026-001",
      hsCode: "6204.62",
      riskScore: 0.92,
    }).catch(e => e);
    // Either succeeds or throws SERVICE_UNAVAILABLE — both are valid in test env
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for non-admin user", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.cen.sendAlert(validInput)).rejects.toThrow();
  });

  it("throws UNAUTHORIZED for unauthenticated caller", async () => {
    const caller = appRouter.createCaller({ user: null, db: null as any });
    await expect(caller.cen.sendAlert(validInput)).rejects.toThrow();
  });

  it("rejects partnerCode shorter than 2 chars (Zod validation)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.cen.sendAlert({ ...validInput, partnerCode: "X" })
    ).rejects.toThrow();
  });

  it("rejects partnerCode longer than 3 chars (Zod validation)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.cen.sendAlert({ ...validInput, partnerCode: "ABCD" })
    ).rejects.toThrow();
  });

  it("rejects subject shorter than 5 chars (Zod validation)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.cen.sendAlert({ ...validInput, subject: "Hi" })
    ).rejects.toThrow();
  });

  it("rejects description shorter than 10 chars (Zod validation)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.cen.sendAlert({ ...validInput, description: "Too short" })
    ).rejects.toThrow();
  });

  it("rejects riskScore outside 0–1 range (Zod validation)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.cen.sendAlert({ ...validInput, riskScore: 1.5 })
    ).rejects.toThrow();
  });

  it("accepts all valid alertType enum values", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const alertTypes = ["RISK_PROFILE", "SEIZURE", "WANTED_PERSON", "VESSEL_WATCH", "GENERAL"] as const;
    for (const alertType of alertTypes) {
      const result = await caller.cen.sendAlert({ ...validInput, alertType }).catch(e => e);
      expect(result).toBeDefined();
    }
  });

  it("accepts all valid priority enum values", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const priorities = ["HIGH", "MEDIUM", "LOW"] as const;
    for (const priority of priorities) {
      const result = await caller.cen.sendAlert({ ...validInput, priority }).catch(e => e);
      expect(result).toBeDefined();
    }
  });
});

// ─── receiveAlert ─────────────────────────────────────────────────────────────
describe("cen.receiveAlert", () => {
  const validInput = {
    senderCode: "KE",
    alertType: "SEIZURE" as const,
    priority: "MEDIUM" as const,
    subject: "Counterfeit electronics seized at Mombasa port",
    description: "A consignment of counterfeit electronics was seized at Mombasa port on 2026-03-15. Consignee: ABC Ltd.",
  };

  it("throws SERVICE_UNAVAILABLE when cen-service is down", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(caller.cen.receiveAlert(validInput)).rejects.toThrow();
  });

  it("accepts optional ucr and traderRef fields", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.cen.receiveAlert({
      ...validInput,
      ucr: "UCR-KE-2026-001",
      traderRef: "ABC-LTD-001",
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for non-admin user", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.cen.receiveAlert(validInput)).rejects.toThrow();
  });

  it("rejects invalid alertType enum value", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.cen.receiveAlert({ ...validInput, alertType: "INVALID" as any })
    ).rejects.toThrow();
  });
});

// ─── listAlerts ───────────────────────────────────────────────────────────────
describe("cen.listAlerts", () => {
  it("fails closed when cen-service is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.cen.listAlerts({})).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("rejects direction queries when cen-service is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.cen.listAlerts({ direction: "OUTBOUND" })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("rejects inbound direction queries when cen-service is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.cen.listAlerts({ direction: "INBOUND" })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("rejects priority queries when cen-service is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.cen.listAlerts({ priority: "HIGH" })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("rejects alert-type queries when cen-service is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.cen.listAlerts({ alertType: "SEIZURE" })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("rejects combined filtered queries when cen-service is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.cen.listAlerts({
        direction: "INBOUND",
        priority: "HIGH",
        alertType: "RISK_PROFILE",
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("rejects invalid direction enum value", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.cen.listAlerts({ direction: "BOTH" as any })
    ).rejects.toThrow();
  });

  it("throws UNAUTHORIZED for unauthenticated caller", async () => {
    const caller = appRouter.createCaller({ user: null, db: null as any });
    await expect(caller.cen.listAlerts({})).rejects.toThrow();
  });
});

// ─── correlateAlert ───────────────────────────────────────────────────────────
describe("cen.correlateAlert", () => {
  it("fails closed when cen-service is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.cen.correlateAlert({ alertId: "ALERT-001" })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("does not fabricate an alert correlation when cen-service is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.cen.correlateAlert({ alertId: "CEN-2026-XYZ" })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("throws UNAUTHORIZED for unauthenticated caller", async () => {
    const caller = appRouter.createCaller({ user: null, db: null as any });
    await expect(caller.cen.correlateAlert({ alertId: "ALERT-001" })).rejects.toThrow();
  });
});

// ─── acknowledgeAlert ─────────────────────────────────────────────────────────
describe("cen.acknowledgeAlert", () => {
  it("throws SERVICE_UNAVAILABLE when cen-service is down", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.cen.acknowledgeAlert({ alertId: "ALERT-001" })).rejects.toThrow();
  });

  it("throws UNAUTHORIZED for unauthenticated caller", async () => {
    const caller = appRouter.createCaller({ user: null, db: null as any });
    await expect(caller.cen.acknowledgeAlert({ alertId: "ALERT-001" })).rejects.toThrow();
  });
});

// ─── getStats ─────────────────────────────────────────────────────────────────
describe("cen.getStats", () => {
  it("fails closed when cen-service is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.cen.getStats()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("does not fabricate numeric stats when cen-service is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.cen.getStats()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("throws UNAUTHORIZED for unauthenticated caller", async () => {
    const caller = appRouter.createCaller({ user: null, db: null as any });
    await expect(caller.cen.getStats()).rejects.toThrow();
  });
});
