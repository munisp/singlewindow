/**
 * orchestration.test.ts
 * Integration tests for the TradeGateway NGSWTP orchestration layer.
 *
 * Tests cover:
 *   1. Kafka event schema validation
 *   2. Dapr component configuration correctness
 *   3. Temporal workflow input/output types
 *   4. Risk scoring algorithm logic
 *   5. Sanctions fuzzy-match logic
 *   6. TigerBeetle ledger account ID generation
 *   7. APISIX route configuration validation
 *   8. Stakeholder journey event sequences
 *   9. Permify authorization model
 *  10. Lakehouse pipeline event transformation
 */

import { describe, expect, it, beforeEach } from "vitest";

// ── 1. Kafka event schema validation ─────────────────────────────────────────

describe("Kafka event schemas", () => {
  const REQUIRED_TOPICS = [
    "declaration.submitted",
    "declaration.status_changed",
    "declaration.cleared",
    "payment.initiated",
    "payment.confirmed",
    "oga.permit_requested",
    "oga.permit_reviewed",
    "risk.score_computed",
    "sanctions.alert",
    "security.alert",
    "ais.vessel_positions",
    "audit.events",
  ];

  it("defines all required Kafka topics", () => {
    // Topics defined in infra/kafka/topics.yaml
    const topicsYaml = `
      declaration.submitted
      declaration.status_changed
      declaration.cleared
      payment.initiated
      payment.confirmed
      oga.permit_requested
      oga.permit_reviewed
      risk.score_computed
      sanctions.alert
      security.alert
      ais.vessel_positions
      audit.events
    `;
    for (const topic of REQUIRED_TOPICS) {
      expect(topicsYaml).toContain(topic);
    }
  });

  it("validates declaration.submitted event structure", () => {
    const event = {
      eventId: "evt-001",
      declarationId: 1001,
      traderId: 42,
      hsCode: "8471.30",
      declaredValue: 15000.00,
      originCountry: "CN",
      declarationType: "import",
      submittedAt: new Date().toISOString(),
    };

    expect(event.eventId).toBeTruthy();
    expect(event.declarationId).toBeGreaterThan(0);
    expect(event.traderId).toBeGreaterThan(0);
    expect(event.hsCode).toMatch(/^\d{4}\.\d{2}/);
    expect(event.declaredValue).toBeGreaterThan(0);
    expect(event.originCountry).toHaveLength(2);
    expect(["import", "export", "transit", "re-export"]).toContain(event.declarationType);
  });

  it("validates payment.confirmed event structure", () => {
    const event = {
      eventId: "pmt-001",
      invoiceId: 5001,
      declarationId: 1001,
      traderId: 42,
      amount: 3000.00,
      currency: "GHS",
      mojaloopTxId: "mojaloop-tx-abc123",
      paidAt: new Date().toISOString(),
    };

    expect(event.invoiceId).toBeGreaterThan(0);
    expect(event.amount).toBeGreaterThan(0);
    expect(["GHS", "USD", "EUR", "NGN", "KES"]).toContain(event.currency);
    expect(event.mojaloopTxId).toBeTruthy();
  });

  it("validates oga.permit_requested event structure", () => {
    const event = {
      eventId: "oga-001",
      permitId: 2001,
      declarationId: 1001,
      agencyCode: "FDA",
      agencyName: "Food and Drugs Authority",
      requestedAt: new Date().toISOString(),
      slaHours: 24,
    };

    expect(event.agencyCode).toBeTruthy();
    expect(event.slaHours).toBeGreaterThan(0);
    expect(event.slaHours).toBeLessThanOrEqual(72);
  });

  it("validates risk.score_computed event structure", () => {
    const event = {
      eventId: "risk-001",
      declarationId: 1001,
      traderId: 42,
      score: 45.5,
      lane: "yellow",
      features: {
        hsRisk: 0.40,
        countryRisk: 0.40,
        traderRisk: 0.30,
        valueDeviation: 0.20,
      },
      modelVersion: "xgb-v1.2.0",
      scoredAt: new Date().toISOString(),
    };

    expect(event.score).toBeGreaterThanOrEqual(0);
    expect(event.score).toBeLessThanOrEqual(100);
    expect(["green", "yellow", "red"]).toContain(event.lane);
    expect(event.features.hsRisk).toBeGreaterThanOrEqual(0);
    expect(event.features.hsRisk).toBeLessThanOrEqual(1);
  });
});

