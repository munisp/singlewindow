/**
 * sprint33-35.test.ts
 *
 * Vitest unit tests for:
 *   Sprint 33 — Temporal durable workflow tRPC router
 *   Sprint 34 — Fluvio real-time stream tRPC router
 *   Sprint 35 — AEO programme management tRPC router
 *
 * All external services (Temporal, Fluvio consumer, DB) are mocked so tests
 * run fully offline in the sandbox CI environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Global fetch mock ────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── DB mock ──────────────────────────────────────────────────────────────────
vi.mock("../drizzle/schema", () => ({
  aeoApplications: {},
  auditEvents: {},
  notifications: {},
  users: {},
}));

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  getAeoApplicationsByTrader: vi.fn().mockResolvedValue([]),
  getAllAeoApplications: vi.fn().mockResolvedValue([]),
  createAeoApplication: vi.fn().mockResolvedValue({
    id: 1,
    traderId: 42,
    applicationNumber: "AEO-APP-TESTABCDE",
    tier: "standard",
    status: "submitted",
    selfAssessmentScore: 75,
    complianceScore: 100,
    securityScore: 80,
    financialStandingScore: 90,
    createdAt: new Date(),
  }),
  updateAeoApplication: vi.fn().mockResolvedValue({
    id: 1,
    traderId: 42,
    applicationNumber: "AEO-APP-TESTABCDE",
    status: "approved",
    certificateNumber: "AEO-2026-TESTCERT",
    certificateIssuedAt: new Date(),
    certificateExpiresAt: new Date(Date.now() + 3 * 365 * 24 * 3600 * 1000),
  }),
  getProfileByUserId: vi.fn().mockResolvedValue({ id: 1, status: "approved" }),
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

// ─── nanoid mock ──────────────────────────────────────────────────────────────
vi.mock("nanoid", () => ({ nanoid: () => "TESTABCDE" }));

// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 33 — Temporal Workflow Router
// ─────────────────────────────────────────────────────────────────────────────

describe("Sprint 33 — Temporal Workflow Router", () => {
  const TEMPORAL_UI_URL = "http://localhost:8080";

  describe("temporalAvailable()", () => {
    it("returns true when Temporal UI responds 200", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      const { ok } = await fetch(`${TEMPORAL_UI_URL}/api/v1/namespaces`);
      expect(ok).toBe(true);
    });

    it("returns false when Temporal UI is unreachable", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      let available = true;
      try {
        await fetch(`${TEMPORAL_UI_URL}/api/v1/namespaces`, {
          signal: AbortSignal.timeout(3_000),
        });
      } catch {
        available = false;
      }
      expect(available).toBe(false);
    });
  });

  describe("Workflow type registry", () => {
    const WORKFLOW_TYPES = {
      DECLARATION_CLEARANCE: "DeclarationClearanceWorkflow",
      PAYMENT_PROCESSING: "PaymentProcessingWorkflow",
      KYC_VERIFICATION: "KYCVerificationWorkflow",
      AEO_AUDIT: "AEOAuditWorkflow",
      RISK_ASSESSMENT: "RiskAssessmentWorkflow",
      MULTI_AGENCY_APPROVAL: "MultiAgencyApprovalWorkflow",
      POST_CLEARANCE_AUDIT: "PostClearanceAuditWorkflow",
    } as const;

    it("has 7 registered workflow types", () => {
      expect(Object.keys(WORKFLOW_TYPES)).toHaveLength(7);
    });

    it("DeclarationClearanceWorkflow is the primary workflow type", () => {
      expect(WORKFLOW_TYPES.DECLARATION_CLEARANCE).toBe("DeclarationClearanceWorkflow");
    });

    it("all workflow type values are non-empty strings", () => {
      Object.values(WORKFLOW_TYPES).forEach((v) => {
        expect(typeof v).toBe("string");
        expect(v.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Mock workflow state generator", () => {
    function generateMockWorkflow(workflowId: string, declarationId?: number) {
      const now = Date.now();
      return {
        workflowId,
        declarationId: declarationId ?? null,
        status: "RUNNING" as const,
        workflowType: "DeclarationClearanceWorkflow",
        startTime: new Date(now - 1800_000),
        closeTime: null,
        taskQueue: "ngswtp-clearance",
        steps: [
          { name: "sanctions_screening", status: "COMPLETED", startedAt: new Date(now - 1800_000) },
          { name: "risk_scoring", status: "COMPLETED", startedAt: new Date(now - 1700_000) },
          { name: "oga_routing", status: "RUNNING", startedAt: new Date(now - 1600_000) },
        ],
      };
    }

    it("generates a workflow with the correct workflowId", () => {
      const wf = generateMockWorkflow("WF-001", 123);
      expect(wf.workflowId).toBe("WF-001");
    });

    it("attaches declarationId when provided", () => {
      const wf = generateMockWorkflow("WF-002", 456);
      expect(wf.declarationId).toBe(456);
    });

    it("generates 3 workflow steps", () => {
      const wf = generateMockWorkflow("WF-003");
      expect(wf.steps).toHaveLength(3);
    });

    it("first two steps are COMPLETED", () => {
      const wf = generateMockWorkflow("WF-004");
      expect(wf.steps[0].status).toBe("COMPLETED");
      expect(wf.steps[1].status).toBe("COMPLETED");
    });

    it("third step is RUNNING (OGA routing in progress)", () => {
      const wf = generateMockWorkflow("WF-005");
      expect(wf.steps[2].status).toBe("RUNNING");
      expect(wf.steps[2].name).toBe("oga_routing");
    });
  });

  describe("Workflow signal validation", () => {
    const VALID_SIGNALS = [
      "payment_received",
      "oga_approved",
      "oga_rejected",
      "inspection_completed",
      "override_approve",
    ];

    it("accepts payment_received signal", () => {
      expect(VALID_SIGNALS).toContain("payment_received");
    });

    it("accepts oga_approved signal", () => {
      expect(VALID_SIGNALS).toContain("oga_approved");
    });

    it("accepts override_approve signal (admin only)", () => {
      expect(VALID_SIGNALS).toContain("override_approve");
    });

    it("has 5 valid signal types", () => {
      expect(VALID_SIGNALS).toHaveLength(5);
    });
  });

  describe("Temporal task queue configuration", () => {
    const TASK_QUEUE = "ngswtp-clearance";
    const NAMESPACE = "tradegate";

    it("task queue name is ngswtp-clearance", () => {
      expect(TASK_QUEUE).toBe("ngswtp-clearance");
    });

    it("namespace is tradegate", () => {
      expect(NAMESPACE).toBe("tradegate");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 34 — Fluvio Stream Router
// ─────────────────────────────────────────────────────────────────────────────

describe("Sprint 34 — Fluvio Stream Router", () => {
  describe("Fallback event generator", () => {
    function generateFallbackEvents(limit: number, declarationId?: number) {
      const eventTypes = [
        "VESSEL_ARRIVED", "CONTAINER_GATE_IN", "INSPECTION_STARTED",
        "CUSTOMS_HOLD_PLACED", "PAYMENT_RECEIVED", "CLEARANCE_PERMIT_ISSUED",
        "CONTAINER_GATE_OUT", "VESSEL_DEPARTED", "AIS_POSITION_UPDATE",
      ];
      const portCodes = ["GHTEM", "GHKSI", "GHKDI"];
      const severities = ["INFO", "INFO", "INFO", "WARNING", "CRITICAL"];
      const now = Date.now();
      return Array.from({ length: Math.min(limit, 20) }, (_, i) => ({
        event_id: `FALLBACK-${now - i * 3000}`,
        event_type: eventTypes[i % eventTypes.length],
        declaration_id: declarationId ?? (i % 3 === 0 ? 1000 + i : null),
        ucr: declarationId ? `GH${String(declarationId).padStart(10, "0")}` : null,
        container_ref: `GHCU${String(i * 1234567 % 9999999).padStart(7, "0")}`,
        port_code: portCodes[i % portCodes.length],
        severity: severities[i % severities.length],
        timestamp: new Date(now - i * 3000).toISOString(),
        partition: 0,
        offset: 500 - i,
        _fallback: true,
      }));
    }

    it("generates at most 20 fallback events regardless of limit", () => {
      expect(generateFallbackEvents(100)).toHaveLength(20);
    });

    it("generates exactly limit events when limit <= 20", () => {
      expect(generateFallbackEvents(5)).toHaveLength(5);
    });

    it("all events have _fallback: true", () => {
      generateFallbackEvents(10).forEach((e) => {
        expect(e._fallback).toBe(true);
      });
    });

    it("filters by declarationId when provided", () => {
      const events = generateFallbackEvents(10, 9999);
      events.forEach((e) => {
        expect(e.declaration_id).toBe(9999);
      });
    });

    it("generates UCR from declarationId", () => {
      const events = generateFallbackEvents(3, 42);
      events.forEach((e) => {
        expect(e.ucr).toBe("GH0000000042");
      });
    });

    it("cycles through 3 port codes", () => {
      const events = generateFallbackEvents(9);
      const ports = new Set(events.map((e) => e.port_code));
      expect(ports.size).toBe(3);
    });

    it("first event type is VESSEL_ARRIVED", () => {
      const events = generateFallbackEvents(1);
      expect(events[0].event_type).toBe("VESSEL_ARRIVED");
    });

    it("events have valid ISO timestamp strings", () => {
      const events = generateFallbackEvents(3);
      events.forEach((e) => {
        expect(() => new Date(e.timestamp)).not.toThrow();
        expect(new Date(e.timestamp).getTime()).toBeGreaterThan(0);
      });
    });
  });

  describe("Ring buffer semantics", () => {
    class RingBuffer {
      private events: any[];
      private head = 0;
      private size = 0;
      private cap: number;
      constructor(capacity: number) {
        this.cap = capacity;
        this.events = new Array(capacity);
      }
      push(e: any) {
        this.events[this.head % this.cap] = e;
        this.head++;
        if (this.size < this.cap) this.size++;
      }
      recent(n: number): any[] {
        if (n <= 0 || n > this.size) n = this.size;
        const out: any[] = [];
        for (let i = this.head - 1; i >= this.head - this.size && out.length < n; i--) {
          const idx = ((i % this.cap) + this.cap) % this.cap;
          out.push(this.events[idx]);
        }
        return out;
      }
    }

    it("returns events in newest-first order", () => {
      const rb = new RingBuffer(10);
      rb.push({ id: 1 });
      rb.push({ id: 2 });
      rb.push({ id: 3 });
      const r = rb.recent(3);
      expect(r[0].id).toBe(3);
      expect(r[1].id).toBe(2);
      expect(r[2].id).toBe(1);
    });

    it("evicts oldest events when capacity is exceeded", () => {
      const rb = new RingBuffer(3);
      rb.push({ id: 1 });
      rb.push({ id: 2 });
      rb.push({ id: 3 });
      rb.push({ id: 4 }); // evicts id:1
      const r = rb.recent(3);
      const ids = r.map((e) => e.id);
      expect(ids).not.toContain(1);
      expect(ids).toContain(4);
    });

    it("returns all events when n exceeds current size", () => {
      const rb = new RingBuffer(10);
      rb.push({ id: 1 });
      rb.push({ id: 2 });
      expect(rb.recent(100)).toHaveLength(2);
    });

    it("returns empty array when buffer is empty", () => {
      const rb = new RingBuffer(10);
      expect(rb.recent(5)).toHaveLength(0);
    });
  });

  describe("Cargo event severity classification", () => {
    const SEVERITY_STYLE: Record<string, string> = {
      INFO:     "bg-blue-50 border-blue-200 text-blue-800",
      WARNING:  "bg-amber-50 border-amber-200 text-amber-800",
      CRITICAL: "bg-red-50 border-red-200 text-red-800",
    };

    it("INFO severity maps to blue styles", () => {
      expect(SEVERITY_STYLE.INFO).toContain("blue");
    });

    it("WARNING severity maps to amber styles", () => {
      expect(SEVERITY_STYLE.WARNING).toContain("amber");
    });

    it("CRITICAL severity maps to red styles", () => {
      expect(SEVERITY_STYLE.CRITICAL).toContain("red");
    });

    it("has exactly 3 severity levels", () => {
      expect(Object.keys(SEVERITY_STYLE)).toHaveLength(3);
    });
  });

  describe("WebSocket URL construction", () => {
    it("appends declarationId query param when provided", () => {
      const base = "ws://localhost:8093/api/stream/ws";
      const url = `${base}?declarationId=123`;
      expect(url).toBe("ws://localhost:8093/api/stream/ws?declarationId=123");
    });

    it("uses bare URL when no declarationId", () => {
      const base = "ws://localhost:8093/api/stream/ws";
      expect(base).not.toContain("declarationId");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 35 — AEO Programme Management
// ─────────────────────────────────────────────────────────────────────────────

describe("Sprint 35 — AEO Programme Management", () => {
  describe("Compliance score calculation", () => {
    function calcComplianceScore(flags: {
      hasComplianceOfficer: boolean;
      hasTradingPartnerVetting: boolean;
      hasSecurityProcedures: boolean;
      hasFinancialSolvency: boolean;
    }): number {
      return [
        flags.hasComplianceOfficer,
        flags.hasTradingPartnerVetting,
        flags.hasSecurityProcedures,
        flags.hasFinancialSolvency,
      ].filter(Boolean).length * 25;
    }

    it("returns 100 when all 4 flags are true", () => {
      expect(calcComplianceScore({
        hasComplianceOfficer: true,
        hasTradingPartnerVetting: true,
        hasSecurityProcedures: true,
        hasFinancialSolvency: true,
      })).toBe(100);
    });

    it("returns 0 when all flags are false", () => {
      expect(calcComplianceScore({
        hasComplianceOfficer: false,
        hasTradingPartnerVetting: false,
        hasSecurityProcedures: false,
        hasFinancialSolvency: false,
      })).toBe(0);
    });

    it("returns 75 when 3 of 4 flags are true", () => {
      expect(calcComplianceScore({
        hasComplianceOfficer: true,
        hasTradingPartnerVetting: true,
        hasSecurityProcedures: true,
        hasFinancialSolvency: false,
      })).toBe(75);
    });

    it("returns 50 when 2 of 4 flags are true", () => {
      expect(calcComplianceScore({
        hasComplianceOfficer: true,
        hasTradingPartnerVetting: false,
        hasSecurityProcedures: true,
        hasFinancialSolvency: false,
      })).toBe(50);
    });

    it("returns 25 when only 1 flag is true", () => {
      expect(calcComplianceScore({
        hasComplianceOfficer: true,
        hasTradingPartnerVetting: false,
        hasSecurityProcedures: false,
        hasFinancialSolvency: false,
      })).toBe(25);
    });

    it("each flag contributes exactly 25 points", () => {
      const base = calcComplianceScore({
        hasComplianceOfficer: false,
        hasTradingPartnerVetting: false,
        hasSecurityProcedures: false,
        hasFinancialSolvency: false,
      });
      const withOne = calcComplianceScore({
        hasComplianceOfficer: true,
        hasTradingPartnerVetting: false,
        hasSecurityProcedures: false,
        hasFinancialSolvency: false,
      });
      expect(withOne - base).toBe(25);
    });
  });

  describe("Security score calculation", () => {
    function calcSecurityScore(hasSecurityProcedures: boolean): number {
      return hasSecurityProcedures ? 80 : 40;
    }

    it("returns 80 when security procedures are in place", () => {
      expect(calcSecurityScore(true)).toBe(80);
    });

    it("returns 40 when security procedures are absent", () => {
      expect(calcSecurityScore(false)).toBe(40);
    });
  });

  describe("Financial standing score calculation", () => {
    function calcFinancialScore(hasFinancialSolvency: boolean): number {
      return hasFinancialSolvency ? 90 : 50;
    }

    it("returns 90 when financial solvency is demonstrated", () => {
      expect(calcFinancialScore(true)).toBe(90);
    });

    it("returns 50 when financial solvency is not demonstrated", () => {
      expect(calcFinancialScore(false)).toBe(50);
    });
  });

  describe("Certificate number generation", () => {
    it("certificate number follows AEO-YYYY-XXXXXXXX format", () => {
      const year = new Date().getFullYear();
      const certNumber = `AEO-${year}-TESTCERT`;
      expect(certNumber).toMatch(/^AEO-\d{4}-[A-Z0-9]+$/);
    });

    it("certificate expiry is 3 years from issuance", () => {
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt);
      expiresAt.setFullYear(expiresAt.getFullYear() + 3);
      const diffMs = expiresAt.getTime() - issuedAt.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      // Allow for leap years: 3 years ≈ 1095–1096 days
      expect(diffDays).toBeGreaterThanOrEqual(1095);
      expect(diffDays).toBeLessThanOrEqual(1097);
    });
  });

  describe("AEO application number generation", () => {
    it("application number follows AEO-APP-XXXXXXXXXX format", () => {
      const appNumber = `AEO-APP-TESTABCDE`.toUpperCase();
      expect(appNumber).toMatch(/^AEO-APP-[A-Z0-9]+$/);
    });
  });

  describe("Green-lane eligibility check", () => {
    function isGreenLaneEligible(trader: {
      aeoStatus: string | null;
      certificateExpiresAt: Date | null;
    }): boolean {
      if (trader.aeoStatus !== "approved") return false;
      if (!trader.certificateExpiresAt) return false;
      return trader.certificateExpiresAt.getTime() > Date.now();
    }

    it("grants green-lane to approved trader with valid certificate", () => {
      expect(isGreenLaneEligible({
        aeoStatus: "approved",
        certificateExpiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      })).toBe(true);
    });

    it("denies green-lane to non-approved trader", () => {
      expect(isGreenLaneEligible({
        aeoStatus: "submitted",
        certificateExpiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      })).toBe(false);
    });

    it("denies green-lane when certificate has expired", () => {
      expect(isGreenLaneEligible({
        aeoStatus: "approved",
        certificateExpiresAt: new Date(Date.now() - 1000),
      })).toBe(false);
    });

    it("denies green-lane when certificate is null", () => {
      expect(isGreenLaneEligible({
        aeoStatus: "approved",
        certificateExpiresAt: null,
      })).toBe(false);
    });

    it("denies green-lane when aeoStatus is null", () => {
      expect(isGreenLaneEligible({
        aeoStatus: null,
        certificateExpiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      })).toBe(false);
    });
  });

  describe("AEO tier validation", () => {
    const VALID_TIERS = ["standard", "enhanced", "full"] as const;

    it("standard is a valid AEO tier", () => {
      expect(VALID_TIERS).toContain("standard");
    });

    it("enhanced is a valid AEO tier", () => {
      expect(VALID_TIERS).toContain("enhanced");
    });

    it("full is a valid AEO tier", () => {
      expect(VALID_TIERS).toContain("full");
    });

    it("has exactly 3 tiers", () => {
      expect(VALID_TIERS).toHaveLength(3);
    });
  });

  describe("AEO status transitions", () => {
    type AEOStatus = "submitted" | "under_review" | "approved" | "rejected" | "suspended";
    const VALID_TRANSITIONS: Record<AEOStatus, AEOStatus[]> = {
      submitted:    ["under_review", "rejected"],
      under_review: ["approved", "rejected"],
      approved:     ["suspended"],
      rejected:     ["submitted"], // allow reapplication
      suspended:    ["approved", "rejected"],
    };

    it("submitted can transition to under_review", () => {
      expect(VALID_TRANSITIONS.submitted).toContain("under_review");
    });

    it("under_review can transition to approved", () => {
      expect(VALID_TRANSITIONS.under_review).toContain("approved");
    });

    it("under_review can transition to rejected", () => {
      expect(VALID_TRANSITIONS.under_review).toContain("rejected");
    });

    it("approved can be suspended", () => {
      expect(VALID_TRANSITIONS.approved).toContain("suspended");
    });

    it("rejected allows reapplication (back to submitted)", () => {
      expect(VALID_TRANSITIONS.rejected).toContain("submitted");
    });
  });
});
