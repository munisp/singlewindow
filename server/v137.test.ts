/**
 * v137 Sprint Tests
 * - AEO renewal document checklist helpers
 * - Export schedule delivery receipt helpers
 * - Sanctions batch conflict resolution helpers
 */
import { describe, it, expect } from "vitest";

// ─── AEO Document Checklist Helpers ──────────────────────────────────────────

const REQUIRED_DOCS = [
  { docType: "certificate_of_origin", label: "Certificate of Origin", required: true },
  { docType: "financial_statements", label: "Financial Statements (last 2 years)", required: true },
  { docType: "compliance_records", label: "Compliance & Audit Records", required: true },
  { docType: "customs_history", label: "Customs Transaction History", required: true },
  { docType: "security_assessment", label: "Security Assessment Report", required: false },
  { docType: "trade_references", label: "Trade References (3+)", required: false },
];

interface DocEntry {
  docType: string;
  status: "pending" | "uploaded" | "accepted" | "rejected";
  required: boolean;
}

function computeChecklistSummary(docs: DocEntry[]) {
  const required = docs.filter(d => d.required);
  const requiredUploaded = required.filter(d => d.status === "uploaded" || d.status === "accepted").length;
  const completionPct = required.length > 0 ? Math.round((requiredUploaded / required.length) * 100) : 0;
  const isReadyToSubmit = requiredUploaded === required.length && required.length > 0;
  return { required: required.length, requiredUploaded, completionPct, isReadyToSubmit };
}

describe("AEO Document Checklist", () => {
  it("returns 0% completion when no docs uploaded", () => {
    const docs: DocEntry[] = REQUIRED_DOCS.map(d => ({ ...d, status: "pending" }));
    const s = computeChecklistSummary(docs);
    expect(s.completionPct).toBe(0);
    expect(s.isReadyToSubmit).toBe(false);
    expect(s.required).toBe(4);
    expect(s.requiredUploaded).toBe(0);
  });

  it("returns 50% when 2 of 4 required docs uploaded", () => {
    const docs: DocEntry[] = REQUIRED_DOCS.map((d, i) => ({
      ...d,
      status: (d.required && i < 2) ? "uploaded" : "pending",
    }));
    const s = computeChecklistSummary(docs);
    expect(s.completionPct).toBe(50);
    expect(s.isReadyToSubmit).toBe(false);
  });

  it("returns 100% and isReadyToSubmit when all required docs accepted", () => {
    const docs: DocEntry[] = REQUIRED_DOCS.map(d => ({
      ...d,
      status: d.required ? "accepted" : "pending",
    }));
    const s = computeChecklistSummary(docs);
    expect(s.completionPct).toBe(100);
    expect(s.isReadyToSubmit).toBe(true);
  });

  it("counts uploaded and accepted as both satisfying requirement", () => {
    const docs: DocEntry[] = [
      { docType: "certificate_of_origin", label: "Cert", required: true, status: "uploaded" },
      { docType: "financial_statements", label: "Fin", required: true, status: "accepted" },
      { docType: "compliance_records", label: "Comp", required: true, status: "rejected" },
      { docType: "customs_history", label: "Hist", required: true, status: "pending" },
    ];
    const s = computeChecklistSummary(docs);
    expect(s.requiredUploaded).toBe(2);
    expect(s.completionPct).toBe(50);
  });

  it("does not count optional docs in completion percentage", () => {
    const docs: DocEntry[] = [
      { docType: "certificate_of_origin", label: "Cert", required: true, status: "accepted" },
      { docType: "financial_statements", label: "Fin", required: true, status: "accepted" },
      { docType: "compliance_records", label: "Comp", required: true, status: "accepted" },
      { docType: "customs_history", label: "Hist", required: true, status: "accepted" },
      { docType: "security_assessment", label: "Sec", required: false, status: "pending" },
      { docType: "trade_references", label: "Ref", required: false, status: "pending" },
    ];
    const s = computeChecklistSummary(docs);
    expect(s.completionPct).toBe(100);
    expect(s.isReadyToSubmit).toBe(true);
  });
});

// ─── Export Schedule Delivery Receipt Helpers ─────────────────────────────────

interface DeliveryRecord {
  id: number;
  scheduleId: number;
  deliveredAt: Date | null;
  rowCount: number;
  fileSizeBytes: number;
  status: "success" | "failed";
  errorMessage?: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getLastDeliveryBySchedule(deliveries: DeliveryRecord[]): Record<number, DeliveryRecord> {
  const map: Record<number, DeliveryRecord> = {};
  for (const d of deliveries) {
    if (!map[d.scheduleId] || (d.deliveredAt && map[d.scheduleId].deliveredAt && d.deliveredAt > map[d.scheduleId].deliveredAt!)) {
      map[d.scheduleId] = d;
    }
  }
  return map;
}

function computeDeliverySuccessRate(deliveries: DeliveryRecord[]): number {
  if (deliveries.length === 0) return 0;
  const successes = deliveries.filter(d => d.status === "success").length;
  return Math.round((successes / deliveries.length) * 100);
}

describe("Export Schedule Delivery Receipts", () => {
  it("formats bytes correctly", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(1048576)).toBe("1.00 MB");
    expect(formatBytes(2621440)).toBe("2.50 MB");
  });