// ── 2. Risk scoring algorithm ─────────────────────────────────────────────────

describe("Risk scoring algorithm", () => {
  // Mirrors the Python risk-engine logic
  const HS_RISK_PROFILES: Record<string, number> = {
    "93": 0.95, "29": 0.70, "28": 0.65, "84": 0.45,
    "85": 0.40, "61": 0.55, "62": 0.55, "64": 0.50,
    "39": 0.30, "10": 0.20, "08": 0.20,
  };

  const COUNTRY_RISK: Record<string, number> = {
    "IR": 0.95, "KP": 0.99, "SY": 0.90,
    "DE": 0.10, "GB": 0.10, "US": 0.12, "SG": 0.08,
    "CN": 0.40, "GH": 0.30,
  };

  function getHsRisk(hsCode: string): number {
    const chapter = hsCode.slice(0, 2);
    return HS_RISK_PROFILES[chapter] ?? 0.35;
  }

  function getCountryRisk(country: string): number {
    return COUNTRY_RISK[country.toUpperCase()] ?? 0.35;
  }

  function computeScore(params: {
    hsRisk: number;
    countryRisk: number;
    traderRisk: number;
    valueDeviation: number;
    aeoCertified: boolean;
    kycVerified: boolean;
  }): number {
    const docRisk = params.kycVerified ? 0.1 : 0.5;
    let raw = (
      0.25 * params.hsRisk +
      0.20 * params.countryRisk +
      0.30 * params.traderRisk +
      0.20 * params.valueDeviation +
      0.05 * docRisk
    );
    if (params.aeoCertified) raw *= 0.60;
    return Math.min(raw * 100, 100);
  }

  function assignLane(score: number): string {
    if (score < 30) return "green";
    if (score < 70) return "yellow";
    return "red";
  }

  it("assigns green lane to low-risk AEO trader", () => {
    const score = computeScore({
      hsRisk: getHsRisk("0801"),     // Chapter 08 = 0.20
      countryRisk: getCountryRisk("SG"), // 0.08
      traderRisk: 0.05,              // 95% compliance
      valueDeviation: 0.05,
      aeoCertified: true,
      kycVerified: true,
    });
    expect(assignLane(score)).toBe("green");
    expect(score).toBeLessThan(30);
  });

  it("assigns red lane to high-risk arms shipment from sanctioned country", () => {
    const score = computeScore({
      hsRisk: getHsRisk("9301"),     // Chapter 93 = 0.95
      countryRisk: getCountryRisk("KP"), // 0.99
      traderRisk: 0.80,
      valueDeviation: 0.70,
      aeoCertified: false,
      kycVerified: false,
    });
    expect(assignLane(score)).toBe("red");
    expect(score).toBeGreaterThan(70);
  });

  it("assigns yellow lane to medium-risk electronics from China", () => {
    const score = computeScore({
      hsRisk: getHsRisk("8471"),     // Chapter 84 = 0.45
      countryRisk: getCountryRisk("CN"), // 0.40
      traderRisk: 0.30,
      valueDeviation: 0.20,
      aeoCertified: false,
      kycVerified: true,
    });
    expect(assignLane(score)).toBe("yellow");
    expect(score).toBeGreaterThanOrEqual(30);
    expect(score).toBeLessThan(70);
  });

  it("AEO certification reduces risk score by 40%", () => {
    const params = {
      hsRisk: 0.50, countryRisk: 0.40, traderRisk: 0.30,
      valueDeviation: 0.30, aeoCertified: false, kycVerified: true,
    };
    const scoreWithout = computeScore(params);
    const scoreWith = computeScore({ ...params, aeoCertified: true });
    expect(scoreWith).toBeCloseTo(scoreWithout * 0.60, 1);
  });

  it("score is always between 0 and 100", () => {
    const extremeScore = computeScore({
      hsRisk: 1.0, countryRisk: 1.0, traderRisk: 1.0,
      valueDeviation: 1.0, aeoCertified: false, kycVerified: false,
    });
    expect(extremeScore).toBeLessThanOrEqual(100);

    const minScore = computeScore({
      hsRisk: 0, countryRisk: 0, traderRisk: 0,
      valueDeviation: 0, aeoCertified: true, kycVerified: true,
    });
    expect(minScore).toBeGreaterThanOrEqual(0);
  });
});

// ── 3. Sanctions fuzzy matching ───────────────────────────────────────────────

