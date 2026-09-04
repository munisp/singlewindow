import { describe, expect, it } from "vitest";
import { countryName, humanizeLabel } from "./formatters";

describe("humanizeLabel", () => {
  it("maps docs_required", () => expect(humanizeLabel("docs_required")).toBe("Docs Required"));
  it("maps payment_pending", () => expect(humanizeLabel("payment_pending")).toBe("Payment Pending"));
  it("maps under_review", () => expect(humanizeLabel("under_review")).toBe("Under Review"));
  it("maps re_export", () => expect(humanizeLabel("re_export")).toBe("Re-Export"));
  it("maps mobile_money", () => expect(humanizeLabel("mobile_money")).toBe("Mobile Money"));
  it("maps bank_transfer", () => expect(humanizeLabel("bank_transfer")).toBe("Bank Transfer"));
  it("maps not_required", () => expect(humanizeLabel("not_required")).toBe("Not Required"));

  it("applies special-word casing", () => {
    expect(humanizeLabel("oga_officer")).toBe("OGA Officer");
    expect(humanizeLabel("Oga Officer")).toBe("OGA Officer");
  });

  it("masks seed artifacts with a generic label", () => {
    expect(humanizeLabel("seed-oga_permits-permit_type-171")).toBe("Permit Type");
    expect(humanizeLabel("seed-docs-invoice-42")).toBe("Invoice");
  });

  it("title-cases unknown snake_case values", () => {
    expect(humanizeLabel("arrived_at_port")).toBe("Arrived At Port");
  });

  it("returns the fallback for null/empty input", () => {
    expect(humanizeLabel(null)).toBe("—");
    expect(humanizeLabel(undefined)).toBe("—");
    expect(humanizeLabel("")).toBe("—");
    expect(humanizeLabel(null, "Unknown")).toBe("Unknown");
  });
});

describe("countryName", () => {
  it("maps Nigerian abbreviations", () => {
    expect(countryName("Nig")).toBe("Nigeria");
    expect(countryName("NG")).toBe("Nigeria");
    expect(countryName("NGA")).toBe("Nigeria");
  });

  it("maps ISO alpha-2/alpha-3 codes", () => {
    expect(countryName("GH")).toBe("Ghana");
    expect(countryName("CHN")).toBe("China");
    expect(countryName("USA")).toBe("United States");
  });

  it("passes through unknown values and handles null", () => {
    expect(countryName("Wakanda")).toBe("Wakanda");
    expect(countryName(null)).toBe("—");
    expect(countryName("")).toBe("—");
  });
});
