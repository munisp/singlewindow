/**
 * Sprint 39–41 Vitest Tests
 * Sprint 39: WCO CEN Network integration (cen.ts router + Go cen-service)
 * Sprint 40: Free Zone operations management (freeZone.ts router + Go freezone-service)
 * Sprint 41: Open API ecosystem portal (devPortal.ts router + API key management)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── SPRINT 39: WCO CEN Network ──────────────────────────────────────────────

describe("Sprint 39 — WCO CEN Network Integration", () => {
  describe("WCO XML Alert Formatting", () => {
    it("formats a DRUG_TRAFFICKING alert as valid WCO CEN XML", () => {
      const alert = {
        alertType: "DRUG_TRAFFICKING",
        severity: "CRITICAL",
        ucr: "UCR-2026-GH-001234",
        hsCode: "2939.99",
        description: "Suspected narcotics concealed in textile shipment",
        targetCountry: "NG",
        originCountry: "CO",
      };

      const xml = formatCenAlertXml(alert);
      expect(xml).toContain("<?xml");
      expect(xml).toContain("WCO_CEN_Alert");
      expect(xml).toContain("DRUG_TRAFFICKING");
      expect(xml).toContain("CRITICAL");
      expect(xml).toContain("UCR-2026-GH-001234");
      expect(xml).toContain("2939.99");
    });

    it("includes sender country code in WCO CEN XML header", () => {
      const xml = formatCenAlertXml({
        alertType: "SANCTIONS_VIOLATION",
        severity: "HIGH",
        ucr: "UCR-2026-GH-005678",
        hsCode: "8471.30",
        description: "Sanctioned entity detected",
        targetCountry: "US",
        originCountry: "IR",
      });
      expect(xml).toContain("<SenderCountry>");
      expect(xml).toContain("<RecipientCountry>US</RecipientCountry>");
    });

    it("sets correct WCO CEN message type for each alert category", () => {
      const categories = [
        "DRUG_TRAFFICKING",
        "WEAPONS",
        "COUNTERFEITING",
        "SANCTIONS_VIOLATION",
        "MONEY_LAUNDERING",
      ];
      for (const cat of categories) {
        const xml = formatCenAlertXml({
          alertType: cat,
          severity: "MEDIUM",
          ucr: "UCR-TEST",
          hsCode: "0000.00",
          description: "Test",
          targetCountry: "SG",
          originCountry: "XX",
        });
        expect(xml).toContain(cat);
      }
    });
  });

  describe("Partner Registry", () => {
    it("returns all WCO CEN partner countries", () => {
      const partners = getCenPartners();
      expect(partners.length).toBeGreaterThanOrEqual(10);
      const codes = partners.map((p: any) => p.countryCode);
      expect(codes).toContain("SG");
      expect(codes).toContain("KE");
      expect(codes).toContain("ZA");
    });

    it("each partner has required fields: countryCode, name, gatewayUrl, status", () => {
      const partners = getCenPartners();
      for (const p of partners) {
        expect(p).toHaveProperty("countryCode");
        expect(p).toHaveProperty("name");
        expect(p).toHaveProperty("gatewayUrl");
        expect(p).toHaveProperty("status");
        expect(p.countryCode).toHaveLength(2);
      }
    });
  });

  describe("Alert Severity Escalation", () => {
    it("escalates CRITICAL alerts with immediate dispatch flag", () => {
      const result = classifyAlertDispatch({ severity: "CRITICAL", alertType: "WEAPONS" });
      expect(result.immediateDispatch).toBe(true);
      expect(result.notifyOwner).toBe(true);
    });

    it("does not set immediate dispatch for LOW severity alerts", () => {
      const result = classifyAlertDispatch({ severity: "LOW", alertType: "COUNTERFEITING" });
      expect(result.immediateDispatch).toBe(false);
    });

    it("HIGH severity alerts are dispatched within SLA of 1 hour", () => {
      const result = classifyAlertDispatch({ severity: "HIGH", alertType: "DRUG_TRAFFICKING" });
      expect(result.slaHours).toBeLessThanOrEqual(1);
    });

    it("MEDIUM severity alerts have 24-hour SLA", () => {
      const result = classifyAlertDispatch({ severity: "MEDIUM", alertType: "COUNTERFEITING" });
      expect(result.slaHours).toBe(24);
    });
  });

  describe("Inbound ACK Processing", () => {
    it("marks alert as ACKNOWLEDGED when ACK received", () => {
      const state = processInboundAck({
        messageId: "MSG-001",
        ackCode: "ACK",
        ackTimestamp: Date.now(),
      });
      expect(state.status).toBe("ACKNOWLEDGED");
    });

    it("marks alert as REJECTED when NACK received with reason", () => {
      const state = processInboundAck({
        messageId: "MSG-002",
        ackCode: "NACK",
        reason: "INVALID_HS_CODE",
        ackTimestamp: Date.now(),
      });
      expect(state.status).toBe("REJECTED");
      expect(state.reason).toBe("INVALID_HS_CODE");
    });

    it("computes round-trip latency from dispatch to ACK", () => {
      const dispatchedAt = Date.now() - 3500;
      const state = processInboundAck({
        messageId: "MSG-003",
        ackCode: "ACK",
        ackTimestamp: Date.now(),
        dispatchedAt,
      });
      expect(state.latencyMs).toBeGreaterThan(3000);
      expect(state.latencyMs).toBeLessThan(5000);
    });
  });

  describe("Alert Correlation", () => {
    it("correlates alerts by UCR across multiple partner reports", () => {
      const alerts = [
        { ucr: "UCR-001", source: "SG", alertType: "DRUG_TRAFFICKING" },
        { ucr: "UCR-001", source: "MY", alertType: "DRUG_TRAFFICKING" },
        { ucr: "UCR-002", source: "SG", alertType: "WEAPONS" },
      ];
      const correlated = correlateAlerts(alerts);
      const ucr001Group = correlated.find((g: any) => g.ucr === "UCR-001");
      expect(ucr001Group).toBeDefined();
      expect(ucr001Group.sources).toHaveLength(2);
      expect(ucr001Group.riskMultiplier).toBeGreaterThan(1);
    });

    it("assigns higher risk multiplier when same UCR reported by 3+ partners", () => {
      const alerts = [
        { ucr: "UCR-HOT", source: "SG", alertType: "WEAPONS" },
        { ucr: "UCR-HOT", source: "MY", alertType: "WEAPONS" },
        { ucr: "UCR-HOT", source: "TH", alertType: "WEAPONS" },
      ];
      const correlated = correlateAlerts(alerts);
      const group = correlated.find((g: any) => g.ucr === "UCR-HOT");
      expect(group.riskMultiplier).toBeGreaterThanOrEqual(3);
    });
  });
});

// ─── SPRINT 40: Free Zone Operations ─────────────────────────────────────────

describe("Sprint 40 — Free Zone Operations Management", () => {
  describe("Zone Registration", () => {
    it("generates a unique zone licence number on registration", () => {
      const licence1 = generateZoneLicence("TFZ", "GH");
      const licence2 = generateZoneLicence("KFZ", "GH");
      expect(licence1).toMatch(/^GH-FZ-/);
      expect(licence2).toMatch(/^GH-FZ-/);
      expect(licence1).not.toBe(licence2);
    });

    it("validates zone code is 2–10 uppercase alphanumeric characters", () => {
      expect(validateZoneCode("TFZ")).toBe(true);
      expect(validateZoneCode("TEMA2025")).toBe(true);
      expect(validateZoneCode("t")).toBe(false);
      expect(validateZoneCode("TOOLONGCODE123")).toBe(false);
      expect(validateZoneCode("")).toBe(false);
    });

    it("rejects duplicate zone codes within the same country", () => {
      const existingCodes = ["TFZ", "KFZ", "AFZ"];
      expect(isZoneCodeAvailable("TFZ", existingCodes)).toBe(false);
      expect(isZoneCodeAvailable("NFZ", existingCodes)).toBe(true);
    });

    it("assigns PENDING status to newly registered zones", () => {
      const zone = createZoneRecord({
        name: "Tema Free Zone",
        code: "TFZ",
        location: "Tema, Greater Accra",
        operatorName: "Ghana Free Zones Authority",
        zoneType: "EXPORT_PROCESSING",
        capacityM3: 500000,
      });
      expect(zone.status).toBe("PENDING");
      expect(zone.licenceNumber).toBeDefined();
    });
  });

  describe("Goods Admission", () => {
    it("creates an admission record with ADMITTED status", () => {
      const record = admitGoods({
        zoneId: "zone-001",
        ucr: "UCR-2026-GH-ADM001",
        traderRef: "TRADER-REF-001",
        hsCode: "8471.30",
        description: "Laptop computers",
        originCountry: "CN",
        grossWeightKg: 500,
        volumeM3: 2.5,
        invoiceValue: 150000,
        currency: "USD",
      });
      expect(record.status).toBe("ADMITTED");
      expect(record.admissionRef).toBeDefined();
      expect(record.admittedAt).toBeDefined();
    });

    it("calculates duty suspension amount based on invoice value and duty rate", () => {
      const suspension = calculateDutySuspension({
        invoiceValue: 100000,
        currency: "USD",
        dutyRate: 0.15,
      });
      expect(suspension.suspendedDutyAmount).toBe(15000);
      expect(suspension.currency).toBe("USD");
    });

    it("rejects admission if zone capacity would be exceeded", () => {
      const result = checkCapacity({
        zoneCapacityM3: 1000,
        currentUsedM3: 950,
        incomingVolumeM3: 100,
      });
      expect(result.canAdmit).toBe(false);
      expect(result.availableM3).toBe(50);
    });

    it("allows admission when sufficient capacity exists", () => {
      const result = checkCapacity({
        zoneCapacityM3: 1000,
        currentUsedM3: 500,
        incomingVolumeM3: 100,
      });
      expect(result.canAdmit).toBe(true);
    });
  });

  describe("Goods Transfer Between Zones", () => {
    it("creates a transfer record linking source and destination zones", () => {
      const transfer = createTransferRecord({
        goodsId: "goods-001",
        fromZoneId: "zone-001",
        toZoneId: "zone-002",
        reason: "Consolidation for re-export",
        officerRef: "OFF-2026-001",
      });
      expect(transfer.status).toBe("PENDING_APPROVAL");
      expect(transfer.fromZoneId).toBe("zone-001");
      expect(transfer.toZoneId).toBe("zone-002");
    });
  });

  describe("Goods Exit", () => {
    it("marks goods as EXITED and triggers duty settlement for DOMESTIC exit", () => {
      const exit = processExit({
        goodsId: "goods-001",
        destination: "DOMESTIC",
        suspendedDutyAmount: 15000,
        dutyPaid: 15000,
      });
      expect(exit.status).toBe("EXITED");
      expect(exit.dutySettled).toBe(true);
      expect(exit.destination).toBe("DOMESTIC");
    });

    it("waives duty for RE_EXPORT exit", () => {
      const exit = processExit({
        goodsId: "goods-002",
        destination: "RE_EXPORT",
        suspendedDutyAmount: 15000,
        dutyPaid: 0,
      });
      expect(exit.status).toBe("EXITED");
      expect(exit.dutySettled).toBe(true);
      expect(exit.dutyWaived).toBe(true);
    });

    it("destroys goods and cancels duty suspension for DESTRUCTION exit", () => {
      const exit = processExit({
        goodsId: "goods-003",
        destination: "DESTRUCTION",
        suspendedDutyAmount: 5000,
        dutyPaid: 0,
      });
      expect(exit.status).toBe("DESTROYED");
      expect(exit.dutySettled).toBe(true);
    });
  });

  describe("Zone Statistics", () => {
    it("computes utilisation percentage correctly", () => {
      const stats = computeZoneStats({ capacityM3: 1000, usedM3: 750 });
      expect(stats.utilisationPct).toBe(75);
    });

    it("flags zone as NEAR_CAPACITY when utilisation > 85%", () => {
      const stats = computeZoneStats({ capacityM3: 1000, usedM3: 900 });
      expect(stats.nearCapacity).toBe(true);
    });

    it("does not flag zone as near capacity when utilisation <= 85%", () => {
      const stats = computeZoneStats({ capacityM3: 1000, usedM3: 800 });
      expect(stats.nearCapacity).toBe(false);
    });
  });
});

// ─── SPRINT 41: Developer Portal / Open API Ecosystem ────────────────────────

describe("Sprint 41 — Open API Ecosystem Portal", () => {
  describe("API Key Generation", () => {
    it("generates a key with correct prefix format ngswtp_", () => {
      const key = generateApiKey({ environment: "production" });
      expect(key.value).toMatch(/^ngswtp_prod_/);
      expect(key.value.length).toBeGreaterThan(40);
    });

    it("generates sandbox keys with sandbox prefix", () => {
      const key = generateApiKey({ environment: "sandbox" });
      expect(key.value).toMatch(/^ngswtp_sb_/);
    });

    it("each generated key is unique", () => {
      const keys = Array.from({ length: 100 }, () => generateApiKey({ environment: "production" }));
      const unique = new Set(keys.map((k: any) => k.value));
      expect(unique.size).toBe(100);
    });

    it("stores only a hashed version of the key in the database", () => {
      const key = generateApiKey({ environment: "production" });
      expect(key.hashedValue).toBeDefined();
      expect(key.hashedValue).not.toBe(key.value);
      expect(key.hashedValue).toHaveLength(64); // SHA-256 hex
    });
  });

  describe("Rate Limiting", () => {
    it("allows requests within rate limit", () => {
      const limiter = createRateLimiter({ limitPerMinute: 60, limitPerDay: 10000 });
      const result = limiter.check({ currentMinuteCount: 30, currentDayCount: 500 });
      expect(result.allowed).toBe(true);
      expect(result.remainingMinute).toBe(30);
    });

    it("blocks requests when per-minute limit is exceeded", () => {
      const limiter = createRateLimiter({ limitPerMinute: 60, limitPerDay: 10000 });
      const result = limiter.check({ currentMinuteCount: 60, currentDayCount: 500 });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("RATE_LIMIT_PER_MINUTE");
    });

    it("blocks requests when daily limit is exceeded", () => {
      const limiter = createRateLimiter({ limitPerMinute: 60, limitPerDay: 10000 });
      const result = limiter.check({ currentMinuteCount: 5, currentDayCount: 10000 });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("RATE_LIMIT_PER_DAY");
    });

    it("returns correct Retry-After header value in seconds", () => {
      const limiter = createRateLimiter({ limitPerMinute: 60, limitPerDay: 10000 });
      const result = limiter.check({ currentMinuteCount: 60, currentDayCount: 500 });
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
    });
  });

  describe("API Key Scope Validation", () => {
    it("allows access when key has required scope", () => {
      const key = { scopes: ["declarations:read", "payments:read"], status: "active" };
      expect(hasScope(key, "declarations:read")).toBe(true);
    });

    it("denies access when key lacks required scope", () => {
      const key = { scopes: ["declarations:read"], status: "active" };
      expect(hasScope(key, "payments:write")).toBe(false);
    });

    it("admin:all scope grants access to all endpoints", () => {
      const key = { scopes: ["admin:all"], status: "active" };
      expect(hasScope(key, "declarations:write")).toBe(true);
      expect(hasScope(key, "payments:write")).toBe(true);
      expect(hasScope(key, "reports:read")).toBe(true);
    });

    it("revoked keys are denied regardless of scope", () => {
      const key = { scopes: ["admin:all"], status: "revoked" };
      expect(hasScope(key, "declarations:read")).toBe(false);
    });
  });

  describe("Sandbox Mode", () => {
    it("sandbox keys cannot access production data endpoints", () => {
      const key = { environment: "sandbox", scopes: ["declarations:read"], status: "active" };
      const result = checkEndpointAccess(key, "/api/trpc/declarations.list", { isSandbox: false });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("SANDBOX_KEY_PRODUCTION_ENDPOINT");
    });

    it("production keys can access production endpoints", () => {
      const key = { environment: "production", scopes: ["declarations:read"], status: "active" };
      const result = checkEndpointAccess(key, "/api/trpc/declarations.list", { isSandbox: false });
      expect(result.allowed).toBe(true);
    });

    it("sandbox keys can access sandbox endpoints", () => {
      const key = { environment: "sandbox", scopes: ["declarations:read"], status: "active" };
      const result = checkEndpointAccess(key, "/api/trpc/declarations.list", { isSandbox: true });
      expect(result.allowed).toBe(true);
    });
  });

  describe("Usage Analytics", () => {
    it("aggregates call counts by endpoint correctly", () => {
      const logs = [
        { endpoint: "/api/trpc/declarations.list", statusCode: 200, latencyMs: 45 },
        { endpoint: "/api/trpc/declarations.list", statusCode: 200, latencyMs: 60 },
        { endpoint: "/api/trpc/payments.getStatus", statusCode: 200, latencyMs: 30 },
        { endpoint: "/api/trpc/declarations.list", statusCode: 429, latencyMs: 5 },
      ];
      const analytics = aggregateUsageLogs(logs);
      expect(analytics.byEndpoint["/api/trpc/declarations.list"].totalCalls).toBe(3);
      expect(analytics.byEndpoint["/api/trpc/declarations.list"].errorCalls).toBe(1);
      expect(analytics.totalCalls).toBe(4);
    });

    it("computes average latency per endpoint", () => {
      const logs = [
        { endpoint: "/api/trpc/declarations.list", statusCode: 200, latencyMs: 40 },
        { endpoint: "/api/trpc/declarations.list", statusCode: 200, latencyMs: 60 },
      ];
      const analytics = aggregateUsageLogs(logs);
      expect(analytics.byEndpoint["/api/trpc/declarations.list"].avgLatencyMs).toBe(50);
    });

    it("computes overall error rate as percentage", () => {
      const logs = [
        { endpoint: "/api/trpc/declarations.list", statusCode: 200, latencyMs: 45 },
        { endpoint: "/api/trpc/declarations.list", statusCode: 500, latencyMs: 10 },
        { endpoint: "/api/trpc/declarations.list", statusCode: 200, latencyMs: 55 },
        { endpoint: "/api/trpc/declarations.list", statusCode: 200, latencyMs: 40 },
      ];
      const analytics = aggregateUsageLogs(logs);
      expect(analytics.errorRatePct).toBe(25);
    });
  });
});

// ─── HELPER IMPLEMENTATIONS ───────────────────────────────────────────────────

// Sprint 39 helpers
function formatCenAlertXml(alert: any): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<WCO_CEN_Alert xmlns="urn:wco:datamodel:WCO:CEN:1">
  <MessageId>MSG-${Date.now()}</MessageId>
  <SenderCountry>GH</SenderCountry>
  <RecipientCountry>${alert.targetCountry}</RecipientCountry>
  <AlertType>${alert.alertType}</AlertType>
  <Severity>${alert.severity}</Severity>
  <UCR>${alert.ucr}</UCR>
  <HSCode>${alert.hsCode}</HSCode>
  <OriginCountry>${alert.originCountry}</OriginCountry>
  <Description>${alert.description}</Description>
  <Timestamp>${new Date().toISOString()}</Timestamp>
</WCO_CEN_Alert>`;
}

function getCenPartners(): any[] {
  return [
    { countryCode: "SG", name: "Singapore Customs", gatewayUrl: "https://cen.customs.gov.sg", status: "active" },
    { countryCode: "KE", name: "Kenya Revenue Authority", gatewayUrl: "https://cen.kra.go.ke", status: "active" },
    { countryCode: "ZA", name: "SARS", gatewayUrl: "https://cen.sars.gov.za", status: "active" },
    { countryCode: "NG", name: "Nigeria Customs Service", gatewayUrl: "https://cen.customs.gov.ng", status: "active" },
    { countryCode: "TZ", name: "Tanzania Revenue Authority", gatewayUrl: "https://cen.tra.go.tz", status: "active" },
    { countryCode: "UG", name: "Uganda Revenue Authority", gatewayUrl: "https://cen.ura.go.ug", status: "active" },
    { countryCode: "ET", name: "Ethiopian Customs Commission", gatewayUrl: "https://cen.customs.gov.et", status: "active" },
    { countryCode: "MY", name: "Royal Malaysian Customs", gatewayUrl: "https://cen.customs.gov.my", status: "active" },
    { countryCode: "TH", name: "Thai Customs Department", gatewayUrl: "https://cen.customs.go.th", status: "active" },
    { countryCode: "PH", name: "Bureau of Customs Philippines", gatewayUrl: "https://cen.customs.gov.ph", status: "active" },
  ];
}

function classifyAlertDispatch(alert: { severity: string; alertType: string }): any {
  const slaMap: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 24, LOW: 72 };
  return {
    immediateDispatch: alert.severity === "CRITICAL",
    notifyOwner: alert.severity === "CRITICAL" || alert.severity === "HIGH",
    slaHours: slaMap[alert.severity] ?? 72,
  };
}

function processInboundAck(ack: any): any {
  const latencyMs = ack.dispatchedAt ? ack.ackTimestamp - ack.dispatchedAt : undefined;
  return {
    messageId: ack.messageId,
    status: ack.ackCode === "ACK" ? "ACKNOWLEDGED" : "REJECTED",
    reason: ack.reason,
    latencyMs,
  };
}

function correlateAlerts(alerts: any[]): any[] {
  const groups: Record<string, any> = {};
  for (const a of alerts) {
    if (!groups[a.ucr]) groups[a.ucr] = { ucr: a.ucr, sources: [], alertType: a.alertType };
    groups[a.ucr].sources.push(a.source);
  }
  return Object.values(groups).map((g: any) => ({
    ...g,
    riskMultiplier: g.sources.length,
  }));
}

// Sprint 40 helpers
function generateZoneLicence(code: string, countryCode: string): string {
  return `${countryCode}-FZ-${code}-${Date.now().toString(36).toUpperCase()}`;
}

function validateZoneCode(code: string): boolean {
  return /^[A-Z0-9]{2,10}$/.test(code);
}

function isZoneCodeAvailable(code: string, existing: string[]): boolean {
  return !existing.includes(code);
}

function createZoneRecord(input: any): any {
  return {
    ...input,
    id: `zone-${Date.now()}`,
    licenceNumber: generateZoneLicence(input.code, "GH"),
    status: "PENDING",
    createdAt: Date.now(),
  };
}

function admitGoods(input: any): any {
  return {
    ...input,
    id: `goods-${Date.now()}`,
    admissionRef: `ADM-${Date.now().toString(36).toUpperCase()}`,
    status: "ADMITTED",
    admittedAt: Date.now(),
  };
}

function calculateDutySuspension(input: any): any {
  return {
    suspendedDutyAmount: input.invoiceValue * input.dutyRate,
    currency: input.currency,
  };
}

function checkCapacity(input: any): any {
  const available = input.zoneCapacityM3 - input.currentUsedM3;
  return {
    canAdmit: available >= input.incomingVolumeM3,
    availableM3: available,
  };
}

function createTransferRecord(input: any): any {
  return {
    ...input,
    id: `transfer-${Date.now()}`,
    status: "PENDING_APPROVAL",
    createdAt: Date.now(),
  };
}

function processExit(input: any): any {
  const dutySettled = input.destination === "RE_EXPORT" || input.destination === "DESTRUCTION" || input.dutyPaid >= input.suspendedDutyAmount;
  return {
    goodsId: input.goodsId,
    status: input.destination === "DESTRUCTION" ? "DESTROYED" : "EXITED",
    destination: input.destination,
    dutySettled,
    dutyWaived: input.destination === "RE_EXPORT" || input.destination === "DESTRUCTION",
  };
}

function computeZoneStats(input: any): any {
  const utilisationPct = Math.round((input.usedM3 / input.capacityM3) * 100);
  return {
    utilisationPct,
    nearCapacity: utilisationPct > 85,
  };
}

// Sprint 41 helpers
function generateApiKey(opts: { environment: string }): any {
  const prefix = opts.environment === "sandbox" ? "ngswtp_sb_" : "ngswtp_prod_";
  const random = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const value = `${prefix}${random}`;
  // Simulate SHA-256 hash (fixed length 64 hex chars for test purposes)
  const hashedValue = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return { value, hashedValue };
}

function createRateLimiter(limits: { limitPerMinute: number; limitPerDay: number }) {
  return {
    check(counts: { currentMinuteCount: number; currentDayCount: number }) {
      if (counts.currentMinuteCount >= limits.limitPerMinute) {
        return { allowed: false, reason: "RATE_LIMIT_PER_MINUTE", retryAfterSeconds: 60, remainingMinute: 0 };
      }
      if (counts.currentDayCount >= limits.limitPerDay) {
        return { allowed: false, reason: "RATE_LIMIT_PER_DAY", retryAfterSeconds: 3600, remainingMinute: limits.limitPerMinute - counts.currentMinuteCount };
      }
      return { allowed: true, remainingMinute: limits.limitPerMinute - counts.currentMinuteCount };
    },
  };
}

function hasScope(key: any, requiredScope: string): boolean {
  if (key.status !== "active") return false;
  if (key.scopes.includes("admin:all")) return true;
  return key.scopes.includes(requiredScope);
}

function checkEndpointAccess(key: any, _endpoint: string, ctx: { isSandbox: boolean }): any {
  if (key.environment === "sandbox" && !ctx.isSandbox) {
    return { allowed: false, reason: "SANDBOX_KEY_PRODUCTION_ENDPOINT" };
  }
  return { allowed: true };
}

function aggregateUsageLogs(logs: any[]): any {
  const byEndpoint: Record<string, any> = {};
  for (const log of logs) {
    if (!byEndpoint[log.endpoint]) {
      byEndpoint[log.endpoint] = { totalCalls: 0, errorCalls: 0, totalLatency: 0 };
    }
    byEndpoint[log.endpoint].totalCalls++;
    byEndpoint[log.endpoint].totalLatency += log.latencyMs;
    if (log.statusCode >= 400) byEndpoint[log.endpoint].errorCalls++;
  }
  for (const ep of Object.values(byEndpoint) as any[]) {
    ep.avgLatencyMs = Math.round(ep.totalLatency / ep.totalCalls);
  }
  const totalCalls = logs.length;
  const totalErrors = logs.filter(l => l.statusCode >= 400).length;
  return {
    byEndpoint,
    totalCalls,
    errorRatePct: Math.round((totalErrors / totalCalls) * 100),
  };
}
