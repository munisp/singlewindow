import { describe, expect, it } from "vitest";
import {
  fromSelectValue,
  normalizeSelectOptions,
  SELECT_ALL_VALUE,
  toSelectValue,
} from "./normalizeSelectOptions";

describe("normalizeSelectOptions", () => {
  it("filters out empty and whitespace-only values", () => {
    const rows = [
      { code: "NGLOS", name: "Lagos" },
      { code: "", name: "Empty" },
      { code: "   ", name: "Blank" },
      { code: null, name: "Null" },
      { code: undefined, name: "Undef" },
    ];
    const opts = normalizeSelectOptions(rows, r => r.code, r => r.name);
    expect(opts).toEqual([{ value: "NGLOS", label: "Lagos" }]);
  });

  it("dedupes repeated values, keeping the first", () => {
    const rows = [
      { code: "A", name: "First" },
      { code: "A", name: "Second" },
      { code: "B", name: "Bee" },
    ];
    const opts = normalizeSelectOptions(rows, r => r.code, r => r.name);
    expect(opts).toEqual([
      { value: "A", label: "First" },
      { value: "B", label: "Bee" },
    ]);
  });

  it("trims values and defaults label to the value", () => {
    const opts = normalizeSelectOptions([{ code: " NGAPP " }], r => r.code);
    expect(opts).toEqual([{ value: "NGAPP", label: "NGAPP" }]);
  });

  it("returns an empty array for empty input", () => {
    expect(normalizeSelectOptions([], (x: never) => "")).toEqual([]);
  });
});

describe("select all-sentinel mapping", () => {
  it("maps the sentinel back to an empty filter value", () => {
    expect(fromSelectValue(SELECT_ALL_VALUE)).toBe("");
    expect(fromSelectValue("NGLOS")).toBe("NGLOS");
  });

  it("maps empty filter values to the sentinel", () => {
    expect(toSelectValue("")).toBe(SELECT_ALL_VALUE);
    expect(toSelectValue(null)).toBe(SELECT_ALL_VALUE);
    expect(toSelectValue(undefined)).toBe(SELECT_ALL_VALUE);
    expect(toSelectValue("  ")).toBe(SELECT_ALL_VALUE);
    expect(toSelectValue("NGLOS")).toBe("NGLOS");
  });
});
