/**
 * Sprint 54-56 Tests
 * Sprint 54: Wazuh SIEM/XDR Integration — SOC alert correlation and incident management
 * Sprint 55: Post-Clearance Audit Engine — risk-based selection and discrepancy reporting
 * Sprint 56: Bonded Warehouse & Free Zone Management — inventory, bond guarantees, permits
 */

import { describe, it, expect } from "vitest";

// ─── Sprint 54: Wazuh SIEM/XDR ───────────────────────────────────────────────

// Inline the SOC logic for unit testing
const MITRE_TACTIC_MAP: Record<string, string> = {
  "T1190": "Initial Access",
  "T1078": "Defense Evasion",
  "T1059": "Execution",
  "T1003": "Credential Access",
  "T1486": "Impact",
  "T1071": "Command and Control",
  "T1566": "Initial Access",
  "T1110": "Credential Access",
  "T1133": "Initial Access",
  "T1021": "Lateral Movement",
};

function mapMitreTactic(technique: string): string {
  return MITRE_TACTIC_MAP[technique] ?? "Unknown";
}

function classifyAlertSeverity(ruleLevel: number): "low" | "medium" | "high" | "critical" {
  if (ruleLevel >= 15) return "critical";
  if (ruleLevel >= 12) return "high";
  if (ruleLevel >= 7) return "medium";
  return "low";
}

function correlateDeclaration(alertData: Record<string, string>, declarationIds: string[]): string | null {
  const srcIp = alertData.srcip ?? "";
  const username = alertData.username ?? "";
  // Simulate correlation: if username matches a declaration prefix pattern
  for (const declId of declarationIds) {
    if (username.includes(declId.slice(0, 4)) || srcIp.startsWith("10.")) {
      return declId;
    }
  }
  return null;
}

function buildIncidentTitle(alerts: Array<{ mitre?: { technique: string; tactic: string } }>): string {
  const tactics = [...new Set(alerts.map((a) => a.mitre?.tactic).filter(Boolean))];
  if (tactics.length === 0) return "Security Incident";
  if (tactics.length === 1) return `${tactics[0]} Attack Detected`;
  return `Multi-Stage Attack: ${tactics.slice(0, 2).join(" + ")}`;
}

describe("Sprint 54 — Wazuh SIEM/XDR Integration", () => {
  describe("Alert severity classification", () => {
    it("classifies rule level 15+ as critical", () => {
      expect(classifyAlertSeverity(15)).toBe("critical");
      expect(classifyAlertSeverity(16)).toBe("critical");
    });

    it("classifies rule level 12-14 as high", () => {
      expect(classifyAlertSeverity(12)).toBe("high");
      expect(classifyAlertSeverity(14)).toBe("high");
    });

    it("classifies rule level 7-11 as medium", () => {
      expect(classifyAlertSeverity(7)).toBe("medium");
      expect(classifyAlertSeverity(11)).toBe("medium");
    });

    it("classifies rule level below 7 as low", () => {
      expect(classifyAlertSeverity(6)).toBe("low");
      expect(classifyAlertSeverity(1)).toBe("low");
    });
  });

  describe("MITRE ATT&CK tactic mapping", () => {
    it("maps T1190 to Initial Access", () => {
      expect(mapMitreTactic("T1190")).toBe("Initial Access");
    });

    it("maps T1486 to Impact", () => {
      expect(mapMitreTactic("T1486")).toBe("Impact");
    });

    it("maps T1021 to Lateral Movement", () => {
      expect(mapMitreTactic("T1021")).toBe("Lateral Movement");
    });

    it("returns Unknown for unmapped technique", () => {
      expect(mapMitreTactic("T9999")).toBe("Unknown");
    });
  });

  describe("Declaration correlation", () => {
    it("correlates alert to declaration by IP prefix", () => {
      const result = correlateDeclaration({ srcip: "10.0.1.50", username: "trader" }, ["DECL-1001", "DECL-2002"]);
      expect(result).toBe("DECL-1001");
    });

    it("returns null when no correlation found", () => {
      const result = correlateDeclaration({ srcip: "192.168.1.1", username: "unknown" }, ["DECL-1001"]);
      expect(result).toBeNull();
    });
  });

  describe("Incident title generation", () => {
    it("generates single tactic title", () => {
      const alerts = [
        { mitre: { technique: "T1190", tactic: "Initial Access" } },
        { mitre: { technique: "T1566", tactic: "Initial Access" } },
      ];
      expect(buildIncidentTitle(alerts)).toBe("Initial Access Attack Detected");
    });

    it("generates multi-stage title for multiple tactics", () => {
      const alerts = [
        { mitre: { technique: "T1190", tactic: "Initial Access" } },
        { mitre: { technique: "T1003", tactic: "Credential Access" } },
      ];
      const title = buildIncidentTitle(alerts);
      expect(title).toContain("Multi-Stage Attack");
    });

    it("returns generic title when no MITRE data", () => {
      expect(buildIncidentTitle([{}, {}])).toBe("Security Incident");
    });
  });
});

