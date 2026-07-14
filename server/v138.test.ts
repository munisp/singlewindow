/**
 * v138 Sprint Tests
 * Covers: document preview, delivery receipts, conflict resolution,
 * AEO comments, sanctions entities, schedule analytics, batch validation,
 * checklist templates, watchlist alerts, entity risk scoring
 */
import { describe, it, expect } from "vitest";

// ─── 1. Document Preview URL Helpers ─────────────────────────────────────────
describe("documentPreviewUrl", () => {
  function isPreviewable(mimeType: string): boolean {
    return ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(mimeType);
  }

  function buildPreviewUrl(fileUrl: string, mimeType: string): string | null {
    if (!isPreviewable(mimeType)) return null;
    return fileUrl;
  }

  it("returns URL for PDF", () => {
    expect(buildPreviewUrl("https://cdn.example.com/doc.pdf", "application/pdf")).toBe("https://cdn.example.com/doc.pdf");
  });

  it("returns URL for PNG", () => {
    expect(buildPreviewUrl("https://cdn.example.com/img.png", "image/png")).not.toBeNull();
  });

  it("returns null for non-previewable type", () => {
    expect(buildPreviewUrl("https://cdn.example.com/data.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBeNull();
  });

  it("returns null for zip", () => {
    expect(buildPreviewUrl("https://cdn.example.com/archive.zip", "application/zip")).toBeNull();
  });
});

// ─── 2. Delivery Receipt Formatting ──────────────────────────────────────────
describe("deliveryReceiptFormat", () => {
  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatDeliveryStatus(status: string): { label: string; variant: "default" | "secondary" | "destructive" } {
    switch (status) {
      case "success": return { label: "Delivered", variant: "secondary" };
      case "failed": return { label: "Failed", variant: "destructive" };
      case "pending": return { label: "Pending", variant: "default" };
      default: return { label: status, variant: "default" };
    }
  }

  it("formats bytes correctly", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(2097152)).toBe("2.00 MB");
  });

  it("formats success status", () => {
    const result = formatDeliveryStatus("success");
    expect(result.label).toBe("Delivered");
    expect(result.variant).toBe("secondary");
  });

  it("formats failed status", () => {
    const result = formatDeliveryStatus("failed");
    expect(result.variant).toBe("destructive");
  });

  it("formats pending status", () => {
    const result = formatDeliveryStatus("pending");
    expect(result.variant).toBe("default");
  });
});

// ─── 3. Conflict Resolution Logic ────────────────────────────────────────────
describe("conflictResolution", () => {
  type Resolution = "overwrite" | "skip" | "merge";

  function applyResolution(
    existing: Record<string, unknown>,
    incoming: Record<string, unknown>,
    resolution: Resolution
  ): Record<string, unknown> {
    switch (resolution) {
      case "overwrite": return { ...incoming };
      case "skip": return { ...existing };
      case "merge": return { ...existing, ...incoming };
    }
  }

  const existing = { name: "ACME Corp", country: "US", riskLevel: "low" };
  const incoming = { name: "ACME Corporation", country: "US", riskLevel: "high", sanctionType: "OFAC" };

  it("overwrite replaces all fields with incoming", () => {
    const result = applyResolution(existing, incoming, "overwrite");
    expect(result.name).toBe("ACME Corporation");
    expect(result.riskLevel).toBe("high");
    expect(result.sanctionType).toBe("OFAC");
  });

  it("skip keeps all existing fields", () => {
    const result = applyResolution(existing, incoming, "skip");
    expect(result.name).toBe("ACME Corp");
    expect(result.riskLevel).toBe("low");
    expect(result.sanctionType).toBeUndefined();
  });

  it("merge combines both with incoming taking precedence", () => {
    const result = applyResolution(existing, incoming, "merge");
    expect(result.name).toBe("ACME Corporation");
    expect(result.country).toBe("US");
    expect(result.sanctionType).toBe("OFAC");
  });

  it("merge preserves existing-only fields", () => {
    const result = applyResolution({ a: 1, b: 2 }, { b: 99, c: 3 }, "merge");
    expect(result.a).toBe(1);
    expect(result.b).toBe(99);
    expect(result.c).toBe(3);
  });
});