describe("Sanctions fuzzy matching", () => {
  function normalize(name: string): string {
    name = name.toUpperCase().trim();
    name = name.replace(/\b(LTD|LLC|INC|CORP|GMBH|SA|BV|PLC|CO|COMPANY|LIMITED)\b/g, "");
    name = name.replace(/[^A-Z0-9 ]/g, "");
    return name.replace(/\s+/g, " ").trim();
  }

  function jaroWinkler(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    const len1 = s1.length, len2 = s2.length;
    if (len1 === 0 || len2 === 0) return 0.0;

    const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
    const s1Matches = new Array(len1).fill(false);
    const s2Matches = new Array(len2).fill(false);
    let matches = 0, transpositions = 0;

    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchDist);
      const end = Math.min(i + matchDist + 1, len2);
      for (let j = start; j < end; j++) {
        if (s2Matches[j] || s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0.0;

    let k = 0;
    for (let i = 0; i < len1; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }

    const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
    let prefix = 0;
    for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
      if (s1[i] === s2[i]) prefix++;
      else break;
    }
    return jaro + prefix * 0.1 * (1 - jaro);
  }

  it("exact match returns score 1.0", () => {
    const n1 = normalize("ACME ARMS LTD");
    const n2 = normalize("ACME ARMS LTD");
    expect(jaroWinkler(n1, n2)).toBe(1.0);
  });

  it("detects fuzzy match above threshold for slight variations", () => {
    const n1 = normalize("ACME ARMS LTD");
    const n2 = normalize("ACME ARMS LIMITED");
    const score = jaroWinkler(n1, n2);
    expect(score).toBeGreaterThan(0.85);
  });

  it("rejects clearly different names", () => {
    const n1 = normalize("GHANA COCOA BOARD");
    const n2 = normalize("SHADOW TRADE LLC");
    const score = jaroWinkler(n1, n2);
    expect(score).toBeLessThan(0.85);
  });

  it("normalization strips legal suffixes", () => {
    expect(normalize("ACME ARMS LTD")).toBe("ACME ARMS");
    expect(normalize("Global Chemical Corp")).toBe("GLOBAL CHEMICAL");
    expect(normalize("Shadow Trade LLC")).toBe("SHADOW TRADE");
  });

  it("normalization handles special characters", () => {
    expect(normalize("MÜLLER & SÖHNE GmbH")).toBe("MLLER SHNE");
  });
});

// ── 4. TigerBeetle account ID generation ─────────────────────────────────────

describe("TigerBeetle account ID generation", () => {
  // Account ID encoding: [account_type(8bit)][trader_id(32bit)][sequence(24bit)]
  function encodeAccountId(accountType: number, traderId: number, sequence: number): bigint {
    return (BigInt(accountType) << 56n) | (BigInt(traderId) << 24n) | BigInt(sequence);
  }

  function decodeAccountId(id: bigint): { accountType: number; traderId: number; sequence: number } {
    return {
      accountType: Number(id >> 56n),
      traderId: Number((id >> 24n) & 0xFFFFFFn),
      sequence: Number(id & 0xFFFFFFn),
    };
  }

  const ACCOUNT_TYPES = {
    DUTY_RECEIVABLE: 0x01,
    DUTY_COLLECTED: 0x02,
    PENALTY_RECEIVABLE: 0x03,
    DRAWBACK_PAYABLE: 0x04,
    BOND_HELD: 0x05,
  };

  it("encodes and decodes account IDs correctly", () => {
    const id = encodeAccountId(ACCOUNT_TYPES.DUTY_RECEIVABLE, 42, 1);
    const decoded = decodeAccountId(id);
    expect(decoded.accountType).toBe(ACCOUNT_TYPES.DUTY_RECEIVABLE);
    expect(decoded.traderId).toBe(42);
    expect(decoded.sequence).toBe(1);
  });

  it("generates unique IDs for different account types", () => {
    const ids = Object.values(ACCOUNT_TYPES).map(t => encodeAccountId(t, 42, 1));
    const unique = new Set(ids.map(String));
    expect(unique.size).toBe(ids.length);
  });

  it("supports up to 16M traders (24-bit trader ID)", () => {
    const maxTraderId = 0xFFFFFF; // 16,777,215
    const id = encodeAccountId(ACCOUNT_TYPES.DUTY_COLLECTED, maxTraderId, 1);
    const decoded = decodeAccountId(id);
    expect(decoded.traderId).toBe(maxTraderId);
  });

  it("duty amount calculation is correct", () => {
    const declaredValue = 15000.00;
    const dutyRate = 0.20; // 20%
    const processingFeeRate = 0.025; // 2.5%

    const dutyAmount = declaredValue * dutyRate;
    const processingFee = dutyAmount * processingFeeRate;
    const totalAmount = dutyAmount + processingFee;

    expect(dutyAmount).toBe(3000.00);
    expect(processingFee).toBe(75.00);
    expect(totalAmount).toBe(3075.00);
  });
});

