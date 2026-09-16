/**
 * imdg.test.ts — structural IMDG validation (Phase 19 F5a / A5-B9).
 *
 * Pure unit tests: no DB, no network. The validator must reject malformed
 * UN numbers, non-existent classes/divisions, packing-group misuse and
 * class-3 items without a flashpoint — and normalize valid items.
 */
import { describe, expect, it } from "vitest";
import {
  IMDG_CLASS_CODES,
  isImdgClassCode,
  packingGroupApplies,
  validateImdgItem,
} from "./imdg";

const VALID_BASE = {
  unNumber: "1203",
  imoClass: "3",
  packingGroup: "II",
  properShippingName: "GASOLINE",
  flashpointCelsius: -43,
  emsCodes: ["F-E", "S-E"],
  marinePollutant: false,
};

describe("IMDG structural validation", () => {
  it("accepts and normalizes a valid class 3 item", () => {
    const r = validateImdgItem(VALID_BASE);
    expect(r.ok).toBe(true);
    expect(r.normalized).toMatchObject({
      unNumber: "1203",
      imoClass: "3",
      packingGroup: "II",
      properShippingName: "GASOLINE",
      flashpointCelsius: -43,
      emsCodes: ["F-E", "S-E"],
      marinePollutant: false,
    });
  });

  it("normalizes case/whitespace (packing group, EmS, PSN trim)", () => {
    const r = validateImdgItem({ ...VALID_BASE, packingGroup: " ii ", emsCodes: [" f-e "] });
    expect(r.ok).toBe(true);
    expect(r.normalized?.packingGroup).toBe("II");
    expect(r.normalized?.emsCodes).toEqual(["F-E"]);
  });

  it.each(["123", "12345", "12A3", "", "120-3"])("rejects malformed UN number %j", (unNumber) => {
    expect(validateImdgItem({ ...VALID_BASE, unNumber }).ok).toBe(false);
  });

  it.each(["0000", "0003", "3551", "9999"])("rejects out-of-range UN number %j", (unNumber) => {
    const r = validateImdgItem({ ...VALID_BASE, unNumber });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/range/);
  });

  it("accepts boundary UN numbers 0004 and 3550", () => {
    for (const unNumber of ["0004", "3550"]) {
      expect(validateImdgItem({ ...VALID_BASE, unNumber }).ok).toBe(true);
    }
  });

  it.each(["10", "1.7", "2.4", "4.4", "5.3", "6.3", "1", "2", "4", "5", "6", "3.1", ""])(
    "rejects non-admitted class/division %j",
    (imoClass) => {
      expect(validateImdgItem({ ...VALID_BASE, imoClass }).ok).toBe(false);
    }
  );

  it("admits exactly the IMDG class/division set", () => {
    expect(IMDG_CLASS_CODES).toHaveLength(20);
    for (const c of IMDG_CLASS_CODES) expect(isImdgClassCode(c)).toBe(true);
  });

  it("requires a packing group for PG classes and forbids it for non-PG classes", () => {
    // class 3 without PG → reject
    expect(validateImdgItem({ ...VALID_BASE, packingGroup: null }).ok).toBe(false);
    // class 7 WITH PG → reject
    expect(
      validateImdgItem({
        ...VALID_BASE,
        imoClass: "7",
        packingGroup: null,
        flashpointCelsius: null,
      }).ok
    ).toBe(true); // 7: no PG, no flashpoint required
    expect(
      validateImdgItem({ ...VALID_BASE, imoClass: "7", packingGroup: "III", flashpointCelsius: null }).ok
    ).toBe(false);
    // class 2.2 WITH PG → reject
    expect(
      validateImdgItem({ ...VALID_BASE, imoClass: "2.2", packingGroup: "II", flashpointCelsius: null }).ok
    ).toBe(false);
    // class 1.4 WITHOUT PG → accept
    expect(
      validateImdgItem({ ...VALID_BASE, imoClass: "1.4", packingGroup: null, flashpointCelsius: null }).ok
    ).toBe(true);
  });

  it("rejects an invalid packing group label", () => {
    expect(validateImdgItem({ ...VALID_BASE, packingGroup: "IV" }).ok).toBe(false);
  });

  it("requires flashpoint for class 3 and bounds it structurally", () => {
    expect(validateImdgItem({ ...VALID_BASE, flashpointCelsius: null }).ok).toBe(false);
    expect(validateImdgItem({ ...VALID_BASE, flashpointCelsius: -101 }).ok).toBe(false);
    expect(validateImdgItem({ ...VALID_BASE, flashpointCelsius: 301 }).ok).toBe(false);
    expect(validateImdgItem({ ...VALID_BASE, flashpointCelsius: Number.NaN }).ok).toBe(false);
  });

  it("does not require flashpoint outside class 3", () => {
    expect(
      validateImdgItem({ ...VALID_BASE, imoClass: "8", flashpointCelsius: null }).ok
    ).toBe(true);
  });

  it("validates EmS schedule shapes and multiplicity", () => {
    expect(validateImdgItem({ ...VALID_BASE, emsCodes: ["F-K"] }).ok).toBe(false);
    expect(validateImdgItem({ ...VALID_BASE, emsCodes: ["S-1"] }).ok).toBe(false);
    expect(validateImdgItem({ ...VALID_BASE, emsCodes: ["F-A", "F-B"] }).ok).toBe(false);
    expect(validateImdgItem({ ...VALID_BASE, emsCodes: ["S-A", "S-B"] }).ok).toBe(false);
    expect(validateImdgItem({ ...VALID_BASE, emsCodes: ["F-A", "S-Z"] }).ok).toBe(true);
  });

  it("rejects a missing/short proper shipping name", () => {
    expect(validateImdgItem({ ...VALID_BASE, properShippingName: "" }).ok).toBe(false);
    expect(validateImdgItem({ ...VALID_BASE, properShippingName: "X" }).ok).toBe(false);
  });

  it("collects multiple violations at once", () => {
    const r = validateImdgItem({ unNumber: "1", imoClass: "11", packingGroup: "IV", properShippingName: "" });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("packingGroupApplies matches the PG class set", () => {
    for (const c of ["3", "4.1", "4.2", "4.3", "5.1", "6.1", "8", "9"]) {
      expect(packingGroupApplies(c)).toBe(true);
    }
    for (const c of ["1.1", "1.6", "2.1", "2.2", "2.3", "5.2", "6.2", "7"]) {
      expect(packingGroupApplies(c)).toBe(false);
    }
  });
});
