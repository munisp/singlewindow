/**
 * Phase 12 — declaration_status enum residual regression test.
 *
 * Defect (same failure class as the stakeholder-360 enum bug):
 * server/routers/officerWorkload.ts filtered declarations.status with
 * ('submitted','under_review','pending_payment') and
 * server/jobs/execDigest.ts built its SLA "processing statuses" array as
 * ["submitted","under_review","inspection_required","payment_pending"] —
 * but the declaration_status enum contains none of 'under_review',
 * 'pending_payment', or 'inspection_required', so these queries fail (or
 * silently match nothing) against the real database.
 *
 * This test statically asserts that every declaration-status literal used in
 * officerWorkload.ts and execDigest.ts is a real member of the
 * declarationStatusEnum exported from drizzle/schema.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { declarationStatusEnum } from "../../drizzle/schema";

const here = dirname(fileURLToPath(import.meta.url));
const officerWorkloadSource = readFileSync(join(here, "officerWorkload.ts"), "utf8");
const execDigestSource = readFileSync(join(here, "..", "jobs", "execDigest.ts"), "utf8");

const ENUM_VALUES: readonly string[] = declarationStatusEnum.enumValues;

/** Extract every single-quoted literal appearing on lines that reference declarations.status. */
function declarationStatusLiterals(src: string): string[] {
  const literals: string[] = [];
  for (const line of src.split("\n")) {
    if (!line.includes("declarations.status")) continue;
    for (const m of line.matchAll(/'([^']+)'|"([^"]+)"/g)) {
      literals.push(m[1] ?? m[2]);
    }
  }
  return literals;
}

/** Extract string literals from any `processingStatuses = [...]` array in the source. */
function processingStatusesLiterals(src: string): string[] {
  const literals: string[] = [];
  for (const m of src.matchAll(/processingStatuses\s*=\s*\[([^\]]*)\]/g)) {
    for (const lm of m[1].matchAll(/"([^"]+)"|'([^']+)'/g)) {
      literals.push(lm[1] ?? lm[2]);
    }
  }
  return literals;
}

describe("officerWorkload declaration_status enum safety", () => {
  it("every declarations.status literal is a real declaration_status enum value", () => {
    const literals = declarationStatusLiterals(officerWorkloadSource);
    expect(literals.length).toBeGreaterThan(0);
    for (const lit of literals) {
      expect(
        ENUM_VALUES,
        `'${lit}' is not a member of the declaration_status enum (${ENUM_VALUES.join(", ")})`
      ).toContain(lit);
    }
  });

  it("does not use the invalid 'under_review'/'pending_payment'/'inspection_required' statuses", () => {
    const literals = declarationStatusLiterals(officerWorkloadSource);
    expect(literals).not.toContain("under_review");
    expect(literals).not.toContain("pending_payment");
    expect(literals).not.toContain("inspection_required");
  });

  it("active-pipeline filters exclude terminal and draft statuses", () => {
    const literals = declarationStatusLiterals(officerWorkloadSource);
    expect(literals).toContain("submitted");
    expect(literals).toContain("under_assessment");
    expect(literals).toContain("payment_pending");
    expect(literals).toContain("cleared");
  });
});

describe("execDigest declaration_status enum safety", () => {
  it("every processingStatuses literal is a real declaration_status enum value", () => {
    const literals = processingStatusesLiterals(execDigestSource);
    expect(literals.length).toBeGreaterThan(0);
    for (const lit of literals) {
      expect(
        ENUM_VALUES,
        `'${lit}' is not a member of the declaration_status enum (${ENUM_VALUES.join(", ")})`
      ).toContain(lit);
    }
  });

  it("every declarations.status literal is a real declaration_status enum value", () => {
    const literals = declarationStatusLiterals(execDigestSource);
    expect(literals.length).toBeGreaterThan(0);
    for (const lit of literals) {
      expect(ENUM_VALUES, `'${lit}' is not a member of the declaration_status enum`).toContain(lit);
    }
  });

  it("does not use the invalid 'under_review'/'inspection_required'/'pending_payment' statuses", () => {
    const literals = [
      ...processingStatusesLiterals(execDigestSource),
      ...declarationStatusLiterals(execDigestSource),
    ];
    expect(literals).not.toContain("under_review");
    expect(literals).not.toContain("inspection_required");
    expect(literals).not.toContain("pending_payment");
  });

  it("processingStatuses is an active-pipeline subset (no terminal or draft states)", () => {
    const literals = processingStatusesLiterals(execDigestSource);
    expect(literals).toContain("submitted");
    expect(literals).toContain("under_assessment");
    expect(literals).toContain("under_examination");
    expect(literals).toContain("payment_pending");
    expect(literals).not.toContain("cleared");
    expect(literals).not.toContain("rejected");
    expect(literals).not.toContain("cancelled");
    expect(literals).not.toContain("draft");
  });
});