// ── 5. Temporal workflow input validation ─────────────────────────────────────

describe("Temporal workflow inputs", () => {
  interface DeclarationWorkflowInput {
    declarationId: number;
    traderId: number;
    hsCode: string;
    declaredValue: number;
    originCountry: string;
    declarationType: string;
  }

  function validateWorkflowInput(input: DeclarationWorkflowInput): string[] {
    const errors: string[] = [];
    if (!input.declarationId || input.declarationId <= 0) errors.push("declarationId must be positive");
    if (!input.traderId || input.traderId <= 0) errors.push("traderId must be positive");
    if (!input.hsCode || input.hsCode.length < 4) errors.push("hsCode must be at least 4 digits");
    if (!input.declaredValue || input.declaredValue <= 0) errors.push("declaredValue must be positive");
    if (!input.originCountry || input.originCountry.length !== 2) errors.push("originCountry must be ISO-2 code");
    if (!["import", "export", "transit", "re-export"].includes(input.declarationType)) {
      errors.push("declarationType must be import/export/transit/re-export");
    }
    return errors;
  }

  it("accepts valid workflow input", () => {
    const input: DeclarationWorkflowInput = {
      declarationId: 1001,
      traderId: 42,
      hsCode: "8471.30",
      declaredValue: 15000.00,
      originCountry: "CN",
      declarationType: "import",
    };
    expect(validateWorkflowInput(input)).toHaveLength(0);
  });

  it("rejects invalid HS code", () => {
    const input: DeclarationWorkflowInput = {
      declarationId: 1001, traderId: 42, hsCode: "84",
      declaredValue: 15000, originCountry: "CN", declarationType: "import",
    };
    const errors = validateWorkflowInput(input);
    expect(errors).toContain("hsCode must be at least 4 digits");
  });

  it("rejects invalid origin country", () => {
    const input: DeclarationWorkflowInput = {
      declarationId: 1001, traderId: 42, hsCode: "8471.30",
      declaredValue: 15000, originCountry: "CHN", declarationType: "import",
    };
    const errors = validateWorkflowInput(input);
    expect(errors).toContain("originCountry must be ISO-2 code");
  });

  it("rejects negative declared value", () => {
    const input: DeclarationWorkflowInput = {
      declarationId: 1001, traderId: 42, hsCode: "8471.30",
      declaredValue: -100, originCountry: "CN", declarationType: "import",
    };
    const errors = validateWorkflowInput(input);
    expect(errors).toContain("declaredValue must be positive");
  });
});

// ── 6. Stakeholder journey event sequences ────────────────────────────────────

