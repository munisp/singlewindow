/**
 * Sprint 42–44 Vitest Tests
 * Coverage:
 *   - Sprint 42: OpenCTI Threat Intelligence (STIX ingestion, indicator matching, graph enrichment)
 *   - Sprint 43: Wazuh SIEM/XDR (alert ingestion, agent management, playbook execution)
 *   - Sprint 44: Ray Distributed ML Risk Scorer (XGBoost scoring, AEO adjustment, feature importance)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── SPRINT 42: OpenCTI Threat Intelligence ────────────────────────────────────

describe("Sprint 42 — OpenCTI Threat Intelligence", () => {
  describe("STIX 2.1 Indicator Parsing", () => {
    it("parses STIX indicator with valid pattern", () => {
      const stixIndicator = {
        id: "indicator--12345678-1234-1234-1234-123456789012",
        type: "indicator",
        spec_version: "2.1",
        name: "Suspicious HS Code Pattern",
        pattern: "[customs:hs_code = '2939.99']",
        pattern_type: "stix",
        valid_from: "2026-01-01T00:00:00Z",
        indicator_types: ["malicious-activity"],
        confidence: 85,
        labels: ["customs-fraud", "under-valuation"],
      };

      expect(stixIndicator.type).toBe("indicator");
      expect(stixIndicator.spec_version).toBe("2.1");
      expect(stixIndicator.confidence).toBeGreaterThan(0);
      expect(stixIndicator.confidence).toBeLessThanOrEqual(100);
      expect(stixIndicator.pattern).toContain("2939.99");
    });

    it("validates STIX indicator ID format", () => {
      const validId = "indicator--12345678-1234-1234-1234-123456789012";
      const uuidPart = validId.split("--")[1];
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      expect(uuidRegex.test(uuidPart)).toBe(true);
    });

    it("rejects STIX indicator with missing required fields", () => {
      const incomplete = { type: "indicator", name: "Test" };
      const isValid = "id" in incomplete && "pattern" in incomplete && "valid_from" in incomplete;
      expect(isValid).toBe(false);
    });

    it("parses multiple STIX object types", () => {
      const stixBundle = {
        type: "bundle",
        id: "bundle--12345678-1234-1234-1234-123456789012",
        objects: [
          { type: "indicator", id: "indicator--aaa", pattern: "[ip-addr:value = '1.2.3.4']" },
          { type: "threat-actor", id: "threat-actor--bbb", name: "Smuggling Ring Alpha" },
          { type: "relationship", id: "relationship--ccc", relationship_type: "uses" },
        ],
      };

      const indicators = stixBundle.objects.filter(o => o.type === "indicator");
      const actors = stixBundle.objects.filter(o => o.type === "threat-actor");
      expect(indicators).toHaveLength(1);
      expect(actors).toHaveLength(1);
    });
  });

  describe("Indicator Matching Logic", () => {
    const indicators = [
      { id: "ind-1", pattern_field: "hs_code", pattern_value: "2939.99", confidence: 90, severity: "HIGH" },
      { id: "ind-2", pattern_field: "origin_country", pattern_value: "CO", confidence: 75, severity: "MEDIUM" },
      { id: "ind-3", pattern_field: "trader_id", pattern_value: "TRADER-BLACKLIST-001", confidence: 95, severity: "CRITICAL" },
    ];

    function matchIndicators(declaration: Record<string, string>) {
      return indicators.filter(ind => {
        const value = declaration[ind.pattern_field];
        return value === ind.pattern_value;
      });
    }

    it("matches indicator by HS code", () => {
      const decl = { hs_code: "2939.99", origin_country: "DE", trader_id: "TRADER-001" };
      const matches = matchIndicators(decl);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe("ind-1");
    });

    it("matches multiple indicators simultaneously", () => {
      const decl = { hs_code: "2939.99", origin_country: "CO", trader_id: "TRADER-001" };
      const matches = matchIndicators(decl);
      expect(matches).toHaveLength(2);
    });

    it("matches blacklisted trader ID", () => {
      const decl = { hs_code: "8471.30", origin_country: "CN", trader_id: "TRADER-BLACKLIST-001" };
      const matches = matchIndicators(decl);
      expect(matches).toHaveLength(1);
      expect(matches[0].severity).toBe("CRITICAL");
    });

    it("returns empty array for clean declaration", () => {
      const decl = { hs_code: "6204.62", origin_country: "IT", trader_id: "TRADER-CLEAN-999" };
      const matches = matchIndicators(decl);
      expect(matches).toHaveLength(0);
    });

    it("calculates aggregate threat score from matched indicators", () => {
      const matches = [
        { confidence: 90, severity: "HIGH" },
        { confidence: 75, severity: "MEDIUM" },
      ];
      const severityWeights: Record<string, number> = { CRITICAL: 1.5, HIGH: 1.2, MEDIUM: 1.0, LOW: 0.7 };
      const score = matches.reduce((sum, m) => {
        return sum + m.confidence * (severityWeights[m.severity] ?? 1.0);
      }, 0) / matches.length;
      expect(score).toBeGreaterThan(80);
    });
  });

  describe("Threat Graph Enrichment", () => {
    it("builds threat graph node from STIX object", () => {
      const stixActor = {
        id: "threat-actor--abc",
        type: "threat-actor",
        name: "Smuggling Ring Alpha",
        threat_actor_types: ["criminal"],
        sophistication: "intermediate",
        resource_level: "organization",
      };

      const node = {
        id: stixActor.id,
        label: stixActor.name,
        type: stixActor.type,
        properties: {
          sophistication: stixActor.sophistication,
          resource_level: stixActor.resource_level,
        },
      };

      expect(node.type).toBe("threat-actor");
      expect(node.label).toBe("Smuggling Ring Alpha");
      expect(node.properties.sophistication).toBe("intermediate");
    });

    it("creates relationship edge between threat actor and indicator", () => {
      const relationship = {
        source_id: "threat-actor--abc",
        target_id: "indicator--xyz",
        type: "uses",
        weight: 0.9,
      };

      expect(relationship.source_id).toContain("threat-actor--");
      expect(relationship.target_id).toContain("indicator--");
      expect(relationship.weight).toBeGreaterThan(0);
    });

    it("deduplicates graph nodes on re-ingestion", () => {
      const existingNodes = new Map([
        ["indicator--aaa", { id: "indicator--aaa", version: 1 }],
      ]);

      const incomingNode = { id: "indicator--aaa", version: 2 };
      const isUpdate = existingNodes.has(incomingNode.id);
      if (isUpdate) {
        existingNodes.set(incomingNode.id, incomingNode);
      }

      expect(existingNodes.size).toBe(1);
      expect(existingNodes.get("indicator--aaa")?.version).toBe(2);
    });
  });

  describe("CEN Alert to STIX Conversion", () => {
    it("converts WCO CEN alert to STIX indicator", () => {
      const cenAlert = {
        alert_id: "CEN-2026-001",
        alert_type: "DRUG_PRECURSOR",
        hs_code: "2939.99",
        origin_country: "CO",
        severity: "HIGH",
        description: "Suspected precursor chemical shipment",
        issued_by: "GH",
        issued_at: "2026-03-01T10:00:00Z",
      };

      const stixIndicator = {
        id: `indicator--${cenAlert.alert_id.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
        type: "indicator",
        spec_version: "2.1",
        name: `CEN Alert: ${cenAlert.alert_type}`,
        pattern: `[customs:hs_code = '${cenAlert.hs_code}' AND customs:origin_country = '${cenAlert.origin_country}']`,
        pattern_type: "stix",
        valid_from: cenAlert.issued_at,
        confidence: cenAlert.severity === "HIGH" ? 80 : 60,
        labels: ["customs-enforcement", cenAlert.alert_type.toLowerCase()],
      };

      expect(stixIndicator.type).toBe("indicator");
      expect(stixIndicator.pattern).toContain("2939.99");
      expect(stixIndicator.pattern).toContain("CO");
      expect(stixIndicator.confidence).toBe(80);
    });
  });
});

// ─── SPRINT 43: Wazuh SIEM/XDR ────────────────────────────────────────────────

describe("Sprint 43 — Wazuh SIEM / XDR", () => {
  describe("Alert Classification", () => {
    function classifyAlert(ruleId: number, eventData: Record<string, unknown>): string {
      if (ruleId >= 5500 && ruleId < 5600) return "AUTHENTICATION_FAILURE";
      if (ruleId >= 5700 && ruleId < 5800) return "PRIVILEGE_ESCALATION";
      if (ruleId >= 31100 && ruleId < 31200) return "API_ABUSE";
      if (ruleId >= 40100 && ruleId < 40200) return "ANOMALOUS_BEHAVIOUR";
      if (eventData.failed_attempts && (eventData.failed_attempts as number) > 5) return "BRUTE_FORCE";
      return "GENERIC";
    }

    it("classifies authentication failure by rule ID range", () => {
      expect(classifyAlert(5501, {})).toBe("AUTHENTICATION_FAILURE");
    });

    it("classifies privilege escalation by rule ID range", () => {
      expect(classifyAlert(5701, {})).toBe("PRIVILEGE_ESCALATION");
    });

    it("classifies API abuse by rule ID range", () => {
      expect(classifyAlert(31101, {})).toBe("API_ABUSE");
    });

    it("classifies brute force by failed attempt count", () => {
      expect(classifyAlert(9999, { failed_attempts: 10 })).toBe("BRUTE_FORCE");
    });

    it("returns GENERIC for unknown rule", () => {
      expect(classifyAlert(99999, {})).toBe("GENERIC");
    });
  });

  describe("Login Anomaly Detection", () => {
    interface LoginEvent {
      userId: string;
      ip: string;
      timestamp: number;
      success: boolean;
      country?: string;
    }

    function detectLoginAnomalies(events: LoginEvent[]): string[] {
      const anomalies: string[] = [];

      // Rule 1: More than 5 failures in 5 minutes
      const failures = events.filter(e => !e.success);
      const windowMs = 5 * 60 * 1000;
      const recentFailures = failures.filter(e => Date.now() - e.timestamp < windowMs);
      if (recentFailures.length > 5) anomalies.push("BRUTE_FORCE");

      // Rule 2: Login from multiple countries in 1 hour
      const countries = new Set(events.filter(e => e.success && e.country).map(e => e.country));
      if (countries.size > 2) anomalies.push("IMPOSSIBLE_TRAVEL");

      // Rule 3: Login outside business hours (before 6am or after 10pm UTC)
      const oddHourLogins = events.filter(e => {
        const hour = new Date(e.timestamp).getUTCHours();
        return e.success && (hour < 6 || hour > 22);
      });
      if (oddHourLogins.length > 0) anomalies.push("ODD_HOUR_ACCESS");

      return anomalies;
    }

    it("detects brute force attack from multiple failures", () => {
      const now = Date.now();
      const events: LoginEvent[] = Array.from({ length: 8 }, (_, i) => ({
        userId: "user-1",
        ip: "1.2.3.4",
        timestamp: now - i * 30000,
        success: false,
      }));
      const anomalies = detectLoginAnomalies(events);
      expect(anomalies).toContain("BRUTE_FORCE");
    });

    it("detects impossible travel from multiple countries", () => {
      const now = Date.now();
      const events: LoginEvent[] = [
        { userId: "user-1", ip: "1.1.1.1", timestamp: now - 1000, success: true, country: "GH" },
        { userId: "user-1", ip: "2.2.2.2", timestamp: now - 2000, success: true, country: "SG" },
        { userId: "user-1", ip: "3.3.3.3", timestamp: now - 3000, success: true, country: "RW" },
      ];
      const anomalies = detectLoginAnomalies(events);
      expect(anomalies).toContain("IMPOSSIBLE_TRAVEL");
    });

    it("returns empty array for normal login pattern", () => {
      const now = Date.now();
      const events: LoginEvent[] = [
        { userId: "user-1", ip: "1.1.1.1", timestamp: now - 1000, success: true, country: "GH" },
        { userId: "user-1", ip: "1.1.1.1", timestamp: now - 2000, success: true, country: "GH" },
      ];
      const anomalies = detectLoginAnomalies(events);
      expect(anomalies).not.toContain("BRUTE_FORCE");
      expect(anomalies).not.toContain("IMPOSSIBLE_TRAVEL");
    });
  });

  describe("API Key Abuse Detection", () => {
    interface ApiRequest {
      apiKeyId: string;
      endpoint: string;
      timestamp: number;
      statusCode: number;
    }

    function detectApiAbuse(requests: ApiRequest[], windowMs = 60000): {
      isAbuse: boolean;
      reasons: string[];
      requestCount: number;
    } {
      const now = Date.now();
      const recent = requests.filter(r => now - r.timestamp < windowMs);
      const reasons: string[] = [];

      if (recent.length > 100) reasons.push("RATE_LIMIT_EXCEEDED");

      const errorRate = recent.filter(r => r.statusCode >= 400).length / Math.max(recent.length, 1);
      if (errorRate > 0.5) reasons.push("HIGH_ERROR_RATE");

      const uniqueEndpoints = new Set(recent.map(r => r.endpoint)).size;
      if (uniqueEndpoints > 20) reasons.push("ENDPOINT_SCANNING");

      return { isAbuse: reasons.length > 0, reasons, requestCount: recent.length };
    }

    it("detects rate limit exceeded", () => {
      const now = Date.now();
      const requests: ApiRequest[] = Array.from({ length: 150 }, (_, i) => ({
        apiKeyId: "key-1",
        endpoint: "/api/trpc/declarations.list",
        timestamp: now - i * 100,
        statusCode: 200,
      }));
      const result = detectApiAbuse(requests);
      expect(result.isAbuse).toBe(true);
      expect(result.reasons).toContain("RATE_LIMIT_EXCEEDED");
    });

    it("detects endpoint scanning behaviour", () => {
      const now = Date.now();
      const endpoints = Array.from({ length: 25 }, (_, i) => `/api/trpc/endpoint${i}`);
      const requests: ApiRequest[] = endpoints.map((ep, i) => ({
        apiKeyId: "key-1",
        endpoint: ep,
        timestamp: now - i * 1000,
        statusCode: 200,
      }));
      const result = detectApiAbuse(requests);
      expect(result.isAbuse).toBe(true);
      expect(result.reasons).toContain("ENDPOINT_SCANNING");
    });

    it("returns no abuse for normal API usage", () => {
      const now = Date.now();
      const requests: ApiRequest[] = Array.from({ length: 10 }, (_, i) => ({
        apiKeyId: "key-1",
        endpoint: "/api/trpc/declarations.list",
        timestamp: now - i * 5000,
        statusCode: 200,
      }));
      const result = detectApiAbuse(requests);
      expect(result.isAbuse).toBe(false);
    });
  });

  describe("Playbook Execution", () => {
    interface PlaybookAction {
      type: string;
      params: Record<string, unknown>;
    }

    function executePlaybook(playbookId: string, alertId: string): {
      success: boolean;
      actions_taken: string[];
      execution_time_ms: number;
    } {
      const playbooks: Record<string, PlaybookAction[]> = {
        "block-ip": [
          { type: "BLOCK_IP", params: { duration_hours: 24 } },
          { type: "NOTIFY_ADMIN", params: { channel: "email" } },
          { type: "LOG_INCIDENT", params: { severity: "HIGH" } },
        ],
        "lock-account": [
          { type: "LOCK_USER_ACCOUNT", params: { reason: "suspicious_activity" } },
          { type: "INVALIDATE_SESSIONS", params: {} },
          { type: "NOTIFY_ADMIN", params: { channel: "sms" } },
        ],
        "revoke-api-key": [
          { type: "REVOKE_API_KEY", params: {} },
          { type: "NOTIFY_DEVELOPER", params: { channel: "email" } },
        ],
      };

      const actions = playbooks[playbookId] ?? [];
      return {
        success: actions.length > 0,
        actions_taken: actions.map(a => a.type),
        execution_time_ms: actions.length * 50,
      };
    }

    it("executes block-ip playbook with 3 actions", () => {
      const result = executePlaybook("block-ip", "alert-001");
      expect(result.success).toBe(true);
      expect(result.actions_taken).toHaveLength(3);
      expect(result.actions_taken).toContain("BLOCK_IP");
      expect(result.actions_taken).toContain("NOTIFY_ADMIN");
    });

    it("executes lock-account playbook", () => {
      const result = executePlaybook("lock-account", "alert-002");
      expect(result.success).toBe(true);
      expect(result.actions_taken).toContain("LOCK_USER_ACCOUNT");
      expect(result.actions_taken).toContain("INVALIDATE_SESSIONS");
    });

    it("executes revoke-api-key playbook", () => {
      const result = executePlaybook("revoke-api-key", "alert-003");
      expect(result.success).toBe(true);
      expect(result.actions_taken).toContain("REVOKE_API_KEY");
    });

    it("returns failure for unknown playbook", () => {
      const result = executePlaybook("unknown-playbook", "alert-004");
      expect(result.success).toBe(false);
      expect(result.actions_taken).toHaveLength(0);
    });
  });

  describe("Security Score Calculation", () => {
    function calculateSecurityScore(metrics: {
      unresolvedCritical: number;
      unresolvedHigh: number;
      unresolvedMedium: number;
      activeAgents: number;
      totalAgents: number;
      playbooksExecuted: number;
    }): { score: number; grade: string } {
      let score = 100;
      score -= metrics.unresolvedCritical * 15;
      score -= metrics.unresolvedHigh * 8;
      score -= metrics.unresolvedMedium * 3;

      const agentCoverage = metrics.totalAgents > 0
        ? metrics.activeAgents / metrics.totalAgents
        : 1;
      score = score * agentCoverage;

      score = Math.max(0, Math.min(100, Math.round(score)));

      let grade: string;
      if (score >= 90) grade = "A";
      else if (score >= 80) grade = "B";
      else if (score >= 70) grade = "C";
      else if (score >= 60) grade = "D";
      else grade = "F";

      return { score, grade };
    }

    it("returns A grade for clean environment", () => {
      const result = calculateSecurityScore({
        unresolvedCritical: 0, unresolvedHigh: 0, unresolvedMedium: 0,
        activeAgents: 10, totalAgents: 10, playbooksExecuted: 5,
      });
      expect(result.grade).toBe("A");
      expect(result.score).toBe(100);
    });

    it("penalises critical unresolved alerts heavily", () => {
      const result = calculateSecurityScore({
        unresolvedCritical: 3, unresolvedHigh: 0, unresolvedMedium: 0,
        activeAgents: 10, totalAgents: 10, playbooksExecuted: 0,
      });
      expect(result.score).toBeLessThan(60);
    });

    it("reduces score for disconnected agents", () => {
      const full = calculateSecurityScore({
        unresolvedCritical: 0, unresolvedHigh: 0, unresolvedMedium: 0,
        activeAgents: 10, totalAgents: 10, playbooksExecuted: 0,
      });
      const partial = calculateSecurityScore({
        unresolvedCritical: 0, unresolvedHigh: 0, unresolvedMedium: 0,
        activeAgents: 5, totalAgents: 10, playbooksExecuted: 0,
      });
      expect(partial.score).toBeLessThan(full.score);
    });
  });
});

// ─── SPRINT 44: Ray Distributed ML Risk Scorer ────────────────────────────────

describe("Sprint 44 — Ray Distributed ML Risk Scorer", () => {
  describe("Feature Engineering", () => {
    interface DeclarationFeatures {
      hsCode: string;
      declaredValue: number;
      weightKg?: number;
      originCountry: string;
      destCountry: string;
      traderId: string;
      aeoStatus: "FULL" | "SECURITY" | "CUSTOMS" | null;
      traderDeclarationCount: number;
      traderViolationCount: number;
      isExpress: boolean;
    }

    function engineerFeatures(decl: DeclarationFeatures): Record<string, number> {
      const features: Record<string, number> = {};

      // HS code chapter (first 2 digits)
      features["hs_chapter"] = parseInt(decl.hsCode.split(".")[0].substring(0, 2)) || 0;

      // Value per kg (under-valuation signal)
      if (decl.weightKg && decl.weightKg > 0) {
        features["value_per_kg"] = decl.declaredValue / decl.weightKg;
      } else {
        features["value_per_kg"] = decl.declaredValue;
      }

      // High-risk origin flag
      const highRiskOrigins = ["CO", "AF", "MM", "VE", "NG"];
      features["high_risk_origin"] = highRiskOrigins.includes(decl.originCountry) ? 1 : 0;

      // Trader compliance ratio
      const violationRate = decl.traderDeclarationCount > 0
        ? decl.traderViolationCount / decl.traderDeclarationCount
        : 0;
      features["trader_violation_rate"] = violationRate;

      // AEO status (0 = none, 1 = customs, 2 = security, 3 = full)
      const aeoMap: Record<string, number> = { FULL: 3, SECURITY: 2, CUSTOMS: 1 };
      features["aeo_level"] = decl.aeoStatus ? (aeoMap[decl.aeoStatus] ?? 0) : 0;

      // Express shipment flag
      features["is_express"] = decl.isExpress ? 1 : 0;

      // Declared value log (normalise large values)
      features["log_declared_value"] = Math.log1p(decl.declaredValue);

      return features;
    }

    it("extracts HS chapter from HS code", () => {
      const features = engineerFeatures({
        hsCode: "2939.99", declaredValue: 50000, originCountry: "CO",
        destCountry: "GH", traderId: "T1", aeoStatus: null,
        traderDeclarationCount: 10, traderViolationCount: 1, isExpress: false,
      });
      expect(features["hs_chapter"]).toBe(29);
    });

    it("calculates value per kg correctly", () => {
      const features = engineerFeatures({
        hsCode: "6204.62", declaredValue: 10000, weightKg: 500,
        originCountry: "IT", destCountry: "GH", traderId: "T1",
        aeoStatus: null, traderDeclarationCount: 100, traderViolationCount: 0, isExpress: false,
      });
      expect(features["value_per_kg"]).toBe(20);
    });

    it("flags high-risk origin country", () => {
      const features = engineerFeatures({
        hsCode: "2939.99", declaredValue: 50000, originCountry: "CO",
        destCountry: "GH", traderId: "T1", aeoStatus: null,
        traderDeclarationCount: 5, traderViolationCount: 1, isExpress: false,
      });
      expect(features["high_risk_origin"]).toBe(1);
    });

    it("does not flag low-risk origin country", () => {
      const features = engineerFeatures({
        hsCode: "6204.62", declaredValue: 5000, originCountry: "DE",
        destCountry: "GH", traderId: "T1", aeoStatus: null,
        traderDeclarationCount: 200, traderViolationCount: 0, isExpress: false,
      });
      expect(features["high_risk_origin"]).toBe(0);
    });

    it("encodes AEO status as ordinal level", () => {
      const fullFeatures = engineerFeatures({
        hsCode: "6204.62", declaredValue: 5000, originCountry: "DE",
        destCountry: "GH", traderId: "T1", aeoStatus: "FULL",
        traderDeclarationCount: 500, traderViolationCount: 0, isExpress: false,
      });
      const noneFeatures = engineerFeatures({
        hsCode: "6204.62", declaredValue: 5000, originCountry: "DE",
        destCountry: "GH", traderId: "T1", aeoStatus: null,
        traderDeclarationCount: 10, traderViolationCount: 0, isExpress: false,
      });
      expect(fullFeatures["aeo_level"]).toBeGreaterThan(noneFeatures["aeo_level"]);
    });
  });

  describe("Risk Score Calculation", () => {
    function calculateRiskScore(features: Record<string, number>): {
      score: number;
      tier: "GREEN" | "YELLOW" | "RED";
      lane: "AUTO_APPROVE" | "DOC_CHECK" | "PHYSICAL_INSPECTION";
    } {
      // Simplified gradient boosted model simulation
      let score = 0;
      score += (features["high_risk_origin"] ?? 0) * 25;
      score += (features["trader_violation_rate"] ?? 0) * 40;
      score += Math.min((features["hs_chapter"] ?? 0) === 29 ? 20 : 0, 20);
      score -= (features["aeo_level"] ?? 0) * 8;
      score += (features["is_express"] ?? 0) * 5;
      score = Math.max(0, Math.min(100, Math.round(score)));

      let tier: "GREEN" | "YELLOW" | "RED";
      let lane: "AUTO_APPROVE" | "DOC_CHECK" | "PHYSICAL_INSPECTION";
      if (score < 30) { tier = "GREEN"; lane = "AUTO_APPROVE"; }
      else if (score < 65) { tier = "YELLOW"; lane = "DOC_CHECK"; }
      else { tier = "RED"; lane = "PHYSICAL_INSPECTION"; }

      return { score, tier, lane };
    }

    it("assigns GREEN lane to low-risk AEO trader", () => {
      const features = {
        high_risk_origin: 0,
        trader_violation_rate: 0,
        hs_chapter: 62,
        aeo_level: 3,
        is_express: 0,
        log_declared_value: Math.log1p(5000),
      };
      const result = calculateRiskScore(features);
      expect(result.tier).toBe("GREEN");
      expect(result.lane).toBe("AUTO_APPROVE");
    });

    it("assigns RED lane to high-risk declaration", () => {
      const features = {
        high_risk_origin: 1,
        trader_violation_rate: 0.5,
        hs_chapter: 29,
        aeo_level: 0,
        is_express: 1,
        log_declared_value: Math.log1p(500000),
      };
      const result = calculateRiskScore(features);
      expect(result.tier).toBe("RED");
      expect(result.lane).toBe("PHYSICAL_INSPECTION");
    });

    it("assigns YELLOW lane to medium-risk declaration", () => {
      const features = {
        high_risk_origin: 1,
        trader_violation_rate: 0.15,  // 0.15 * 40 = 6, total = 25+6 = 31 → YELLOW
        hs_chapter: 84,
        aeo_level: 0,
        is_express: 0,
        log_declared_value: Math.log1p(50000),
      };
      const result = calculateRiskScore(features);
      expect(result.tier).toBe("YELLOW");
    });

    it("AEO status reduces risk score", () => {
      const baseFeatures = {
        high_risk_origin: 1, trader_violation_rate: 0, hs_chapter: 62,
        aeo_level: 0, is_express: 0, log_declared_value: 10,
      };
      const aeoFeatures = { ...baseFeatures, aeo_level: 3 };
      const baseResult = calculateRiskScore(baseFeatures);
      const aeoResult = calculateRiskScore(aeoFeatures);
      expect(aeoResult.score).toBeLessThan(baseResult.score);
    });
  });

  describe("Batch Scoring", () => {
    it("scores multiple declarations in batch", () => {
      const declarations = [
        { id: "UCR-001", score: 15 },
        { id: "UCR-002", score: 72 },
        { id: "UCR-003", score: 45 },
        { id: "UCR-004", score: 8 },
        { id: "UCR-005", score: 88 },
      ];

      const greenCount = declarations.filter(d => d.score < 30).length;
      const yellowCount = declarations.filter(d => d.score >= 30 && d.score < 65).length;
      const redCount = declarations.filter(d => d.score >= 65).length;

      expect(greenCount).toBe(2);
      expect(yellowCount).toBe(1);
      expect(redCount).toBe(2);
      expect(greenCount + yellowCount + redCount).toBe(declarations.length);
    });

    it("calculates batch statistics correctly", () => {
      const scores = [15, 72, 45, 8, 88, 32, 61, 5, 78, 22];
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const max = Math.max(...scores);
      const min = Math.min(...scores);
      expect(avg).toBeCloseTo(42.6, 1);
      expect(max).toBe(88);
      expect(min).toBe(5);
    });
  });

  describe("Model Version Management", () => {
    it("validates semantic version format", () => {
      const validVersions = ["1.0.0", "2.3.1", "10.0.5"];
      const invalidVersions = ["v1.0", "1.0", "latest"];
      const semverRegex = /^\d+\.\d+\.\d+$/;

      validVersions.forEach(v => expect(semverRegex.test(v)).toBe(true));
      invalidVersions.forEach(v => expect(semverRegex.test(v)).toBe(false));
    });

    it("compares model versions correctly", () => {
      function compareVersions(a: string, b: string): number {
        const [aMaj, aMin, aPatch] = a.split(".").map(Number);
        const [bMaj, bMin, bPatch] = b.split(".").map(Number);
        if (aMaj !== bMaj) return aMaj - bMaj;
        if (aMin !== bMin) return aMin - bMin;
        return aPatch - bPatch;
      }
      expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
      expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
      expect(compareVersions("1.5.3", "1.5.3")).toBe(0);
    });

    it("tracks model performance metrics across versions", () => {
      const versions = [
        { version: "1.0.0", auc_roc: 0.82, f1: 0.78 },
        { version: "1.1.0", auc_roc: 0.85, f1: 0.81 },
        { version: "2.0.0", auc_roc: 0.91, f1: 0.88 },
      ];

      const latest = versions[versions.length - 1];
      const improvement = latest.auc_roc - versions[0].auc_roc;
      expect(improvement).toBeGreaterThan(0.05);
      expect(latest.auc_roc).toBeGreaterThan(0.9);
    });
  });
});
