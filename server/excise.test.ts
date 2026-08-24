import { afterEach, describe, expect, it } from "vitest";
import {
  IMPOSSIBLE_TRAVEL_SPEED_KMH,
  calculateExciseLiability,
  mintExciseUid,
  verifyExciseUid,
} from "./routers/excise";

const originalKey = process.env.EXCISE_UID_HMAC_KEY;
const originalKeyId = process.env.EXCISE_UID_KEY_ID;

afterEach(() => {
  if (originalKey === undefined) delete process.env.EXCISE_UID_HMAC_KEY;
  else process.env.EXCISE_UID_HMAC_KEY = originalKey;
  if (originalKeyId === undefined) delete process.env.EXCISE_UID_KEY_ID;
  else process.env.EXCISE_UID_KEY_ID = originalKeyId;
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

  it("keeps one named physical threshold for impossible-travel detection", () => {
    expect(IMPOSSIBLE_TRAVEL_SPEED_KMH).toBe(120);
  });
});
