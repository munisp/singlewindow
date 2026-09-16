/**
 * phase19.migration0072.test.ts — Phase 19 (F1: M3/M5 + H1) structural pins.
 * No DB required: verifies migration 0072 does not re-add the
 * queue_policy_decisions CHECK (would collide 42710 on fresh migrate — the
 * constraint now lives in drizzle/schema.ts), that the journal tracks 0071
 * + 0072, and that the marketplace catalogue excludes the officer-internal
 * queuePolicy/webhooks surfaces from the SIGNED public catalogue (M5).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildApiCatalogue, buildSignedCatalogue } from "./marketplace/apiCatalogue";

const root = join(__dirname, "..");
const sql0072 = readFileSync(
  join(root, "drizzle/migrations/0072_phase19_webhook_delivery_rl_suggestions.sql"),
  "utf8"
);
const journal = JSON.parse(
  readFileSync(join(root, "drizzle/migrations/meta/_journal.json"), "utf8")
) as { entries: { idx: number; tag: string }[] };
const schema = readFileSync(join(root, "drizzle/schema.ts"), "utf8");

describe("migration 0072 (H1/M1/M2/M3)", () => {
  it("creates queue_policy_suggestions + the episode decision columns", () => {
    expect(sql0072).toContain('CREATE TABLE "queue_policy_suggestions"');
    expect(sql0072).toContain('ALTER TABLE "queue_policy_decisions" ADD COLUMN "suggestion_id"');
    expect(sql0072).toContain("uq_qpd_suggestion_declaration_officer");
  });

  it("does NOT re-add the decision CHECK constraint (42710-safe, M3)", () => {
    expect(sql0072).not.toMatch(/ADD CONSTRAINT "queue_policy_decisions_decision_check"/i);
    expect(sql0072).toContain("intentionally skips it");
  });

  it("expresses the CHECK in drizzle/schema.ts instead (M3)", () => {
    expect(schema).toContain('check("queue_policy_decisions_decision_check"');
    expect(schema).toContain('export const queuePolicySuggestions = pgTable("queue_policy_suggestions"');
  });

  it("journal tracks 0071 and 0072 in order", () => {
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0071_phase19_imdg_dg_shore_pass");
    expect(tags).toContain("0072_phase19_webhook_delivery_rl_suggestions");
    expect(tags.indexOf("0071_phase19_imdg_dg_shore_pass")).toBeLessThan(
      tags.indexOf("0072_phase19_webhook_delivery_rl_suggestions")
    );
  });
});

describe("marketplace catalogue governance (M5)", () => {
  it("excludes queuePolicy/webhooks from the signed public catalogue", () => {
    const signed = buildSignedCatalogue(new Date(0));
    const text = JSON.stringify(signed);
    expect(text).not.toContain("queuePolicy");
    expect(text).not.toContain('"webhooks"');
  });

  it("keeps a single RESTRICTED singlewindow.rl-queue-policy entry", () => {
    const catalogue = buildApiCatalogue(new Date(0));
    const rl = catalogue.entries.filter((e) => e.apiId === "singlewindow.rl-queue-policy");
    expect(rl).toHaveLength(1);
    expect(rl[0].classification).toBe("RESTRICTED");
  });
});
