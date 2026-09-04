/**
 * PRA-109 (Phase 9) — vitest wiring for the Permify authorization coverage
 * gate. Runs the real coverage script (scripts/check-permify-coverage.mjs):
 * every protected router domain must map to a Permify entity with permission
 * rules, and every router must be explicitly registered or exempted.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

describe("Permify authorization coverage gate (PRA-109)", () => {
  it("reports full coverage of protected resource domains", () => {
    const out = execFileSync(process.execPath, ["scripts/check-permify-coverage.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(out).toContain("PERMIFY COVERAGE GATE: PASS");
    expect(out).toMatch(/Coverage: 65\/65 protected domains covered/);
  });
});
