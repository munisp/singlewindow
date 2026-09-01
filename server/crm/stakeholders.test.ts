/**
 * Phase 12 — Stakeholder-360 declaration_status enum regression test.
 *
 * Defect: getStakeholder360 originally filtered declarations.status with
 * ('submitted','under_review','assessed'), but the declaration_status enum
 * contains neither 'under_review' nor 'assessed', so the 360 endpoint
 * 503'd with `invalid input value for enum declaration_status` against the
 * real database.
 *
 * This test statically asserts that every status literal compared against
 * `declarations.status` in server/crm/stakeholders.ts is a real member of
 * the declarationStatusEnum exported from drizzle/schema.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { declarationStatusEnum } from "../../drizzle/schema";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "stakeholders.ts"), "utf8");

const ENUM_VALUES: readonly string[] = declarationStatusEnum.enumValues;

/** Extract every quoted literal appearing on lines that reference declarations.status. */
function declarationStatusLiterals(src: string): string[] {
  const literals: string[] = [];
  for (const line of src.split("\n")) {
    if (!line.includes("declarations.status")) continue;
    for (const m of line.matchAll(/'([^']+)'/g)) {
      literals.push(m[1]);
    }
  }
  return literals;
}

describe("stakeholder 360 declaration_status enum safety", () => {
  it("every declarations.status literal is a real declaration_status enum value", () => {
    const literals = declarationStatusLiterals(source);
    expect(literals.length).toBeGreaterThan(0);
    for (const lit of literals) {
      expect(
        ENUM_VALUES,
        `'${lit}' is not a member of the declaration_status enum (${ENUM_VALUES.join(", ")})`
      ).toContain(lit);
    }
  });

  it("does not use the invalid 'under_review'/'assessed' declaration statuses", () => {
    const literals = declarationStatusLiterals(source);
    expect(literals).not.toContain("under_review");
    expect(literals).not.toContain("assessed");
  });

  it("still counts both active-pipeline and cleared declarations", () => {
    const literals = declarationStatusLiterals(source);
    expect(literals).toContain("cleared");
    expect(literals).toContain("submitted");
  });
});