// ─── 4. AEO Comments Thread ───────────────────────────────────────────────────
describe("aeoCommentsThread", () => {
  type Comment = { id: number; authorId: number; body: string; createdAt: Date; parentId: number | null };

  function buildCommentTree(comments: Comment[]): Array<Comment & { replies: Comment[] }> {
    const roots = comments.filter(c => c.parentId === null);
    return roots.map(root => ({
      ...root,
      replies: comments.filter(c => c.parentId === root.id),
    }));
  }

  const now = new Date();
  const comments: Comment[] = [
    { id: 1, authorId: 10, body: "Please submit your financial statements", createdAt: now, parentId: null },
    { id: 2, authorId: 20, body: "Uploaded — see attachment", createdAt: now, parentId: 1 },
    { id: 3, authorId: 10, body: "Received, reviewing now", createdAt: now, parentId: 1 },
    { id: 4, authorId: 20, body: "Any update on the review?", createdAt: now, parentId: null },
  ];

  it("builds tree with correct root count", () => {
    const tree = buildCommentTree(comments);
    expect(tree).toHaveLength(2);
  });

  it("attaches replies to correct parent", () => {
    const tree = buildCommentTree(comments);
    const firstRoot = tree.find(c => c.id === 1)!;
    expect(firstRoot.replies).toHaveLength(2);
  });

  it("leaf comment has no replies", () => {
    const tree = buildCommentTree(comments);
    const secondRoot = tree.find(c => c.id === 4)!;
    expect(secondRoot.replies).toHaveLength(0);
  });
});

// ─── 5. Sanctions Entity Risk Scoring ────────────────────────────────────────
describe("entityRiskScoring", () => {
  type RiskFactor = { weight: number; score: number };

  function computeEntityRiskScore(factors: RiskFactor[]): number {
    if (factors.length === 0) return 0;
    const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
    if (totalWeight === 0) return 0;
    const weightedSum = factors.reduce((sum, f) => sum + f.weight * f.score, 0);
    return Math.round((weightedSum / totalWeight) * 100) / 100;
  }

  function classifyRisk(score: number): "low" | "medium" | "high" | "critical" {
    if (score < 25) return "low";
    if (score < 50) return "medium";
    if (score < 75) return "high";
    return "critical";
  }

  it("computes weighted average correctly", () => {
    const factors: RiskFactor[] = [
      { weight: 2, score: 80 },
      { weight: 1, score: 20 },
    ];
    expect(computeEntityRiskScore(factors)).toBeCloseTo(60, 1);
  });

  it("returns 0 for empty factors", () => {
    expect(computeEntityRiskScore([])).toBe(0);
  });

  it("classifies low risk correctly", () => {
    expect(classifyRisk(10)).toBe("low");
    expect(classifyRisk(24)).toBe("low");
  });

  it("classifies critical risk correctly", () => {
    expect(classifyRisk(75)).toBe("critical");
    expect(classifyRisk(99)).toBe("critical");
  });

  it("classifies medium and high risk", () => {
    expect(classifyRisk(30)).toBe("medium");
    expect(classifyRisk(60)).toBe("high");
  });
});

// ─── 6. Schedule Analytics Helpers ───────────────────────────────────────────
describe("scheduleAnalytics", () => {
  type Delivery = { deliveredAt: Date; rowCount: number; status: "success" | "failed" };

  function computeDeliveryStats(deliveries: Delivery[]): {
    totalDeliveries: number;
    successRate: number;
    avgRowCount: number;
    totalRows: number;
  } {
    const total = deliveries.length;
    if (total === 0) return { totalDeliveries: 0, successRate: 0, avgRowCount: 0, totalRows: 0 };
    const successes = deliveries.filter(d => d.status === "success").length;
    const totalRows = deliveries.reduce((sum, d) => sum + d.rowCount, 0);
    return {
      totalDeliveries: total,
      successRate: Math.round((successes / total) * 100),
      avgRowCount: Math.round(totalRows / total),
      totalRows,
    };
  }

  const deliveries: Delivery[] = [
    { deliveredAt: new Date(), rowCount: 150, status: "success" },
    { deliveredAt: new Date(), rowCount: 200, status: "success" },
    { deliveredAt: new Date(), rowCount: 0, status: "failed" },
    { deliveredAt: new Date(), rowCount: 175, status: "success" },
  ];

  it("computes correct success rate", () => {
    const stats = computeDeliveryStats(deliveries);
    expect(stats.successRate).toBe(75);
  });

  it("computes correct total rows", () => {
    const stats = computeDeliveryStats(deliveries);
    expect(stats.totalRows).toBe(525);
  });

  it("computes correct average row count", () => {
    const stats = computeDeliveryStats(deliveries);
    expect(stats.avgRowCount).toBe(131);
  });

  it("handles empty deliveries", () => {
    const stats = computeDeliveryStats([]);
    expect(stats.successRate).toBe(0);
    expect(stats.totalDeliveries).toBe(0);
  });
});