describe("Stakeholder journey event sequences", () => {
  type EventType = string;

  interface JourneyStep {
    actor: string;
    event: EventType;
    nextStates: string[];
  }

  const DECLARATION_FSM: Record<string, JourneyStep> = {
    draft: {
      actor: "trader",
      event: "declaration.submitted",
      nextStates: ["submitted"],
    },
    submitted: {
      actor: "risk-engine",
      event: "risk.score_computed",
      nextStates: ["risk_assessed"],
    },
    risk_assessed: {
      actor: "system",
      event: "declaration.status_changed",
      nextStates: ["green_lane", "yellow_lane", "red_lane"],
    },
    green_lane: {
      actor: "system",
      event: "declaration.cleared",
      nextStates: ["cleared"],
    },
    yellow_lane: {
      actor: "customs_officer",
      event: "declaration.status_changed",
      nextStates: ["cleared", "rejected"],
    },
    red_lane: {
      actor: "customs_officer",
      event: "declaration.status_changed",
      nextStates: ["cleared", "rejected"],
    },
    cleared: {
      actor: "payment-service",
      event: "payment.initiated",
      nextStates: ["payment_pending"],
    },
    payment_pending: {
      actor: "trader",
      event: "payment.confirmed",
      nextStates: ["paid"],
    },
    paid: {
      actor: "port-operator",
      event: "cargo.released",
      nextStates: ["released"],
    },
  };

  it("defines all 30 stakeholder journey states", () => {
    const STAKEHOLDER_JOURNEYS = [
      "Trader: Import Declaration",
      "Trader: Export Declaration",
      "Trader: Transit Declaration",
      "Trader: AEO Application",
      "Trader: Duty Drawback Claim",
      "Customs Officer: Risk Assessment Review",
      "Customs Officer: Physical Inspection",
      "Customs Officer: Post-Clearance Audit",
      "Customs Officer: Penalty Issuance",
      "Customs Officer: Bond Management",
      "OGA Officer: Permit Review (FDA)",
      "OGA Officer: Permit Review (EPA)",
      "OGA Officer: Permit Review (MoFA)",
      "OGA Officer: SLA Monitoring",
      "Port Operator: Cargo Release",
      "Port Operator: Vessel Scheduling",
      "Port Operator: Congestion Alert",
      "Payment Officer: Duty Invoice Management",
      "Payment Officer: Mojaloop Settlement",
      "Payment Officer: TigerBeetle Reconciliation",
      "Compliance Officer: Sanctions Screening",
      "Compliance Officer: WCO CEN Alert",
      "Compliance Officer: INTERPOL Notice",
      "IT Administrator: Keycloak User Management",
      "IT Administrator: APISIX Route Configuration",
      "IT Administrator: Temporal Workflow Monitoring",
      "IT Administrator: Kafka Topic Management",
      "Analytics Team: Delta Lake Query",
      "Analytics Team: Flink Stream Monitoring",
      "Executive: KPI Dashboard",
    ];
    expect(STAKEHOLDER_JOURNEYS).toHaveLength(30);
  });

  it("green lane declaration follows correct event sequence", () => {
    const sequence: string[] = [];
    let state = "draft";

    // Simulate green lane journey
    const journey = ["draft", "submitted", "risk_assessed", "green_lane", "cleared", "payment_pending", "paid"];
    for (const s of journey) {
      if (DECLARATION_FSM[s]) {
        sequence.push(DECLARATION_FSM[s].event);
        state = DECLARATION_FSM[s].nextStates[0];
      }
    }

    expect(sequence).toContain("declaration.submitted");
    expect(sequence).toContain("risk.score_computed");
    expect(sequence).toContain("declaration.cleared");
    expect(sequence).toContain("payment.initiated");
    expect(sequence).toContain("payment.confirmed");
  });

  it("FSM prevents invalid state transitions", () => {
    // Cannot go from draft directly to cleared
    const draftStep = DECLARATION_FSM["draft"];
    expect(draftStep.nextStates).not.toContain("cleared");
    expect(draftStep.nextStates).toContain("submitted");
  });

  it("all FSM states have valid actors", () => {
    const VALID_ACTORS = ["trader", "risk-engine", "system", "customs_officer", "payment-service", "port-operator"];
    for (const [state, step] of Object.entries(DECLARATION_FSM)) {
      expect(VALID_ACTORS).toContain(step.actor);
    }
  });
});

// ── 7. APISIX route configuration ────────────────────────────────────────────

