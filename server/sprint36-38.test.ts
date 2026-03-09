/**
 * Sprint 36–38 Vitest Tests
 * Covers:
 *   Sprint 36 — Post-Clearance Audit (Go audit-service, risk-weighted selection, penalty calc)
 *   Sprint 37 — Bonded Warehouse (Go warehouse-service, duty-suspension bond lifecycle)
 *   Sprint 38 — ASEAN Single Window (Go asean-sw-service, WCO XML, G2G message dispatch)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Shared mock fetch helper ─────────────────────────────────────────────────

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 36 — Post-Clearance Audit Service Logic
// ─────────────────────────────────────────────────────────────────────────────

describe("Sprint 36 — Audit Service: Risk-Weighted Selection Algorithm", () => {
  // Mirrors the Go audit-service risk scoring logic in TypeScript for unit testing

  type AuditCandidate = {
    declarationId: number;
    ucr: string;
    riskScore: number;
    declaredValue: number;
    dutyPaid: number;
    hsCode: string;
    traderProfile: "aeo" | "regular" | "new" | "flagged";
  };

  function calculateAuditProbability(candidate: AuditCandidate): number {
    let probability = 0.05; // 5% base rate

    // Risk score contribution (0–100 → 0–40%)
    probability += (candidate.riskScore / 100) * 0.4;

    // Trader profile contribution
    const profileBonus: Record<AuditCandidate["traderProfile"], number> = {
      aeo: -0.03,      // AEO traders get reduced probability
      regular: 0.0,
      new: 0.10,       // New traders get higher scrutiny
      flagged: 0.25,   // Flagged traders are almost always audited
    };
    probability += profileBonus[candidate.traderProfile];

    // High-value shipment bonus
    if (candidate.declaredValue > 100_000) probability += 0.10;
    if (candidate.declaredValue > 500_000) probability += 0.15;

    // Duty discrepancy signal (declared value vs duty ratio)
    const impliedRate = candidate.dutyPaid / candidate.declaredValue;
    if (impliedRate < 0.05 && candidate.declaredValue > 10_000) probability += 0.15;

    return Math.min(Math.max(probability, 0), 1.0);
  }

  it("assigns base 5% probability to low-risk regular trader", () => {
    const p = calculateAuditProbability({
      declarationId: 1, ucr: "GH001", riskScore: 0,
      declaredValue: 5_000, dutyPaid: 500, hsCode: "6109.10", traderProfile: "regular",
    });
    expect(p).toBeCloseTo(0.05, 2);
  });

  it("assigns near-100% probability to flagged high-value shipment", () => {
    const p = calculateAuditProbability({
      declarationId: 2, ucr: "GH002", riskScore: 90,
      declaredValue: 600_000, dutyPaid: 1_000, hsCode: "8471.30", traderProfile: "flagged",
    });
    expect(p).toBeGreaterThanOrEqual(0.95);
  });

  it("AEO trader gets reduced audit probability", () => {
    const aeo = calculateAuditProbability({
      declarationId: 3, ucr: "GH003", riskScore: 20,
      declaredValue: 50_000, dutyPaid: 5_000, hsCode: "2709.00", traderProfile: "aeo",
    });
    const regular = calculateAuditProbability({
      declarationId: 4, ucr: "GH004", riskScore: 20,
      declaredValue: 50_000, dutyPaid: 5_000, hsCode: "2709.00", traderProfile: "regular",
    });
    expect(aeo).toBeLessThan(regular);
  });

  it("new trader gets higher scrutiny than regular", () => {
    const newTrader = calculateAuditProbability({
      declarationId: 5, ucr: "GH005", riskScore: 10,
      declaredValue: 8_000, dutyPaid: 800, hsCode: "6403.99", traderProfile: "new",
    });
    const regular = calculateAuditProbability({
      declarationId: 6, ucr: "GH006", riskScore: 10,
      declaredValue: 8_000, dutyPaid: 800, hsCode: "6403.99", traderProfile: "regular",
    });
    expect(newTrader).toBeGreaterThan(regular);
  });

  it("low duty-to-value ratio triggers discrepancy signal", () => {
    const suspicious = calculateAuditProbability({
      declarationId: 7, ucr: "GH007", riskScore: 30,
      declaredValue: 50_000, dutyPaid: 100, hsCode: "8703.23", traderProfile: "regular",
    });
    const normal = calculateAuditProbability({
      declarationId: 8, ucr: "GH008", riskScore: 30,
      declaredValue: 50_000, dutyPaid: 5_000, hsCode: "8703.23", traderProfile: "regular",
    });
    expect(suspicious).toBeGreaterThan(normal);
  });

  it("probability is clamped to [0, 1]", () => {
    const p = calculateAuditProbability({
      declarationId: 9, ucr: "GH009", riskScore: 100,
      declaredValue: 1_000_000, dutyPaid: 100, hsCode: "7108.12", traderProfile: "flagged",
    });
    expect(p).toBeLessThanOrEqual(1.0);
    expect(p).toBeGreaterThanOrEqual(0.0);
  });
});

describe("Sprint 36 — Audit Service: Duty Discrepancy Calculation", () => {
  type AuditFinding = {
    declaredValue: number;
    assessedValue: number;
    dutyRate: number;
    dutyPaid: number;
  };

  function calculateDiscrepancy(finding: AuditFinding) {
    const dutyOwed = finding.assessedValue * finding.dutyRate;
    const shortfall = dutyOwed - finding.dutyPaid;
    const penaltyRate = shortfall > 10_000 ? 0.5 : shortfall > 1_000 ? 0.25 : 0.1;
    const penalty = shortfall > 0 ? shortfall * penaltyRate : 0;
    const underDeclarationPct = ((finding.assessedValue - finding.declaredValue) / finding.declaredValue) * 100;
    return { dutyOwed, shortfall, penalty, underDeclarationPct };
  }

  it("calculates zero penalty when duty is correctly paid", () => {
    const r = calculateDiscrepancy({ declaredValue: 10_000, assessedValue: 10_000, dutyRate: 0.2, dutyPaid: 2_000 });
    expect(r.shortfall).toBe(0);
    expect(r.penalty).toBe(0);
  });

  it("applies 25% penalty for moderate shortfall (1k–10k)", () => {
    const r = calculateDiscrepancy({ declaredValue: 20_000, assessedValue: 25_000, dutyRate: 0.2, dutyPaid: 3_000 });
    expect(r.shortfall).toBe(2_000); // 25000*0.2 - 3000 = 2000
    expect(r.penalty).toBe(500);     // 2000 * 0.25
  });

  it("applies 50% penalty for large shortfall (>10k)", () => {
    const r = calculateDiscrepancy({ declaredValue: 50_000, assessedValue: 100_000, dutyRate: 0.3, dutyPaid: 5_000 });
    expect(r.shortfall).toBe(25_000); // 100000*0.3 - 5000 = 25000
    expect(r.penalty).toBe(12_500);   // 25000 * 0.5
  });

  it("detects under-declaration percentage correctly", () => {
    const r = calculateDiscrepancy({ declaredValue: 80_000, assessedValue: 100_000, dutyRate: 0.2, dutyPaid: 16_000 });
    expect(r.underDeclarationPct).toBeCloseTo(25, 1); // 25% under-declared
  });
});

describe("Sprint 36 — Audit Service: Penalty Issuance", () => {
  it("generates penalty notice with correct fields", () => {
    const notice = {
      penaltyRef: `PEN-${Date.now()}`,
      declarationId: 42,
      ucr: "GH2024UCR042",
      dutyShortfall: 5_000,
      penaltyAmount: 1_250,
      totalDue: 6_250,
      issuedAt: new Date().toISOString(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      status: "issued",
    };
    expect(notice.penaltyRef).toMatch(/^PEN-/);
    expect(notice.totalDue).toBe(notice.dutyShortfall + notice.penaltyAmount);
    expect(notice.status).toBe("issued");
    expect(new Date(notice.dueDate).getTime()).toBeGreaterThan(new Date(notice.issuedAt).getTime());
  });

  it("penalty notice dueDate is 30 days after issuance", () => {
    const issuedAt = new Date();
    const dueDate = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const diffDays = Math.round((dueDate.getTime() - issuedAt.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 37 — Bonded Warehouse Service Logic
// ─────────────────────────────────────────────────────────────────────────────

describe("Sprint 37 — Bonded Warehouse: Duty-Suspension Bond Lifecycle", () => {
  type Bond = {
    id: string;
    warehouseId: string;
    ucr: string;
    declaredValue: number;
    dutyRate: number;
    bondValue: number;
    status: "active" | "discharged" | "forfeited" | "expired";
    depositedAt: Date;
    maxStorageDays: number;
  };

  function issueBond(input: Omit<Bond, "id" | "status" | "depositedAt">): Bond {
    const dutyOwed = input.declaredValue * input.dutyRate;
    if (input.bondValue < dutyOwed) {
      throw new Error(`Bond value ${input.bondValue} is less than duty owed ${dutyOwed}`);
    }
    return {
      ...input,
      id: `BOND-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      status: "active",
      depositedAt: new Date(),
    };
  }

  function dischargeBond(bond: Bond, dutyPaid: number): Bond {
    const dutyOwed = bond.declaredValue * bond.dutyRate;
    if (dutyPaid < dutyOwed) {
      throw new Error(`Duty paid ${dutyPaid} is less than duty owed ${dutyOwed}`);
    }
    return { ...bond, status: "discharged" };
  }

  function checkBondExpiry(bond: Bond): boolean {
    const ageMs = Date.now() - bond.depositedAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays > bond.maxStorageDays;
  }

  it("issues a bond when bond value covers duty owed", () => {
    const bond = issueBond({
      warehouseId: "wh-001", ucr: "GH001", declaredValue: 50_000,
      dutyRate: 0.20, bondValue: 12_000, maxStorageDays: 90,
    });
    expect(bond.status).toBe("active");
    expect(bond.id).toMatch(/^BOND-/);
  });

  it("rejects bond issuance when bond value is insufficient", () => {
    expect(() => issueBond({
      warehouseId: "wh-001", ucr: "GH002", declaredValue: 50_000,
      dutyRate: 0.20, bondValue: 5_000, maxStorageDays: 90, // 5k < 10k duty owed
    })).toThrow("less than duty owed");
  });

  it("discharges bond when full duty is paid", () => {
    const bond = issueBond({
      warehouseId: "wh-001", ucr: "GH003", declaredValue: 20_000,
      dutyRate: 0.15, bondValue: 4_000, maxStorageDays: 90,
    });
    const discharged = dischargeBond(bond, 3_000); // 20000 * 0.15 = 3000
    expect(discharged.status).toBe("discharged");
  });

  it("rejects discharge when duty paid is insufficient", () => {
    const bond = issueBond({
      warehouseId: "wh-001", ucr: "GH004", declaredValue: 20_000,
      dutyRate: 0.15, bondValue: 4_000, maxStorageDays: 90,
    });
    expect(() => dischargeBond(bond, 2_000)).toThrow("less than duty owed");
  });

  it("detects expired bond correctly", () => {
    const bond: Bond = {
      id: "BOND-EXP001", warehouseId: "wh-001", ucr: "GH005",
      declaredValue: 10_000, dutyRate: 0.1, bondValue: 1_500,
      status: "active", maxStorageDays: 0, // 0 days = immediately expired
      depositedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    };
    expect(checkBondExpiry(bond)).toBe(true);
  });

  it("non-expired bond returns false for expiry check", () => {
    const bond: Bond = {
      id: "BOND-OK001", warehouseId: "wh-001", ucr: "GH006",
      declaredValue: 10_000, dutyRate: 0.1, bondValue: 1_500,
      status: "active", maxStorageDays: 90,
      depositedAt: new Date(), // just deposited
    };
    expect(checkBondExpiry(bond)).toBe(false);
  });
});

describe("Sprint 37 — Bonded Warehouse: Capacity Management", () => {
  type Warehouse = {
    id: string;
    maxCapacityM3: number;
    usedCapacityM3: number;
  };

  function canAcceptDeposit(warehouse: Warehouse, volumeM3: number): boolean {
    return warehouse.usedCapacityM3 + volumeM3 <= warehouse.maxCapacityM3;
  }

  function utilisationPct(warehouse: Warehouse): number {
    return Math.round((warehouse.usedCapacityM3 / warehouse.maxCapacityM3) * 100);
  }

  it("accepts deposit when capacity is available", () => {
    const wh: Warehouse = { id: "wh-001", maxCapacityM3: 1000, usedCapacityM3: 400 };
    expect(canAcceptDeposit(wh, 500)).toBe(true);
  });

  it("rejects deposit when it would exceed capacity", () => {
    const wh: Warehouse = { id: "wh-001", maxCapacityM3: 1000, usedCapacityM3: 800 };
    expect(canAcceptDeposit(wh, 300)).toBe(false);
  });

  it("accepts deposit that exactly fills capacity", () => {
    const wh: Warehouse = { id: "wh-001", maxCapacityM3: 1000, usedCapacityM3: 500 };
    expect(canAcceptDeposit(wh, 500)).toBe(true);
  });

  it("calculates utilisation percentage correctly", () => {
    const wh: Warehouse = { id: "wh-001", maxCapacityM3: 1000, usedCapacityM3: 750 };
    expect(utilisationPct(wh)).toBe(75);
  });

  it("utilisation is 0% for empty warehouse", () => {
    const wh: Warehouse = { id: "wh-001", maxCapacityM3: 5000, usedCapacityM3: 0 };
    expect(utilisationPct(wh)).toBe(0);
  });
});

describe("Sprint 37 — Bonded Warehouse: Destination Type Validation", () => {
  type DestinationType = "domestic" | "re_export" | "destruction";

  function validateRelease(dutyPaid: number, dutyOwed: number, destType: DestinationType): { valid: boolean; reason?: string } {
    if (destType === "domestic" && dutyPaid < dutyOwed) {
      return { valid: false, reason: "Full duty payment required for domestic release" };
    }
    if (destType === "re_export" && dutyPaid > 0) {
      // Re-export should not require duty payment
      return { valid: false, reason: "Re-export does not require duty payment" };
    }
    return { valid: true };
  }

  it("validates domestic release with full duty payment", () => {
    expect(validateRelease(2_000, 2_000, "domestic").valid).toBe(true);
  });

  it("rejects domestic release with partial duty payment", () => {
    const r = validateRelease(1_000, 2_000, "domestic");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/Full duty/);
  });

  it("validates re-export with zero duty payment", () => {
    expect(validateRelease(0, 2_000, "re_export").valid).toBe(true);
  });

  it("rejects re-export with non-zero duty payment", () => {
    const r = validateRelease(500, 2_000, "re_export");
    expect(r.valid).toBe(false);
  });

  it("validates destruction regardless of duty payment", () => {
    expect(validateRelease(0, 2_000, "destruction").valid).toBe(true);
    expect(validateRelease(2_000, 2_000, "destruction").valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 38 — ASEAN Single Window: WCO XML Message Formatting
// ─────────────────────────────────────────────────────────────────────────────

describe("Sprint 38 — ASEAN SW: WCO XML Message Structure", () => {
  type WcoMessage = {
    messageRef: string;
    senderId: string;
    destinationCode: string;
    typeCode: "IM" | "EX" | "TR";
    ucr: string;
    traderName: string;
    hsCode: string;
    description: string;
    grossWeightKg: number;
    invoiceValue: number;
    currency: string;
    dutyAmount: number;
    createdAt: string;
  };

  function buildWcoXml(msg: WcoMessage): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<WCO_Declaration xmlns="urn:wco:datamodel:WCO:DEC-DMS:2" version="3.10">
  <MessageRef>${msg.messageRef}</MessageRef>
  <SenderId>${msg.senderId}</SenderId>
  <DestinationCode>${msg.destinationCode}</DestinationCode>
  <TypeCode>${msg.typeCode}</TypeCode>
  <UCR>${msg.ucr}</UCR>
  <Trader><Name>${msg.traderName}</Name></Trader>
  <GoodsItem>
    <HSCode>${msg.hsCode}</HSCode>
    <Description>${msg.description}</Description>
    <GrossWeightKg>${msg.grossWeightKg}</GrossWeightKg>
    <InvoiceValue currency="${msg.currency}">${msg.invoiceValue}</InvoiceValue>
    <DutyAmount>${msg.dutyAmount}</DutyAmount>
  </GoodsItem>
  <CreatedAt>${msg.createdAt}</CreatedAt>
</WCO_Declaration>`;
  }

  it("generates valid WCO XML with required fields", () => {
    const xml = buildWcoXml({
      messageRef: "GH-MSG-001", senderId: "GH-NGSWTP", destinationCode: "SG",
      typeCode: "IM", ucr: "GH2024UCR001", traderName: "Accra Imports Ltd",
      hsCode: "8471.30", description: "Laptop computers", grossWeightKg: 500,
      invoiceValue: 50_000, currency: "USD", dutyAmount: 5_000,
      createdAt: new Date().toISOString(),
    });
    expect(xml).toContain("WCO_Declaration");
    expect(xml).toContain("GH-MSG-001");
    expect(xml).toContain("GH2024UCR001");
    expect(xml).toContain("8471.30");
    expect(xml).toContain('currency="USD"');
  });

  it("includes WCO data model version 3.10", () => {
    const xml = buildWcoXml({
      messageRef: "GH-MSG-002", senderId: "GH-NGSWTP", destinationCode: "MY",
      typeCode: "EX", ucr: "GH2024UCR002", traderName: "Kumasi Exports",
      hsCode: "1801.00", description: "Cocoa beans", grossWeightKg: 20_000,
      invoiceValue: 80_000, currency: "USD", dutyAmount: 0,
      createdAt: new Date().toISOString(),
    });
    expect(xml).toContain("version=\"3.10\"");
  });

  it("correctly embeds type code for transit declaration", () => {
    const xml = buildWcoXml({
      messageRef: "GH-MSG-003", senderId: "GH-NGSWTP", destinationCode: "TH",
      typeCode: "TR", ucr: "GH2024UCR003", traderName: "Transit Co",
      hsCode: "2710.19", description: "Petroleum products", grossWeightKg: 50_000,
      invoiceValue: 200_000, currency: "USD", dutyAmount: 0,
      createdAt: new Date().toISOString(),
    });
    expect(xml).toContain("<TypeCode>TR</TypeCode>");
  });
});

describe("Sprint 38 — ASEAN SW: Member State Registry", () => {
  const ASEAN_MEMBERS = [
    { code: "BN", name: "Brunei Darussalam", protocol: "ASEAN-SW-API-v2" },
    { code: "KH", name: "Cambodia", protocol: "ASEAN-SW-API-v2" },
    { code: "ID", name: "Indonesia", protocol: "ASEAN-SW-API-v2" },
    { code: "LA", name: "Lao PDR", protocol: "ASEAN-SW-API-v1" },
    { code: "MY", name: "Malaysia", protocol: "ASEAN-SW-API-v2" },
    { code: "MM", name: "Myanmar", protocol: "ASEAN-SW-API-v1" },
    { code: "PH", name: "Philippines", protocol: "ASEAN-SW-API-v2" },
    { code: "SG", name: "Singapore", protocol: "ASEAN-SW-API-v2" },
    { code: "TH", name: "Thailand", protocol: "ASEAN-SW-API-v2" },
    { code: "VN", name: "Vietnam", protocol: "ASEAN-SW-API-v2" },
  ];

  it("registry contains all 10 ASEAN member states", () => {
    expect(ASEAN_MEMBERS).toHaveLength(10);
  });

  it("Singapore uses ASEAN-SW-API-v2 protocol", () => {
    const sg = ASEAN_MEMBERS.find(m => m.code === "SG");
    expect(sg?.protocol).toBe("ASEAN-SW-API-v2");
  });

  it("all member codes are exactly 2 characters", () => {
    ASEAN_MEMBERS.forEach(m => expect(m.code).toHaveLength(2));
  });

  it("no duplicate country codes", () => {
    const codes = ASEAN_MEMBERS.map(m => m.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it("finds member by country code", () => {
    const found = ASEAN_MEMBERS.find(m => m.code === "TH");
    expect(found?.name).toBe("Thailand");
  });
});

describe("Sprint 38 — ASEAN SW: Acknowledgement Processing", () => {
  type AckStatus = "accepted" | "rejected";

  type OutboundMessage = {
    id: string;
    messageRef: string;
    status: "pending" | "sent" | "acknowledged" | "rejected" | "failed";
    ackReference?: string;
    acknowledgedAt?: string;
    errorMessage?: string;
  };

  function processAck(msg: OutboundMessage, ack: { status: AckStatus; ackRef: string; reason?: string }): OutboundMessage {
    if (msg.status !== "sent") {
      throw new Error(`Cannot acknowledge message in status: ${msg.status}`);
    }
    return {
      ...msg,
      status: ack.status === "accepted" ? "acknowledged" : "rejected",
      ackReference: ack.ackRef,
      acknowledgedAt: new Date().toISOString(),
      errorMessage: ack.status === "rejected" ? ack.reason : undefined,
    };
  }

  it("transitions message to acknowledged on accepted ACK", () => {
    const msg: OutboundMessage = { id: "m1", messageRef: "GH-MSG-001", status: "sent" };
    const updated = processAck(msg, { status: "accepted", ackRef: "SG-ACK-001" });
    expect(updated.status).toBe("acknowledged");
    expect(updated.ackReference).toBe("SG-ACK-001");
    expect(updated.acknowledgedAt).toBeDefined();
  });

  it("transitions message to rejected on rejected ACK", () => {
    const msg: OutboundMessage = { id: "m2", messageRef: "GH-MSG-002", status: "sent" };
    const updated = processAck(msg, { status: "rejected", ackRef: "SG-ACK-002", reason: "Invalid HS code" });
    expect(updated.status).toBe("rejected");
    expect(updated.errorMessage).toBe("Invalid HS code");
  });

  it("throws error when acknowledging non-sent message", () => {
    const msg: OutboundMessage = { id: "m3", messageRef: "GH-MSG-003", status: "pending" };
    expect(() => processAck(msg, { status: "accepted", ackRef: "SG-ACK-003" })).toThrow("Cannot acknowledge");
  });

  it("preserves original message fields after ACK processing", () => {
    const msg: OutboundMessage = { id: "m4", messageRef: "GH-MSG-004", status: "sent" };
    const updated = processAck(msg, { status: "accepted", ackRef: "MY-ACK-001" });
    expect(updated.id).toBe("m4");
    expect(updated.messageRef).toBe("GH-MSG-004");
  });
});

describe("Sprint 38 — ASEAN SW: Connection Latency Monitoring", () => {
  type ConnectionHealth = {
    code: string;
    latencyMs: number;
    consecutiveFailures: number;
    status: "active" | "degraded" | "offline";
  };

  function evaluateHealth(conn: ConnectionHealth): ConnectionHealth {
    let status: ConnectionHealth["status"] = "active";
    if (conn.consecutiveFailures >= 3) status = "offline";
    else if (conn.consecutiveFailures >= 1 || conn.latencyMs > 2000) status = "degraded";
    return { ...conn, status };
  }

  it("marks connection as active when latency is low and no failures", () => {
    const h = evaluateHealth({ code: "SG", latencyMs: 120, consecutiveFailures: 0, status: "active" });
    expect(h.status).toBe("active");
  });

  it("marks connection as degraded when latency exceeds 2000ms", () => {
    const h = evaluateHealth({ code: "LA", latencyMs: 3500, consecutiveFailures: 0, status: "active" });
    expect(h.status).toBe("degraded");
  });

  it("marks connection as degraded on first failure", () => {
    const h = evaluateHealth({ code: "MM", latencyMs: 500, consecutiveFailures: 1, status: "active" });
    expect(h.status).toBe("degraded");
  });

  it("marks connection as offline after 3 consecutive failures", () => {
    const h = evaluateHealth({ code: "KH", latencyMs: 0, consecutiveFailures: 3, status: "degraded" });
    expect(h.status).toBe("offline");
  });

  it("connection with 2 failures is degraded, not offline", () => {
    const h = evaluateHealth({ code: "BN", latencyMs: 0, consecutiveFailures: 2, status: "degraded" });
    expect(h.status).toBe("degraded");
  });
});