// ─── 7. Checklist Template Validation ────────────────────────────────────────
describe("checklistTemplateValidation", () => {
  type ChecklistItem = { label: string; required: boolean; docType: string };

  function validateTemplate(items: ChecklistItem[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (items.length === 0) errors.push("Template must have at least one item");
    const labels = items.map(i => i.label.trim().toLowerCase());
    const uniqueLabels = new Set(labels);
    if (uniqueLabels.size !== labels.length) errors.push("Duplicate item labels are not allowed");
    items.forEach((item, idx) => {
      if (!item.label.trim()) errors.push(`Item ${idx + 1}: label is required`);
      if (!item.docType.trim()) errors.push(`Item ${idx + 1}: docType is required`);
    });
    return { valid: errors.length === 0, errors };
  }

  it("validates a correct template", () => {
    const result = validateTemplate([
      { label: "Certificate of Origin", required: true, docType: "certificate" },
      { label: "Financial Statements", required: true, docType: "financial" },
    ]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects empty template", () => {
    const result = validateTemplate([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("at least one item");
  });

  it("rejects duplicate labels", () => {
    const result = validateTemplate([
      { label: "Certificate", required: true, docType: "cert" },
      { label: "certificate", required: false, docType: "cert2" },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Duplicate"))).toBe(true);
  });

  it("rejects items with empty label", () => {
    const result = validateTemplate([
      { label: "", required: true, docType: "cert" },
    ]);
    expect(result.valid).toBe(false);
  });
});

// ─── 8. Watchlist Alert Matching ─────────────────────────────────────────────
describe("watchlistAlertMatching", () => {
  type WatchlistEntry = { entityName: string; country: string; entityType: string };
  type Declaration = { importerName: string; originCountry: string };

  function checkDeclarationAgainstWatchlist(
    declaration: Declaration,
    watchlist: WatchlistEntry[],
    threshold = 0.8
  ): WatchlistEntry[] {
    // Simplified similarity: exact or starts-with match
    return watchlist.filter(entry => {
      const normalizedEntry = entry.entityName.toLowerCase();
      const normalizedImporter = declaration.importerName.toLowerCase();
      const nameMatch = normalizedImporter.includes(normalizedEntry) || normalizedEntry.includes(normalizedImporter);
      const countryMatch = entry.country === declaration.originCountry;
      return nameMatch && countryMatch;
    });
  }

  const watchlist: WatchlistEntry[] = [
    { entityName: "ACME Corp", country: "IR", entityType: "company" },
    { entityName: "Suspicious Ltd", country: "KP", entityType: "company" },
    { entityName: "Clean Trade Co", country: "US", entityType: "company" },
  ];

  it("matches exact entity name and country", () => {
    const matches = checkDeclarationAgainstWatchlist(
      { importerName: "ACME Corp", originCountry: "IR" },
      watchlist
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].entityName).toBe("ACME Corp");
  });

  it("returns no matches for clean declaration", () => {
    const matches = checkDeclarationAgainstWatchlist(
      { importerName: "Legitimate Imports GmbH", originCountry: "DE" },
      watchlist
    );
    expect(matches).toHaveLength(0);
  });

  it("does not match wrong country", () => {
    const matches = checkDeclarationAgainstWatchlist(
      { importerName: "ACME Corp", originCountry: "US" },
      watchlist
    );
    expect(matches).toHaveLength(0);
  });

  it("matches partial name", () => {
    const matches = checkDeclarationAgainstWatchlist(
      { importerName: "ACME Corp International", originCountry: "IR" },
      watchlist
    );
    expect(matches).toHaveLength(1);
  });
});