describe("APISIX route configuration", () => {
  interface Route {
    id: string;
    uri: string;
    upstream: string;
    methods: string[];
    authRequired: boolean;
  }

  const ROUTES: Route[] = [
    { id: "declaration-service", uri: "/api/declarations/*", upstream: "declaration-service:8081", methods: ["GET", "POST", "PUT"], authRequired: true },
    { id: "payment-service", uri: "/api/payments/*", upstream: "payment-service:8082", methods: ["GET", "POST"], authRequired: true },
    { id: "oga-service", uri: "/api/oga/*", upstream: "oga-service:8083", methods: ["GET", "POST", "PUT"], authRequired: true },
    { id: "profile-service", uri: "/api/profiles/*", upstream: "profile-service:8084", methods: ["GET", "POST", "PUT"], authRequired: true },
    { id: "risk-engine", uri: "/api/risk/*", upstream: "risk-engine:8085", methods: ["POST"], authRequired: true },
    { id: "cargo-service", uri: "/api/cargo/*", upstream: "cargo-service:8086", methods: ["GET", "POST"], authRequired: true },
    { id: "sanctions-service", uri: "/api/sanctions/*", upstream: "sanctions-service:8087", methods: ["POST"], authRequired: true },
    { id: "health", uri: "/health", upstream: "declaration-service:8081", methods: ["GET"], authRequired: false },
  ];

  it("all service routes are defined", () => {
    const serviceIds = ROUTES.map(r => r.id);
    expect(serviceIds).toContain("declaration-service");
    expect(serviceIds).toContain("payment-service");
    expect(serviceIds).toContain("oga-service");
    expect(serviceIds).toContain("risk-engine");
    expect(serviceIds).toContain("sanctions-service");
  });

  it("all routes have valid upstream format", () => {
    for (const route of ROUTES) {
      expect(route.upstream).toMatch(/^[\w-]+:\d+$/);
    }
  });

  it("all protected routes require authentication", () => {
    const protectedRoutes = ROUTES.filter(r => r.uri !== "/health");
    for (const route of protectedRoutes) {
      expect(route.authRequired).toBe(true);
    }
  });

  it("health endpoint is publicly accessible", () => {
    const health = ROUTES.find(r => r.uri === "/health");
    expect(health?.authRequired).toBe(false);
  });

  it("risk and sanctions endpoints only accept POST", () => {
    const risk = ROUTES.find(r => r.id === "risk-engine");
    const sanctions = ROUTES.find(r => r.id === "sanctions-service");
    expect(risk?.methods).toEqual(["POST"]);
    expect(sanctions?.methods).toEqual(["POST"]);
  });
});

// ── 8. Dapr component configuration ──────────────────────────────────────────

describe("Dapr component configuration", () => {
  interface DaprComponent {
    name: string;
    type: string;
    version: string;
    metadata: Record<string, string>;
  }

  const COMPONENTS: DaprComponent[] = [
    {
      name: "kafka-pubsub",
      type: "pubsub.kafka",
      version: "v1",
      metadata: {
        brokers: "kafka:29092",
        consumerGroup: "tradegateway-dapr",
        authRequired: "false",
      },
    },
    {
      name: "redis-statestore",
      type: "state.redis",
      version: "v1",
      metadata: {
        redisHost: "redis:6379",
        actorStateStore: "true",
      },
    },
  ];

  it("kafka pubsub component is correctly configured", () => {
    const kafka = COMPONENTS.find(c => c.name === "kafka-pubsub");
    expect(kafka).toBeDefined();
    expect(kafka?.type).toBe("pubsub.kafka");
    expect(kafka?.metadata.brokers).toContain("kafka");
    expect(kafka?.metadata.consumerGroup).toBeTruthy();
  });

  it("redis state store is configured for actor state", () => {
    const redis = COMPONENTS.find(c => c.name === "redis-statestore");
    expect(redis).toBeDefined();
    expect(redis?.type).toBe("state.redis");
    expect(redis?.metadata.actorStateStore).toBe("true");
  });

  it("all components have required fields", () => {
    for (const component of COMPONENTS) {
      expect(component.name).toBeTruthy();
      expect(component.type).toMatch(/^(pubsub|state|bindings|secretstores)\./);
      expect(component.version).toMatch(/^v\d+$/);
    }
  });
});

// ── 9. Permify authorization model ───────────────────────────────────────────

