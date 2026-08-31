/**
 * PRA-109 (Phase 9) — vitest gate wiring the Permify coverage checker into
 * the test suite: `pnpm test` fails when a protected router domain loses its
 * Permify entity/permission coverage or the registry goes stale.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

describe("permify authorization coverage gate (PRA-109)", () => {
  it("scripts/check-permify-coverage.mjs passes", () => {
    const out = execFileSync(process.execPath, ["scripts/check-permify-coverage.mjs"], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    expect(out).toContain("PERMIFY COVERAGE GATE: PASS");
  });
});