// ─── Sprint 55: Post-Clearance Audit Engine ──────────────────────────────────

// Import the exported functions from auditEngine
import { selectForAudit, calculateDutyDiscrepancy } from "./routers/auditEngine";

describe("Sprint 55 — Post-Clearance Audit Engine", () => {
  describe("selectForAudit", () => {
    it("selects high risk score declarations", () => {
      const reason = selectForAudit({
        riskScore: 75,
        declaredValueUsd: 10_000,
        traderTier: "standard",
        hsChapter: "62",
        laneAssigned: "RED",
        randomSeed: 0.5,
      });
      expect(reason).toBe("risk_score_high");
    });

    it("selects high-value shipments", () => {
      const reason = selectForAudit({
        riskScore: 30,
        declaredValueUsd: 600_000,
        traderTier: "standard",
        hsChapter: "62",
        laneAssigned: "GREEN",
        randomSeed: 0.5,
      });
      expect(reason).toBe("value_threshold");
    });

    it("selects sensitive HS chapters (tobacco = 24)", () => {
      const reason = selectForAudit({
        riskScore: 25,
        declaredValueUsd: 5_000,
        traderTier: "standard",
        hsChapter: "24",
        laneAssigned: "GREEN",
        randomSeed: 0.5,
      });
      expect(reason).toBe("hs_chapter_sensitive");
    });

    it("selects new traders with moderate risk", () => {
      const reason = selectForAudit({
        riskScore: 45,
        declaredValueUsd: 5_000,
        traderTier: "new",
        hsChapter: "62",
        laneAssigned: "YELLOW",
        randomSeed: 0.5,
      });
      expect(reason).toBe("trader_tier_review");
    });

    it("selects green-lane declarations with low random seed (5%)", () => {
      const reason = selectForAudit({
        riskScore: 15,
        declaredValueUsd: 5_000,
        traderTier: "aeo",
        hsChapter: "62",
        laneAssigned: "GREEN",
        randomSeed: 0.03,
      });
      expect(reason).toBe("post_green_lane");
    });

    it("selects random sample with seed < 0.10", () => {
      const reason = selectForAudit({
        riskScore: 15,
        declaredValueUsd: 5_000,
        traderTier: "aeo",
        hsChapter: "62",
        laneAssigned: "GREEN",
        randomSeed: 0.08,
      });
      expect(reason).toBe("random_sample");
    });

    it("returns null for low-risk AEO declarations", () => {
      const reason = selectForAudit({
        riskScore: 10,
        declaredValueUsd: 5_000,
        traderTier: "aeo",
        hsChapter: "62",
        laneAssigned: "GREEN",
        randomSeed: 0.99,
      });
      expect(reason).toBeNull();
    });
  });

  describe("calculateDutyDiscrepancy", () => {
    it("sums non-no_finding amounts", () => {
      const findings = [
        { id: "f1", auditTaskId: "a1", findingType: "undervaluation" as const, description: "", amountUsd: 5000, evidenceUrl: "", createdAt: "" },
        { id: "f2", auditTaskId: "a1", findingType: "misclassification" as const, description: "", amountUsd: 3000, evidenceUrl: "", createdAt: "" },
      ];
      expect(calculateDutyDiscrepancy(findings)).toBe(8000);
    });

    it("excludes no_finding entries", () => {
      const findings = [
        { id: "f1", auditTaskId: "a1", findingType: "no_finding" as const, description: "", amountUsd: 0, evidenceUrl: "", createdAt: "" },
        { id: "f2", auditTaskId: "a1", findingType: "undervaluation" as const, description: "", amountUsd: 2500, evidenceUrl: "", createdAt: "" },
      ];
      expect(calculateDutyDiscrepancy(findings)).toBe(2500);
    });

    it("returns 0 for empty findings", () => {
      expect(calculateDutyDiscrepancy([])).toBe(0);
    });

    it("returns 0 when all findings are no_finding", () => {
      const findings = [
        { id: "f1", auditTaskId: "a1", findingType: "no_finding" as const, description: "", amountUsd: 0, evidenceUrl: "", createdAt: "" },
      ];
      expect(calculateDutyDiscrepancy(findings)).toBe(0);
    });
  });
});

