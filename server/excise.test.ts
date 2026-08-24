import { afterEach, describe, expect, it } from "vitest";
import {
  IMPOSSIBLE_TRAVEL_SPEED_KMH,
  calculateImpossibleTravelSpeedKmh,
  calculateExciseLiability,
  mintExciseUid,
  verifyExciseUid,
} from "./routers/excise";

const originalKey = process.env.EXCISE_UID_HMAC_KEY;
const originalKeyId = process.env.EXCISE_UID_KEY_ID;
const originalKeys = process.env.EXCISE_UID_HMAC_KEYS;
const originalIssuedKeyIds = process.env.EXCISE_UID_ISSUED_KEY_IDS;

afterEach(() => {
  if (originalKey === undefined) delete process.env.EXCISE_UID_HMAC_KEY;
  else process.env.EXCISE_UID_HMAC_KEY = originalKey;
  if (originalKeyId === undefined) delete process.env.EXCISE_UID_KEY_ID;
  else process.env.EXCISE_UID_KEY_ID = originalKeyId;
  if (originalKeys === undefined) delete process.env.EXCISE_UID_HMAC_KEYS;
  else process.env.EXCISE_UID_HMAC_KEYS = originalKeys;
  if (originalIssuedKeyIds === undefined) delete process.env.EXCISE_UID_ISSUED_KEY_IDS;
  else process.env.EXCISE_UID_ISSUED_KEY_IDS = originalIssuedKeyIds;
});

describe("excise digital marks", () => {
  it("mints unique, non-sequential signed UIDs", () => {
    process.env.EXCISE_UID_HMAC_KEY = "a".repeat(64);
    process.env.EXCISE_UID_KEY_ID = "rotation-1";
    const first = mintExciseUid();
    const second = mintExciseUid();

    expect(first.uid).not.toBe(second.uid);
    expect(first.uid).not.toMatch(/000001|000002/);
    expect(verifyExciseUid(first.uid)).toEqual({
      status: "signature_valid_pending_reconciliation",
      keyId: "rotation-1",
    });
  });

  it("refuses missing, short, and development placeholder signing keys", () => {
    delete process.env.EXCISE_UID_HMAC_KEY;
    expect(() => mintExciseUid()).toThrow();
    process.env.EXCISE_UID_HMAC_KEY = "dev-excise-key";
    expect(() => mintExciseUid()).toThrow();
    process.env.EXCISE_UID_HMAC_KEY = "b".repeat(64);
    expect(verifyExciseUid("v1.random.invalid").status).toBe("invalid_signature");
    process.env.EXCISE_UID_KEY_ID = "issued-but-unavailable";
    process.env.EXCISE_UID_ISSUED_KEY_IDS = "issued-but-unavailable";
    delete process.env.EXCISE_UID_HMAC_KEY;
    expect(verifyExciseUid("issued-but-unavailable.random.invalid").status).toBe("verification_unavailable");
  });

  it("verifies marks signed by a retained rotated key", () => {
    process.env.EXCISE_UID_HMAC_KEY = "c".repeat(64);
    process.env.EXCISE_UID_KEY_ID = "rotation-2";
    const previous = mintExciseUid();
    process.env.EXCISE_UID_HMAC_KEY = "d".repeat(64);
    process.env.EXCISE_UID_KEY_ID = "rotation-3";
    process.env.EXCISE_UID_HMAC_KEYS = JSON.stringify({ "rotation-2": "c".repeat(64) });
    expect(verifyExciseUid(previous.uid).status).toBe("signature_valid_pending_reconciliation");
    delete process.env.EXCISE_UID_HMAC_KEYS;
  });

  it("calculates fiscal liability on the server from the tax scheme", () => {
    expect(calculateExciseLiability({
      schemeType: "specific",
      specificAmount: "2.50",
      adValoremRate: null,
      hybridWhicheverGreater: false,
    }, { unitContent: "1", unitOfMeasure: "unit" }, 4, undefined)).toBe("10.00");
    expect(calculateExciseLiability({
      schemeType: "hybrid",
      specificAmount: "1.00",
      adValoremRate: "10",
      hybridWhicheverGreater: true,
    }, { unitContent: "1", unitOfMeasure: "unit" }, 2, "100.00")).toBe("20.00");
  });

  it("flags impossible travel only when implied speed exceeds the threshold", () => {
    const previous = { latitude: 0, longitude: 0, scannedAt: new Date("2024-01-01T00:00:00Z") };
    const below = calculateImpossibleTravelSpeedKmh(previous, {
      latitude: 0, longitude: 1, scannedAt: new Date("2024-01-01T02:00:00Z"),
    });
    const above = calculateImpossibleTravelSpeedKmh(previous, {
      latitude: 0, longitude: 1, scannedAt: new Date("2024-01-01T00:30:00Z"),
    });
    expect(below).not.toBeNull();
    expect(below!).toBeLessThan(IMPOSSIBLE_TRAVEL_SPEED_KMH);
    expect(above!).toBeGreaterThan(IMPOSSIBLE_TRAVEL_SPEED_KMH);
  });
});
