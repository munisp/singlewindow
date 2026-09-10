/**
 * Phase 17 (G1/G8) — CSP origin whitelist parsing tests.
 */
import { describe, it, expect } from "vitest";
import { parseCspOrigins } from "./csp";

describe("parseCspOrigins", () => {
  it("parses comma-separated https origins", () => {
    expect(parseCspOrigins("https://tiles.openfreemap.org, https://tile.openstreetmap.org")).toEqual([
      "https://tiles.openfreemap.org",
      "https://tile.openstreetmap.org",
    ]);
  });

  it("returns empty for unset/blank env (fail-closed)", () => {
    expect(parseCspOrigins(undefined)).toEqual([]);
    expect(parseCspOrigins("   ")).toEqual([]);
  });

  it("drops wildcards, http, and malformed entries — a typo can never widen CSP", () => {
    expect(parseCspOrigins("*, https://ok.example.com, http://insecure.example.com, notaurl")).toEqual([
      "https://ok.example.com",
    ]);
  });

  it("allows data:/blob: tokens for inline assets", () => {
    expect(parseCspOrigins("data:,blob:")).toEqual(["data:", "blob:"]);
  });
});