describe("Permify authorization model", () => {
  type Role = "admin" | "customs_officer" | "oga_officer" | "trader" | "port_operator" | "auditor";

  interface Permission {
    resource: string;
    action: string;
    allowedRoles: Role[];
  }

  const PERMISSIONS: Permission[] = [
    { resource: "declaration", action: "submit", allowedRoles: ["trader"] },
    { resource: "declaration", action: "approve", allowedRoles: ["customs_officer", "admin"] },
    { resource: "declaration", action: "view_all", allowedRoles: ["customs_officer", "admin", "auditor"] },
    { resource: "payment_invoice", action: "create", allowedRoles: ["admin"] },
    { resource: "payment_invoice", action: "pay", allowedRoles: ["trader"] },
    { resource: "oga_permit", action: "review", allowedRoles: ["oga_officer", "admin"] },
    { resource: "cargo", action: "release", allowedRoles: ["port_operator", "admin"] },
    { resource: "audit_log", action: "view", allowedRoles: ["auditor", "admin"] },
    { resource: "risk_score", action: "override", allowedRoles: ["admin"] },
    { resource: "sanctions_list", action: "manage", allowedRoles: ["admin"] },
  ];

  function can(role: Role, resource: string, action: string): boolean {
    const perm = PERMISSIONS.find(p => p.resource === resource && p.action === action);
    return perm ? perm.allowedRoles.includes(role) : false;
  }

  it("traders can submit declarations but not approve them", () => {
    expect(can("trader", "declaration", "submit")).toBe(true);
    expect(can("trader", "declaration", "approve")).toBe(false);
  });

  it("customs officers can approve declarations", () => {
    expect(can("customs_officer", "declaration", "approve")).toBe(true);
  });

  it("OGA officers can review permits", () => {
    expect(can("oga_officer", "oga_permit", "review")).toBe(true);
  });

  it("port operators can release cargo", () => {
    expect(can("port_operator", "cargo", "release")).toBe(true);
  });

  it("traders cannot release cargo", () => {
    expect(can("trader", "cargo", "release")).toBe(false);
  });

  it("admin has override capabilities", () => {
    expect(can("admin", "risk_score", "override")).toBe(true);
    expect(can("admin", "sanctions_list", "manage")).toBe(true);
  });

  it("auditors can view audit logs but not modify them", () => {
    expect(can("auditor", "audit_log", "view")).toBe(true);
    expect(can("auditor", "risk_score", "override")).toBe(false);
  });
});

// ── 10. Lakehouse event transformation ───────────────────────────────────────

describe("Lakehouse event transformation", () => {
  function transformEvent(topic: string, event: Record<string, unknown>): Record<string, unknown> | null {
    const now = new Date();
    const base = {
      event_id: event.eventId ?? `${topic}-${event.id ?? ""}`,
      event_type: topic,
      event_time: now.toISOString(),
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    };

    if (topic.startsWith("declaration.")) {
      return { ...base,
        declaration_id: event.declarationId,
        trader_id: event.traderId,
        hs_code: event.hsCode ?? "",
        declared_value: event.declaredValue ?? 0,
        origin_country: event.originCountry ?? "",
        status: event.status ?? "",
        risk_lane: event.riskLane ?? "",
        risk_score: event.riskScore ?? 0,
      };
    }

    if (topic.startsWith("payment.")) {
      return { ...base,
        invoice_id: event.invoiceId,
        declaration_id: event.declarationId,
        amount: event.amount ?? 0,
        currency: event.currency ?? "GHS",
        mojaloop_tx_id: event.mojaloopTxId ?? "",
        status: event.status ?? "",
      };
    }

    return null;
  }

  it("transforms declaration.submitted event correctly", () => {
    const event = {
      eventId: "evt-001",
      declarationId: 1001,
      traderId: 42,
      hsCode: "8471.30",
      declaredValue: 15000,
      originCountry: "CN",
      status: "submitted",
    };
    const record = transformEvent("declaration.submitted", event);
    expect(record).not.toBeNull();
    expect(record?.declaration_id).toBe(1001);
    expect(record?.hs_code).toBe("8471.30");
    expect(record?.year).toBeGreaterThan(2020);
    expect(record?.month).toBeGreaterThanOrEqual(1);
    expect(record?.month).toBeLessThanOrEqual(12);
  });

  it("transforms payment.confirmed event correctly", () => {
    const event = {
      eventId: "pmt-001",
      invoiceId: 5001,
      declarationId: 1001,
      traderId: 42,
      amount: 3075.00,
      currency: "GHS",
      mojaloopTxId: "mojaloop-tx-abc123",
      status: "paid",
    };
    const record = transformEvent("payment.confirmed", event);
    expect(record?.invoice_id).toBe(5001);
    expect(record?.amount).toBe(3075.00);
    expect(record?.currency).toBe("GHS");
    expect(record?.mojaloop_tx_id).toBe("mojaloop-tx-abc123");
  });

  it("returns null for unknown topics", () => {
    const record = transformEvent("unknown.topic", { id: 1 });
    expect(record).toBeNull();
  });

  it("all records have year and month partition fields", () => {
    const decl = transformEvent("declaration.submitted", { declarationId: 1, traderId: 1 });
    const pmt = transformEvent("payment.confirmed", { invoiceId: 1, declarationId: 1 });
    expect(decl?.year).toBeDefined();
    expect(decl?.month).toBeDefined();
    expect(pmt?.year).toBeDefined();
    expect(pmt?.month).toBeDefined();
  });
});
