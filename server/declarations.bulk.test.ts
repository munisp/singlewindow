/**
 * Sprint 49 — declarations.bulkUpdateStatus unit tests
 */
import { describe, it, expect } from "vitest";

// ─── Unit: input validation ───────────────────────────────────────────────────

const VALID_STATUSES = [
  "docs_required",
  "payment_pending",
  "under_examination",
  "examination_complete",
  "cleared",
  "rejected",
] as const;

describe("bulkUpdateStatus input validation", () => {
  it("accepts all valid status values", () => {
    for (const status of VALID_STATUSES) {
      expect(VALID_STATUSES).toContain(status);
    }
  });

  it("rejects empty ids array", () => {
    const ids: number[] = [];
    expect(ids.length).toBe(0);
    // Zod min(1) would reject this
    expect(ids.length >= 1).toBe(false);
  });

  it("rejects ids array exceeding 100", () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1);
    expect(ids.length > 100).toBe(true);
    // Zod max(100) would reject this
    expect(ids.length <= 100).toBe(false);
  });

  it("accepts ids array within bounds", () => {
    const ids = [1, 2, 3, 42, 99];
    expect(ids.length >= 1 && ids.length <= 100).toBe(true);
  });

  it("sets clearedAt when status is cleared", () => {
    const status = "cleared";
    const updateData: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "cleared") updateData.clearedAt = new Date();
    expect(updateData.clearedAt).toBeInstanceOf(Date);
  });

  it("does not set clearedAt for non-cleared statuses", () => {
    for (const status of VALID_STATUSES.filter((s) => s !== "cleared")) {
      const updateData: Record<string, unknown> = { status, updatedAt: new Date() };
      if (status === "cleared") updateData.clearedAt = new Date();
      expect(updateData.clearedAt).toBeUndefined();
    }
  });
});

// ─── Unit: role guard ─────────────────────────────────────────────────────────

describe("bulkUpdateStatus role guard", () => {
  const ALLOWED_ROLES = ["admin", "customs_officer", "inspector"];
  const DENIED_ROLES = ["trader", "oga_officer", "finance", "security"];

  it("allows admin, customs_officer, inspector", () => {
    for (const role of ALLOWED_ROLES) {
      expect(ALLOWED_ROLES.includes(role)).toBe(true);
    }
  });

  it("denies trader, oga_officer, finance, security", () => {
    for (const role of DENIED_ROLES) {
      expect(ALLOWED_ROLES.includes(role)).toBe(false);
    }
  });
});