  it("returns last delivery per schedule", () => {
    const d1: DeliveryRecord = { id: 1, scheduleId: 1, deliveredAt: new Date("2026-01-01"), rowCount: 100, fileSizeBytes: 5000, status: "success" };
    const d2: DeliveryRecord = { id: 2, scheduleId: 1, deliveredAt: new Date("2026-01-02"), rowCount: 120, fileSizeBytes: 6000, status: "success" };
    const d3: DeliveryRecord = { id: 3, scheduleId: 2, deliveredAt: new Date("2026-01-01"), rowCount: 50, fileSizeBytes: 2000, status: "failed" };
    const map = getLastDeliveryBySchedule([d1, d2, d3]);
    expect(map[1].id).toBe(2);
    expect(map[2].id).toBe(3);
  });

  it("computes delivery success rate correctly", () => {
    const deliveries: DeliveryRecord[] = [
      { id: 1, scheduleId: 1, deliveredAt: new Date(), rowCount: 100, fileSizeBytes: 5000, status: "success" },
      { id: 2, scheduleId: 1, deliveredAt: new Date(), rowCount: 0, fileSizeBytes: 0, status: "failed" },
      { id: 3, scheduleId: 1, deliveredAt: new Date(), rowCount: 80, fileSizeBytes: 4000, status: "success" },
      { id: 4, scheduleId: 1, deliveredAt: new Date(), rowCount: 90, fileSizeBytes: 4500, status: "success" },
    ];
    expect(computeDeliverySuccessRate(deliveries)).toBe(75);
  });

  it("returns 0% success rate for empty list", () => {
    expect(computeDeliverySuccessRate([])).toBe(0);
  });
});

// ─── Sanctions Conflict Resolution Helpers ────────────────────────────────────

interface ConflictRecord {
  id: number;
  entityName: string;
  entityType: string | null;
  incomingData: Record<string, unknown>;
  existingData: Record<string, unknown>;
}

type Resolution = "overwrite" | "skip" | "merge";

function applyMerge(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const result = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function resolveConflict(conflict: ConflictRecord, resolution: Resolution): Record<string, unknown> | null {
  if (resolution === "skip") return conflict.existingData;
  if (resolution === "overwrite") return conflict.incomingData;
  if (resolution === "merge") return applyMerge(conflict.existingData, conflict.incomingData);
  return null;
}

function computeResolutionSummary(resolutions: Record<number, Resolution>) {
  const values = Object.values(resolutions);
  return {
    overwrite: values.filter(v => v === "overwrite").length,
    skip: values.filter(v => v === "skip").length,
    merge: values.filter(v => v === "merge").length,
    total: values.length,
  };
}

describe("Sanctions Conflict Resolution", () => {
  const conflict: ConflictRecord = {
    id: 1,
    entityName: "Acme Corp",
    entityType: "company",
    existingData: { name: "Acme Corp", country: "US", risk: "medium", notes: "existing note" },
    incomingData: { name: "Acme Corporation", country: "US", risk: "high", notes: null },
  };

  it("skip resolution returns existing data unchanged", () => {
    const result = resolveConflict(conflict, "skip");
    expect(result).toEqual(conflict.existingData);
    expect(result!.risk).toBe("medium");
  });

  it("overwrite resolution returns incoming data", () => {
    const result = resolveConflict(conflict, "overwrite");
    expect(result).toEqual(conflict.incomingData);
    expect(result!.risk).toBe("high");
    expect(result!.name).toBe("Acme Corporation");
  });

  it("merge resolution combines non-null incoming fields into existing", () => {
    const result = resolveConflict(conflict, "merge") as Record<string, unknown>;
    expect(result.risk).toBe("high");          // incoming non-null overwrites
    expect(result.name).toBe("Acme Corporation"); // incoming non-null overwrites
    expect(result.notes).toBe("existing note"); // existing preserved (incoming is null)
    expect(result.country).toBe("US");          // same in both
  });

  it("merge preserves all existing keys not in incoming", () => {
    const existing = { a: 1, b: 2, c: 3, d: "keep" };
    const incoming = { a: 10, e: 5 };
    const result = applyMerge(existing, incoming);
    expect(result.a).toBe(10);
    expect(result.b).toBe(2);
    expect(result.c).toBe(3);
    expect(result.d).toBe("keep");
    expect(result.e).toBe(5);
  });

  it("computeResolutionSummary counts correctly", () => {
    const resolutions: Record<number, Resolution> = {
      1: "overwrite",
      2: "skip",
      3: "merge",
      4: "skip",
      5: "overwrite",
    };
    const summary = computeResolutionSummary(resolutions);
    expect(summary.overwrite).toBe(2);
    expect(summary.skip).toBe(2);
    expect(summary.merge).toBe(1);
    expect(summary.total).toBe(5);
  });

  it("bulk skip resolution applies skip to all", () => {
    const conflicts: ConflictRecord[] = [
      { ...conflict, id: 1 },
      { ...conflict, id: 2, entityName: "Beta Ltd" },
      { ...conflict, id: 3, entityName: "Gamma Inc" },
    ];
    const results = conflicts.map(c => resolveConflict(c, "skip"));
    expect(results.every(r => r?.risk === "medium")).toBe(true);
  });

  it("bulk overwrite resolution applies overwrite to all", () => {
    const conflicts: ConflictRecord[] = [
      { ...conflict, id: 1 },
      { ...conflict, id: 2, entityName: "Beta Ltd" },
    ];
    const results = conflicts.map(c => resolveConflict(c, "overwrite"));
    expect(results.every(r => r?.risk === "high")).toBe(true);
  });
});