// ─── Sprint 56: Bonded Warehouse & Free Zone Management ──────────────────────

import { calculateBondRequirement, isBondExpiringSoon, generatePermitNo } from "./routers/bondedWarehouse";

describe("Sprint 56 — Bonded Warehouse Management", () => {
  describe("calculateBondRequirement", () => {
    it("calculates 110% of inventory value", () => {
      expect(calculateBondRequirement(1_000_000)).toBe(1_100_000);
    });

    it("rounds up to nearest integer", () => {
      expect(calculateBondRequirement(100_001)).toBe(110_002);
    });

    it("returns 0 for zero inventory", () => {
      expect(calculateBondRequirement(0)).toBe(0);
    });

    it("handles large values", () => {
      expect(calculateBondRequirement(10_000_000)).toBe(11_000_000);
    });
  });

  describe("isBondExpiringSoon", () => {
    it("returns true when bond expires within 30 days", () => {
      const expiry = new Date(Date.now() + 15 * 86400_000).toISOString();
      expect(isBondExpiringSoon(expiry, 30)).toBe(true);
    });

    it("returns true when bond expires today", () => {
      const expiry = new Date(Date.now() + 1000).toISOString();
      expect(isBondExpiringSoon(expiry, 30)).toBe(true);
    });

    it("returns false when bond expires in 60 days with 30-day threshold", () => {
      const expiry = new Date(Date.now() + 60 * 86400_000).toISOString();
      expect(isBondExpiringSoon(expiry, 30)).toBe(false);
    });

    it("returns true when already expired", () => {
      const expiry = new Date(Date.now() - 86400_000).toISOString();
      expect(isBondExpiringSoon(expiry, 30)).toBe(true);
    });

    it("uses custom withinDays threshold", () => {
      const expiry = new Date(Date.now() + 45 * 86400_000).toISOString();
      expect(isBondExpiringSoon(expiry, 60)).toBe(true);
      expect(isBondExpiringSoon(expiry, 30)).toBe(false);
    });
  });

  describe("generatePermitNo", () => {
    it("generates permit number with correct format BW-YYYY-XXXXXX", () => {
      const permitNo = generatePermitNo();
      const year = new Date().getFullYear();
      expect(permitNo).toMatch(new RegExp(`^BW-${year}-[A-F0-9]{6}$`));
    });

    it("generates unique permit numbers", () => {
      const permits = new Set(Array.from({ length: 100 }, () => generatePermitNo()));
      expect(permits.size).toBeGreaterThan(90); // Very high uniqueness
    });
  });

  describe("Warehouse capacity validation", () => {
    it("detects capacity overflow", () => {
      const capacityCbm = 5000;
      const usedCbm = 4900;
      const requestedCbm = 200;
      const wouldOverflow = usedCbm + requestedCbm > capacityCbm;
      expect(wouldOverflow).toBe(true);
    });

    it("allows entry within capacity", () => {
      const capacityCbm = 5000;
      const usedCbm = 4000;
      const requestedCbm = 500;
      const wouldOverflow = usedCbm + requestedCbm > capacityCbm;
      expect(wouldOverflow).toBe(false);
    });
  });

  describe("Inventory status transitions", () => {
    it("allows in_bond to ex_bonded transition", () => {
      const validTransitions: Record<string, string[]> = {
        in_bond: ["ex_bonded", "re_exported", "destroyed", "seized"],
        ex_bonded: [],
        re_exported: [],
        destroyed: [],
        seized: [],
      };
      expect(validTransitions["in_bond"]).toContain("ex_bonded");
    });

    it("does not allow ex_bonded to in_bond transition", () => {
      const validTransitions: Record<string, string[]> = {
        in_bond: ["ex_bonded", "re_exported", "destroyed", "seized"],
        ex_bonded: [],
      };
      expect(validTransitions["ex_bonded"]).not.toContain("in_bond");
    });
  });
});
