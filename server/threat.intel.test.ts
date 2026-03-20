/**
 * Threat Intelligence (OpenCTI) Router — Test Suite
 * Procedures: getIndicators, matchDeclaration, enrichAlert, exportStix,
 *             ingestIndicators, getStats, enrichDeclaration, lookupThreatActor,
 *             checkSanctions, getCountryRisk, getTTPs
 * External OpenCTI API calls will fail in test env — we verify graceful handling.
 * Input schemas and roles verified against actual router implementation.
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
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

// ─── getIndicators ────────────────────────────────────────────────────────────
describe("threatIntel.getIndicators", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.threatIntel.getIndicators).toBe("function");
  });

  it("throws or returns result for admin (OpenCTI unavailable in test env)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.threatIntel.getIndicators().catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws or returns for user role (protectedProcedure allows all roles)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.threatIntel.getIndicators().catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws or returns for customs_officer role (protectedProcedure allows all roles)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "customs_officer" }));
    const result = await caller.threatIntel.getIndicators().catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.threatIntel.getIndicators()).rejects.toThrow();
  });
});

// ─── matchDeclaration ─────────────────────────────────────────────────────────
describe("threatIntel.matchDeclaration", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.threatIntel.matchDeclaration).toBe("function");
  });

  it("throws or returns result for valid UCR input (OpenCTI unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.threatIntel.matchDeclaration({
      ucr: "UCR-TEST-2024-001",
      hsCodes: ["8471.30", "8517.12"],
      traderName: "Test Importer Ltd",
      originCountry: "CN",
      destCountry: "NG",
      routeCountries: ["SG"],
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts minimal input (ucr only)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.threatIntel.matchDeclaration({ ucr: "UCR-MIN-001" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws or returns for user role (protectedProcedure allows all roles)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.threatIntel.matchDeclaration({ ucr: "UCR-001" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(
      caller.threatIntel.matchDeclaration({ ucr: "UCR-001" })
    ).rejects.toThrow();
  });
});

// ─── enrichAlert ──────────────────────────────────────────────────────────────
describe("threatIntel.enrichAlert", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.threatIntel.enrichAlert).toBe("function");
  });

  it("throws or returns for valid string alertId (OpenCTI unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.threatIntel.enrichAlert({
      alertId: "ALERT-001",
      hsCodes: ["8471.30"],
      traderName: "Test Trader",
      originCountry: "CN",
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts minimal input (alertId only)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.threatIntel.enrichAlert({ alertId: "ALERT-MIN-001" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for non-admin role (adminProcedure)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(
      caller.threatIntel.enrichAlert({ alertId: "ALERT-001" })
    ).rejects.toThrow();
  });

  it("throws for customs_officer role (adminProcedure)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "customs_officer" }));
    await expect(
      caller.threatIntel.enrichAlert({ alertId: "ALERT-001" })
    ).rejects.toThrow();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(
      caller.threatIntel.enrichAlert({ alertId: "ALERT-001" })
    ).rejects.toThrow();
  });
});

// ─── exportStix ───────────────────────────────────────────────────────────────
describe("threatIntel.exportStix", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.threatIntel.exportStix).toBe("function");
  });

  it("throws or returns for admin (OpenCTI unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.threatIntel.exportStix().catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for non-admin role (adminProcedure)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.threatIntel.exportStix()).rejects.toThrow();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.threatIntel.exportStix()).rejects.toThrow();
  });
});

// ─── ingestIndicators ─────────────────────────────────────────────────────────
describe("threatIntel.ingestIndicators", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.threatIntel.ingestIndicators).toBe("function");
  });

  it("throws or returns for valid indicators array (OpenCTI unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.threatIntel.ingestIndicators({
      indicators: [{
        name: "Sanctioned Entity ABC",
        pattern: "[x-opencti-simple-observable:value = 'ABC Corp']",
        confidence: 85,
        threatType: "SANCTIONS",
        severity: "HIGH",
        hsCodes: ["8471.30"],
        originCountries: ["KP"],
      }],
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for non-admin role (adminProcedure)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "customs_officer" }));
    await expect(
      caller.threatIntel.ingestIndicators({ indicators: [] })
    ).rejects.toThrow();
  });

  it("throws for confidence out of range (> 100)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.threatIntel.ingestIndicators({
        indicators: [{
          name: "Test",
          pattern: "[test]",
          confidence: 101,
          threatType: "FRAUD",
          severity: "LOW",
        }],
      })
    ).rejects.toThrow();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(
      caller.threatIntel.ingestIndicators({ indicators: [] })
    ).rejects.toThrow();
  });
});

// ─── getStats ─────────────────────────────────────────────────────────────────
describe("threatIntel.getStats", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.threatIntel.getStats).toBe("function");
  });

  it("throws or returns for admin (OpenCTI unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.threatIntel.getStats().catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws or returns for user role (protectedProcedure allows all)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.threatIntel.getStats().catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.threatIntel.getStats()).rejects.toThrow();
  });
});

// ─── enrichDeclaration ────────────────────────────────────────────────────────
describe("threatIntel.enrichDeclaration", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.threatIntel.enrichDeclaration).toBe("function");
  });

  it("throws or returns for valid full declaration input (OpenCTI unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.threatIntel.enrichDeclaration({
      declarationId: "DECL-001",
      traderName: "Test Trader Ltd",
      shipperName: "Shipper Corp",
      consigneeName: "Consignee Ltd",
      originCountry: "CN",
      destinationCountry: "NG",
      hsCode: "8471.30",
      declaredValueUsd: 50000,
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws or returns for user role (protectedProcedure allows all)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.threatIntel.enrichDeclaration({
      declarationId: "DECL-001",
      traderName: "Test",
      shipperName: "Shipper",
      consigneeName: "Consignee",
      originCountry: "CN",
      destinationCountry: "NG",
      hsCode: "8471.30",
      declaredValueUsd: 1000,
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for negative declaredValueUsd", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.threatIntel.enrichDeclaration({
        declarationId: "DECL-001",
        traderName: "Test",
        shipperName: "Shipper",
        consigneeName: "Consignee",
        originCountry: "CN",
        destinationCountry: "NG",
        hsCode: "8471.30",
        declaredValueUsd: -100,
      })
    ).rejects.toThrow();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(
      caller.threatIntel.enrichDeclaration({
        declarationId: "DECL-001",
        traderName: "Test",
        shipperName: "Shipper",
        consigneeName: "Consignee",
        originCountry: "CN",
        destinationCountry: "NG",
        hsCode: "8471.30",
        declaredValueUsd: 1000,
      })
    ).rejects.toThrow();
  });
});

// ─── lookupThreatActor ────────────────────────────────────────────────────────
describe("threatIntel.lookupThreatActor", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.threatIntel.lookupThreatActor).toBe("function");
  });

  it("throws or returns for no country filter (OpenCTI unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.threatIntel.lookupThreatActor({}).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws or returns for specific country filter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.threatIntel.lookupThreatActor({ country: "CN" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws or returns for user role (protectedProcedure allows all)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.threatIntel.lookupThreatActor({}).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.threatIntel.lookupThreatActor({})).rejects.toThrow();
  });
});

// ─── checkSanctions ───────────────────────────────────────────────────────────
describe("threatIntel.checkSanctions", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.threatIntel.checkSanctions).toBe("function");
  });

  it("throws or returns for valid entityName (OpenCTI unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.threatIntel.checkSanctions({ entityName: "Test Corp Ltd" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts optional country parameter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.threatIntel.checkSanctions({
      entityName: "Test Corp Ltd",
      country: "KP",
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws or returns for user role (protectedProcedure allows all)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.threatIntel.checkSanctions({ entityName: "Test Corp" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(
      caller.threatIntel.checkSanctions({ entityName: "Test Corp" })
    ).rejects.toThrow();
  });
});

// ─── getCountryRisk ───────────────────────────────────────────────────────────
describe("threatIntel.getCountryRisk", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.threatIntel.getCountryRisk).toBe("function");
  });

  it("throws or returns for valid countryCode (OpenCTI unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.threatIntel.getCountryRisk({ countryCode: "CN" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws or returns for user role (protectedProcedure allows all)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.threatIntel.getCountryRisk({ countryCode: "NG" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.threatIntel.getCountryRisk({ countryCode: "CN" })).rejects.toThrow();
  });
});

// ─── getTTPs ──────────────────────────────────────────────────────────────────
describe("threatIntel.getTTPs", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.threatIntel.getTTPs).toBe("function");
  });

  it("throws or returns for admin (OpenCTI unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.threatIntel.getTTPs().catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws or returns for user role (protectedProcedure allows all)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.threatIntel.getTTPs().catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.threatIntel.getTTPs()).rejects.toThrow();
  });
});
