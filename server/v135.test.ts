/**
 * v135 Sprint Tests
 * Covers: threshold editor helpers, CSV email notification builder,
 * declaration status-change notification routing, and WS notification category detection.
 */
import { describe, it, expect } from "vitest";

// ─── 1. Threshold editor helpers ─────────────────────────────────────────────

function deriveErrorRateThreshold(degradedMs: number): number {
  return Math.min(50, Math.max(5, Math.round(degradedMs / 10)));
}

describe("deriveErrorRateThreshold", () => {
  it("clamps minimum to 5%", () => {
    expect(deriveErrorRateThreshold(10)).toBe(5);
    expect(deriveErrorRateThreshold(0)).toBe(5);
  });

  it("clamps maximum to 50%", () => {
    expect(deriveErrorRateThreshold(10000)).toBe(50);
    expect(deriveErrorRateThreshold(600)).toBe(50);
  });

  it("computes correct midrange values", () => {
    expect(deriveErrorRateThreshold(100)).toBe(10);
    expect(deriveErrorRateThreshold(250)).toBe(25);
    expect(deriveErrorRateThreshold(300)).toBe(30);
  });

  it("rounds to nearest integer", () => {
    expect(deriveErrorRateThreshold(155)).toBe(16); // 15.5 → 16
    expect(deriveErrorRateThreshold(144)).toBe(14); // 14.4 → 14
  });
});

// ─── 2. CSV email notification builder ───────────────────────────────────────

function buildExportNotificationTitle(rowCount: number, dateRange: string): string {
  return `Finance CSV Export Ready — ${rowCount} records (${dateRange})`;
}

function buildExportNotificationBody(
  rowCount: number,
  dateRange: string,
  previewLines: string[]
): string {
  const preview = previewLines.slice(0, 10).join("\n");
  return (
    `Your duty-revenue CSV export for ${dateRange} is ready.\n\n` +
    `First ${Math.min(10, rowCount)} records:\n${preview}\n\n` +
    `Download the full CSV from the Finance Ledger page.`
  );
}

describe("buildExportNotificationTitle", () => {
  it("formats title with row count and date range", () => {
    expect(buildExportNotificationTitle(42, "2026-01-01 to 2026-01-31")).toBe(
      "Finance CSV Export Ready — 42 records (2026-01-01 to 2026-01-31)"
    );
  });

  it("handles zero rows", () => {
    expect(buildExportNotificationTitle(0, "all time")).toBe(
      "Finance CSV Export Ready — 0 records (all time)"
    );
  });
});

describe("buildExportNotificationBody", () => {
  it("includes preview lines in body", () => {
    const lines = ["REF001 | Decl #1 | 500 USD", "REF002 | Decl #2 | 300 USD"];
    const body = buildExportNotificationBody(2, "last 30 days", lines);
    expect(body).toContain("REF001");
    expect(body).toContain("REF002");
    expect(body).toContain("last 30 days");
  });

  it("caps preview at 10 lines", () => {
    const lines = Array.from({ length: 15 }, (_, i) => `REF${i + 1} | Decl #${i + 1} | 100 USD`);
    const body = buildExportNotificationBody(15, "all time", lines);
    // Only first 10 should appear
    expect(body).toContain("REF10");
    expect(body).not.toContain("REF11");
  });

  it("includes download instruction", () => {
    const body = buildExportNotificationBody(5, "all time", []);
    expect(body).toContain("Finance Ledger page");
  });
});

// ─── 3. Declaration status-change notification routing ───────────────────────

type DeclarationStatus =
  | "cleared"
  | "rejected"
  | "docs_required"
  | "payment_pending"
  | "under_examination"
  | "examination_complete";

