/**
 * vesselIds.remediation.test.ts — Phase-11 remediation (MED)
 *
 * IMO check-digit + MMSI validation. Previously the server accepted any
 * 7-digit string as an IMO number (msw.createVisit) and unvalidated
 * MMSI/IMO values at the geospatial + cargoTracking ingestion/query paths.
 * Now all four acceptance paths run through shared validators
 * (server/_core/vesselIds.ts) and reject invalid identifiers with a 400
 * (BAD_REQUEST) validation error:
 *
 *   1. msw.createVisit              — vesselImoNumber (IMO check digit)
 *   2. geospatial.recordVesselPosition — mmsi + optional imoNumber
 *   3. geospatial.getVesselTrack    — optional mmsi/imoNumber filters
 *   4. cargoTracking.getVesselRoute — mmsi
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
  listVesselTracking: vi.fn(async () => []),
  insertVesselPosition: vi.fn(async () => ({ id: 1 })),
}));

// mswService is never reached for invalid input (zod rejects first), but
// mock it so importing the router cannot touch Kafka/Postgres.
vi.mock("../mswService", () => ({
  MSW_AGENCY_ROLES: ["msw-agent", "msw-port-health"],
  MswServiceError: class MswServiceError extends Error {
    reasonCode = "X";
  },
  createVisit: vi.fn(async () => ({ visitId: "v-1" })),
  nominateAgent: vi.fn(),
  submitDeclaration: vi.fn(),
  acceptDeclaration: vi.fn(),
  returnDeclaration: vi.fn(),
  grantPratique: vi.fn(),
  refusePratique: vi.fn(),
  scheduleBoarding: vi.fn(),
  completeBoarding: vi.fn(),
  grantClearance: vi.fn(),
  refuseClearance: vi.fn(),
}));

import { isValidImoNumber, isValidMmsi } from "../_core/vesselIds";
import { mswRouter } from "./msw";
import { geospatialRouter } from "./geospatial";
import { cargoTrackingRouter } from "./cargoTracking";
import type { TrpcContext } from "../_core/context";

function makeCtx(role = "admin"): TrpcContext {
  return {
    user: {
      id: 7, openId: "t-1", email: "t@e.com", name: "t",
      loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    keycloakRoles: ["msw-agent"],
    req: { protocol: "https", headers: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as TrpcContext;
}

const KNOWN_VALID_IMO = "9074729"; // real IMO with valid check digit

describe("isValidImoNumber", () => {
  it("accepts known-valid IMO numbers", () => {
    expect(isValidImoNumber(KNOWN_VALID_IMO)).toBe(true);
    expect(isValidImoNumber("9386976")).toBe(true); // another real IMO
    expect(isValidImoNumber("1234567")).toBe(true); // weights sum to 77 → check 7
  });

  it("rejects every single-digit corruption of a valid IMO", () => {
    for (let pos = 0; pos < 7; pos++) {
      const digits = KNOWN_VALID_IMO.split("");
      digits[pos] = String((Number(digits[pos]) + 1) % 10);
      expect(isValidImoNumber(digits.join(""))).toBe(false);
    }
  });

  it("rejects malformed values", () => {
    for (const bad of ["", "123456", "12345678", "907472A", "IMO9074729", "907-4729", " 9074729"]) {
      expect(isValidImoNumber(bad)).toBe(false);
    }
  });
});

describe("isValidMmsi", () => {
  it("accepts valid MMSIs (incl. Nigerian MID 657)", () => {
    expect(isValidMmsi("657123456")).toBe(true); // Nigeria
    expect(isValidMmsi("636099999")).toBe(true); // Liberia
    expect(isValidMmsi("200000000")).toBe(true); // range floor
    expect(isValidMmsi("799999999")).toBe(true); // range ceiling
  });

  it("rejects MIDs outside the assignable 200-799 range", () => {
    expect(isValidMmsi("000000000")).toBe(false);
    expect(isValidMmsi("199999999")).toBe(false);
    expect(isValidMmsi("800123456")).toBe(false);
    expect(isValidMmsi("999123456")).toBe(false);
  });

  it("rejects malformed values", () => {
    for (const bad of ["", "12345678", "1234567890", "65712345A", "657-123-456"]) {
      expect(isValidMmsi(bad)).toBe(false);
    }
  });
});

async function expectBadRequest(fn: () => Promise<unknown>) {
  await expect(fn()).rejects.toMatchObject({ code: "BAD_REQUEST" });
}

describe("acceptance paths reject invalid identifiers (400)", () => {
  const validVisit = {
    vesselImoNumber: KNOWN_VALID_IMO,
    vesselName: "MV TEST",
    vesselFlagCode: "NG",
    portCode: "NGLAG",
    agentReference: "AGT-1",
    eta: "2026-02-01T00:00:00Z",
  };

  it("msw.createVisit rejects an IMO with a bad check digit", async () => {
    const caller = mswRouter.createCaller(makeCtx());
    await expectBadRequest(() => caller.createVisit({ ...validVisit, vesselImoNumber: "9074728" }));
    await expectBadRequest(() => caller.createVisit({ ...validVisit, vesselImoNumber: "123456" }));
  });

  it("geospatial.recordVesselPosition rejects bad MMSI / IMO", async () => {
    const caller = geospatialRouter.createCaller(makeCtx());
    const base = { mmsi: "657123456", latitude: 6.4, longitude: 3.4 };
    await expectBadRequest(() => caller.recordVesselPosition({ ...base, mmsi: "000000001" }));
    await expectBadRequest(() => caller.recordVesselPosition({ ...base, mmsi: "12345678" }));
    await expectBadRequest(() => caller.recordVesselPosition({ ...base, imoNumber: "9074728" }));
    // valid input passes validation (db is mocked; insert returns a row)
    await expect(caller.recordVesselPosition({ ...base, imoNumber: KNOWN_VALID_IMO })).resolves.toBeTruthy();
  });

  it("geospatial.getVesselTrack rejects bad MMSI / IMO filters", async () => {
    const caller = geospatialRouter.createCaller(makeCtx());
    await expectBadRequest(() => caller.getVesselTrack({ mmsi: "000000001" }));
    await expectBadRequest(() => caller.getVesselTrack({ imoNumber: "9074728" }));
    await expect(caller.getVesselTrack({ mmsi: "657123456", imoNumber: KNOWN_VALID_IMO })).resolves.toEqual([]);
  });

  it("cargoTracking.getVesselRoute rejects a bad MMSI", async () => {
    const caller = cargoTrackingRouter.createCaller(makeCtx());
    await expectBadRequest(() => caller.getVesselRoute({ mmsi: "000000001" }));
    await expectBadRequest(() => caller.getVesselRoute({ mmsi: "not-a-mmsi" }));
  });
});