const STATUS_MESSAGES: Record<DeclarationStatus, string> = {
  cleared: "Your declaration DECL-001 has been cleared. Goods may be released.",
  rejected: "Your declaration DECL-001 has been rejected. Please review and resubmit.",
  docs_required: "Additional documents required for DECL-001. Please upload the requested documents.",
  payment_pending: "Payment required for DECL-001. Please complete payment to proceed.",
  under_examination: "DECL-001 has been selected for physical examination.",
  examination_complete: "Physical examination of DECL-001 is complete. Awaiting final clearance.",
};

function getNotifType(status: DeclarationStatus): string {
  if (status === "cleared") return "declaration_cleared";
  if (status === "rejected") return "declaration_rejected";
  if (status === "docs_required") return "document_required";
  return "declaration_status_change";
}

describe("getNotifType", () => {
  it("returns declaration_cleared for cleared status", () => {
    expect(getNotifType("cleared")).toBe("declaration_cleared");
  });

  it("returns declaration_rejected for rejected status", () => {
    expect(getNotifType("rejected")).toBe("declaration_rejected");
  });

  it("returns docs_required for docs_required status", () => {
    expect(getNotifType("docs_required")).toBe("document_required");
  });

  it("returns status_update for other statuses", () => {
    expect(getNotifType("payment_pending")).toBe("declaration_status_change");
    expect(getNotifType("under_examination")).toBe("declaration_status_change");
    expect(getNotifType("examination_complete")).toBe("declaration_status_change");
  });
});

describe("STATUS_MESSAGES", () => {
  it("contains message for all declaration statuses", () => {
    const statuses: DeclarationStatus[] = [
      "cleared", "rejected", "docs_required",
      "payment_pending", "under_examination", "examination_complete",
    ];
    for (const s of statuses) {
      expect(STATUS_MESSAGES[s]).toBeTruthy();
    }
  });

  it("cleared message mentions goods release", () => {
    expect(STATUS_MESSAGES.cleared).toContain("Goods may be released");
  });

  it("rejected message mentions resubmit", () => {
    expect(STATUS_MESSAGES.rejected).toContain("resubmit");
  });
});

// ─── 4. WS notification category detection (frontend logic) ──────────────────

function isDeclarationNotif(notif: { category?: string; entityType?: string }): boolean {
  return notif.category === "declaration" || notif.entityType === "declaration";
}

function isDeclarationStatusChange(notif: { title?: string; category?: string; entityType?: string }): boolean {
  if (!isDeclarationNotif(notif)) return false;
  const t = (notif.title ?? "").toLowerCase();
  return (
    t.includes("cleared") ||
    t.includes("rejected") ||
    t.includes("examination") ||
    t.includes("payment") ||
    t.includes("docs")
  );
}

describe("isDeclarationNotif", () => {
  it("returns true when category is declaration", () => {
    expect(isDeclarationNotif({ category: "declaration" })).toBe(true);
  });

  it("returns true when entityType is declaration", () => {
    expect(isDeclarationNotif({ entityType: "declaration" })).toBe(true);
  });

  it("returns false for unrelated notifications", () => {
    expect(isDeclarationNotif({ category: "payment" })).toBe(false);
    expect(isDeclarationNotif({})).toBe(false);
  });
});

describe("isDeclarationStatusChange", () => {
  it("returns true for cleared notification", () => {
    expect(isDeclarationStatusChange({ category: "declaration", title: "Declaration Cleared" })).toBe(true);
  });

  it("returns true for rejected notification", () => {
    expect(isDeclarationStatusChange({ category: "declaration", title: "Declaration Rejected" })).toBe(true);
  });

  it("returns true for docs required notification", () => {
    expect(isDeclarationStatusChange({ category: "declaration", title: "Docs Required" })).toBe(true);
  });

  it("returns false for non-declaration notification", () => {
    expect(isDeclarationStatusChange({ category: "payment", title: "Payment Confirmed" })).toBe(false);
  });

  it("returns false for declaration notification without status keyword", () => {
    expect(isDeclarationStatusChange({ category: "declaration", title: "New Declaration Submitted" })).toBe(false);
  });
});
