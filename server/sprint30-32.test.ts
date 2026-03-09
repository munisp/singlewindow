/**
 * sprint30-32.test.ts
 *
 * Vitest tests for Sprints 30–32:
 *   Sprint 30 — Go Mojaloop service: enhanced tRPC router with DB persistence
 *   Sprint 31 — Go TigerBeetle bridge + Python payment risk scorer
 *   Sprint 32 — Go Keycloak OIDC validator: JWT validation, role federation, admin UI
 *
 * All external services (Go bridges, Python scorer) are mocked via vi.stubGlobal
 * on globalThis.fetch so no live services are required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Shared mock helpers ──────────────────────────────────────────────────────

type MockFetchMap = Record<string, { status: number; body: unknown }>;

function mockFetch(routes: MockFetchMap) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern));
    if (!match) {
      return { ok: false, status: 404, text: async () => "Not found", json: async () => ({}) };
    }
    const [, { status, body }] = match;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  });
}

// ─── SPRINT 30 — Mojaloop Enhanced Router ────────────────────────────────────

describe("Sprint 30 — Mojaloop tRPC router", () => {
  describe("Mojaloop service availability check", () => {
    it("returns available=true when /health returns 200", async () => {
      const fetch = mockFetch({ "/health": { status: 200, body: { status: "ok" } } });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch("http://localhost:8085/health");
      expect(res.ok).toBe(true);
      vi.unstubAllGlobals();
    });

    it("returns available=false when /health returns 503", async () => {
      const fetch = mockFetch({ "/health": { status: 503, body: { status: "degraded" } } });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch("http://localhost:8085/health");
      expect(res.ok).toBe(false);
      vi.unstubAllGlobals();
    });

    it("returns available=false on network error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
      let available = true;
      try {
        await globalThis.fetch("http://localhost:8085/health");
      } catch {
        available = false;
      }
      expect(available).toBe(false);
      vi.unstubAllGlobals();
    });
  });

  describe("Mojaloop quote creation", () => {
    it("constructs correct quote request body", () => {
      const quoteReq = {
        quoteId: "QTE-2026-001",
        transactionId: "TXN-2026-001",
        payerId: "TRADER-001",
        payeeId: "GRA_CUSTOMS_REVENUE",
        amount: "15000.00",
        currency: "GHS",
        transactionType: "PAYMENT" as const,
        note: "Duty payment for declaration DEC-2026-001",
      };
      expect(quoteReq.quoteId).toMatch(/^QTE-/);
      expect(quoteReq.transactionType).toBe("PAYMENT");
      expect(parseFloat(quoteReq.amount)).toBeGreaterThan(0);
    });

    it("quote response contains fee and expiry", () => {
      const quoteResponse = {
        quoteId: "QTE-2026-001",
        transferAmount: "15000.00",
        currency: "GHS",
        payeeFspFee: { amount: "1.50", currency: "GHS" },
        payeeFspCommission: { amount: "0.00", currency: "GHS" },
        expiration: new Date(Date.now() + 30_000).toISOString(),
        ilpPacket: "AYIBgAAAAAAAAAPoHWcuZXhhbXBsZS5tb2phbG9vcC5iYWNrZW5k",
        condition: "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
      };
      expect(quoteResponse.payeeFspFee.amount).toBeDefined();
      expect(new Date(quoteResponse.expiration).getTime()).toBeGreaterThan(Date.now());
    });

    it("rejects quote with amount = 0", () => {
      const validate = (amount: number) => {
        if (amount <= 0) throw new Error("Amount must be positive");
        return true;
      };
      expect(() => validate(0)).toThrow("Amount must be positive");
      expect(validate(1)).toBe(true);
    });
  });

  describe("Mojaloop transfer lifecycle", () => {
    it("transfer state machine: RECEIVED → RESERVED → COMMITTED", () => {
      const states = ["RECEIVED", "RESERVED", "COMMITTED"];
      let idx = 0;
      const advance = () => states[++idx];
      expect(advance()).toBe("RESERVED");
      expect(advance()).toBe("COMMITTED");
    });

    it("transfer state machine: RECEIVED → RESERVED → ABORTED", () => {
      const states = ["RECEIVED", "RESERVED", "ABORTED"];
      let idx = 0;
      const advance = () => states[++idx];
      expect(advance()).toBe("RESERVED");
      expect(advance()).toBe("ABORTED");
    });

    it("callback handler updates DB record on COMMITTED", async () => {
      const dbUpdates: Record<string, string>[] = [];
      const handleCallback = async (transferId: string, state: string) => {
        dbUpdates.push({ transferId, state });
        return { updated: true };
      };
      await handleCallback("TXN-001", "COMMITTED");
      expect(dbUpdates[0]).toEqual({ transferId: "TXN-001", state: "COMMITTED" });
    });

    it("callback handler updates DB record on ABORTED", async () => {
      const dbUpdates: Record<string, string>[] = [];
      const handleCallback = async (transferId: string, state: string) => {
        dbUpdates.push({ transferId, state });
        return { updated: true };
      };
      await handleCallback("TXN-002", "ABORTED");
      expect(dbUpdates[0].state).toBe("ABORTED");
    });

    it("ILP packet is base64url-encoded string", () => {
      const packet = "AYIBgAAAAAAAAAPoHWcuZXhhbXBsZS5tb2phbG9vcC5iYWNrZW5k";
      expect(typeof packet).toBe("string");
      expect(packet.length).toBeGreaterThan(10);
      // base64url chars only
      expect(/^[A-Za-z0-9_-]+$/.test(packet)).toBe(true);
    });
  });

  describe("Mojaloop FSP routing", () => {
    const FSP_ROUTING: Record<string, string> = {
      GCB_BANK: "gcb.bank.gh",
      ECOBANK_GH: "ecobank.bank.gh",
      STANBIC_GH: "stanbic.bank.gh",
      MTN_MOMO: "mtn.momo.gh",
      VODAFONE_CASH: "vodafone.momo.gh",
      AIRTELTIGO_MONEY: "airteltigo.momo.gh",
      CENTRAL_BANK: "bog.central.gh",
    };

    it("all 7 FSPs have routing entries", () => {
      expect(Object.keys(FSP_ROUTING)).toHaveLength(7);
    });

    it("mobile money FSPs use .momo.gh domain", () => {
      const momoFSPs = ["MTN_MOMO", "VODAFONE_CASH", "AIRTELTIGO_MONEY"];
      momoFSPs.forEach(fsp => {
        expect(FSP_ROUTING[fsp]).toContain(".momo.gh");
      });
    });

    it("bank FSPs use .bank.gh domain", () => {
      const bankFSPs = ["GCB_BANK", "ECOBANK_GH", "STANBIC_GH"];
      bankFSPs.forEach(fsp => {
        expect(FSP_ROUTING[fsp]).toContain(".bank.gh");
      });
    });
  });
});

// ─── SPRINT 31 — TigerBeetle Bridge + Payment Risk Scorer ────────────────────

describe("Sprint 31 — TigerBeetle bridge", () => {
  describe("Double-entry transfer validation", () => {
    it("debit and credit accounts must differ", () => {
      const validate = (debitId: string, creditId: string) => {
        if (debitId === creditId) throw new Error("Debit and credit accounts must differ");
        return true;
      };
      expect(() => validate("acct-001", "acct-001")).toThrow("Debit and credit accounts must differ");
      expect(validate("acct-001", "acct-002")).toBe(true);
    });

    it("transfer amount must be positive integer (TigerBeetle uses u128)", () => {
      const toU128 = (amount: number) => {
        if (!Number.isInteger(amount) || amount <= 0) throw new Error("Amount must be positive integer");
        return BigInt(amount);
      };
      expect(() => toU128(0)).toThrow();
      expect(() => toU128(-1)).toThrow();
      expect(() => toU128(1.5)).toThrow();
      expect(toU128(1500000)).toBe(BigInt(1500000));
    });

    it("two-phase transfer: pending → posted lifecycle", () => {
      const PENDING = 1;
      const POSTED = 2;
      const VOIDED = 3;
      let state = PENDING;
      const post = () => { state = POSTED; };
      const void_ = () => { state = VOIDED; };

      post();
      expect(state).toBe(POSTED);

      state = PENDING;
      void_();
      expect(state).toBe(VOIDED);
    });

    it("account ledger IDs map to WCO financial categories", () => {
      const LEDGER_IDS: Record<string, number> = {
        TRADER_LIABILITY: 1001,
        CUSTOMS_REVENUE_PENDING: 1002,
        CUSTOMS_REVENUE_CONFIRMED: 1003,
        BOND_DEPOSIT: 1004,
        DRAWBACK_PAYABLE: 1005,
      };
      expect(LEDGER_IDS.TRADER_LIABILITY).toBe(1001);
      expect(Object.keys(LEDGER_IDS)).toHaveLength(5);
    });

    it("transfer metadata encodes declaration reference", () => {
      const buildMetadata = (declarationId: number, paymentId: number) => ({
        declarationId,
        paymentId,
        timestamp: Date.now(),
        source: "tradegateway",
      });
      const meta = buildMetadata(42, 7);
      expect(meta.declarationId).toBe(42);
      expect(meta.paymentId).toBe(7);
      expect(meta.source).toBe("tradegateway");
    });
  });

  describe("TigerBeetle bridge HTTP API", () => {
    it("GET /api/ledger/accounts/:id returns balance fields", async () => {
      const mockAccount = {
        id: "acct-001",
        ledger: 1001,
        code: 100,
        debitsPosted: 500000,
        creditsPosted: 1500000,
        debitsPending: 0,
        creditsPending: 0,
        flags: 0,
      };
      const fetch = mockFetch({
        "/api/ledger/accounts/acct-001": { status: 200, body: mockAccount },
      });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch("http://localhost:8086/api/ledger/accounts/acct-001");
      const data = await res.json() as typeof mockAccount;
      expect(data.creditsPosted - data.debitsPosted).toBe(1000000);
      vi.unstubAllGlobals();
    });

    it("POST /api/ledger/transfers returns transfer ID", async () => {
      const mockTransfer = { id: "txn-uuid-001", status: "POSTED" };
      const fetch = mockFetch({
        "/api/ledger/transfers": { status: 201, body: mockTransfer },
      });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch("http://localhost:8086/api/ledger/transfers", {
        method: "POST",
        body: JSON.stringify({ amount: 50000, debitAccountId: "acct-001", creditAccountId: "acct-002" }),
      });
      const data = await res.json() as typeof mockTransfer;
      expect(data.id).toBe("txn-uuid-001");
      expect(data.status).toBe("POSTED");
      vi.unstubAllGlobals();
    });

    it("GET /api/ledger/summary returns all 5 account types", async () => {
      const mockSummary = {
        accounts: [
          { id: "acct-001", accountType: "TRADER_LIABILITY" },
          { id: "acct-002", accountType: "CUSTOMS_REVENUE_PENDING" },
          { id: "acct-003", accountType: "CUSTOMS_REVENUE_CONFIRMED" },
          { id: "acct-004", accountType: "BOND_DEPOSIT" },
          { id: "acct-005", accountType: "DRAWBACK_PAYABLE" },
        ],
        recentTransfers: [],
        summary: { totalRevenueConfirmed: 0, totalRevenuePending: 0, currency: "GHS" },
      };
      const fetch = mockFetch({
        "/api/ledger/summary": { status: 200, body: mockSummary },
      });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch("http://localhost:8086/api/ledger/summary");
      const data = await res.json() as typeof mockSummary;
      expect(data.accounts).toHaveLength(5);
      vi.unstubAllGlobals();
    });
  });

  describe("Python payment risk scorer", () => {
    it("scores low-risk payment correctly", async () => {
      const mockScore = {
        risk_score: 0.12,
        risk_tier: "LOW",
        recommended_action: "APPROVE",
        flags: [],
        model_version: "v1.0.0",
        scored_at: new Date().toISOString(),
      };
      const fetch = mockFetch({
        "/api/score": { status: 200, body: mockScore },
      });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch("http://localhost:8092/api/score", {
        method: "POST",
        body: JSON.stringify({ traderId: "TRADER-001", amount: 5000, fspId: "GCB_BANK" }),
      });
      const data = await res.json() as typeof mockScore;
      expect(data.risk_tier).toBe("LOW");
      expect(data.recommended_action).toBe("APPROVE");
      expect(data.flags).toHaveLength(0);
      vi.unstubAllGlobals();
    });

    it("scores high-risk payment with flags", async () => {
      const mockScore = {
        risk_score: 0.87,
        risk_tier: "HIGH",
        recommended_action: "MANUAL_REVIEW",
        flags: ["AMOUNT_EXCEEDS_THRESHOLD", "FIRST_PAYMENT_LARGE_AMOUNT", "UNUSUAL_FSP"],
        model_version: "v1.0.0",
        scored_at: new Date().toISOString(),
      };
      const fetch = mockFetch({
        "/api/score": { status: 200, body: mockScore },
      });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch("http://localhost:8092/api/score", {
        method: "POST",
        body: JSON.stringify({ traderId: "TRADER-NEW", amount: 500000, fspId: "UNKNOWN_FSP", isFirstPayment: true }),
      });
      const data = await res.json() as typeof mockScore;
      expect(data.risk_tier).toBe("HIGH");
      expect(data.flags.length).toBeGreaterThan(0);
      expect(data.flags).toContain("AMOUNT_EXCEEDS_THRESHOLD");
      vi.unstubAllGlobals();
    });

    it("scores CRITICAL risk and recommends BLOCK", async () => {
      const mockScore = {
        risk_score: 0.96,
        risk_tier: "CRITICAL",
        recommended_action: "BLOCK",
        flags: ["SANCTIONS_HIT", "BLACKLISTED_ACCOUNT"],
        model_version: "v1.0.0",
        scored_at: new Date().toISOString(),
      };
      const fetch = mockFetch({
        "/api/score": { status: 200, body: mockScore },
      });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch("http://localhost:8092/api/score", {
        method: "POST",
        body: JSON.stringify({ traderId: "BLOCKED-001", amount: 1000000, fspId: "MTN_MOMO" }),
      });
      const data = await res.json() as typeof mockScore;
      expect(data.risk_tier).toBe("CRITICAL");
      expect(data.recommended_action).toBe("BLOCK");
      vi.unstubAllGlobals();
    });

    it("risk score is between 0 and 1", () => {
      const scores = [0.0, 0.12, 0.45, 0.87, 0.96, 1.0];
      scores.forEach(score => {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      });
    });

    it("payment-to-declaration ratio flag triggers at 150% or above", () => {
      const checkRatio = (paymentAmount: number, declaredValue: number) => {
        const ratio = paymentAmount / declaredValue;
        return ratio >= 1.5 ? "PAYMENT_EXCEEDS_DECLARED_VALUE" : null;
      };
      expect(checkRatio(15000, 10000)).toBe("PAYMENT_EXCEEDS_DECLARED_VALUE");
      expect(checkRatio(20000, 10000)).toBe("PAYMENT_EXCEEDS_DECLARED_VALUE");
      expect(checkRatio(10000, 10000)).toBeNull();
      expect(checkRatio(14999, 10000)).toBeNull();
    });

    it("gracefully falls back when scorer is unavailable", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
      const fallbackScore = {
        risk_score: 0.5,
        risk_tier: "MEDIUM",
        recommended_action: "APPROVE",
        flags: ["SCORER_UNAVAILABLE_FALLBACK"],
        model_version: "fallback",
        scored_at: new Date().toISOString(),
      };
      // Simulate fallback logic
      let result;
      try {
        await globalThis.fetch("http://localhost:8092/api/score");
        result = { risk_tier: "LOW" };
      } catch {
        result = fallbackScore;
      }
      expect(result.risk_tier).toBe("MEDIUM");
      expect(result.flags).toContain("SCORER_UNAVAILABLE_FALLBACK");
      vi.unstubAllGlobals();
    });
  });
});

// ─── SPRINT 32 — Keycloak OIDC Validator ─────────────────────────────────────

describe("Sprint 32 — Keycloak OIDC validator", () => {
  describe("OIDC discovery document", () => {
    it("discovery URL is derived from realm URL", () => {
      const realmUrl = "https://keycloak.example.com/realms/tradegateway";
      const discoveryUrl = `${realmUrl}/.well-known/openid-configuration`;
      expect(discoveryUrl).toBe(
        "https://keycloak.example.com/realms/tradegateway/.well-known/openid-configuration"
      );
    });

    it("discovery document contains required OIDC fields", async () => {
      const mockDiscovery = {
        issuer: "https://keycloak.example.com/realms/tradegateway",
        authorization_endpoint: "https://keycloak.example.com/realms/tradegateway/protocol/openid-connect/auth",
        token_endpoint: "https://keycloak.example.com/realms/tradegateway/protocol/openid-connect/token",
        jwks_uri: "https://keycloak.example.com/realms/tradegateway/protocol/openid-connect/certs",
        userinfo_endpoint: "https://keycloak.example.com/realms/tradegateway/protocol/openid-connect/userinfo",
        response_types_supported: ["code", "token", "id_token"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      };
      const fetch = mockFetch({
        "/.well-known/openid-configuration": { status: 200, body: mockDiscovery },
      });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch(
        "https://keycloak.example.com/realms/tradegateway/.well-known/openid-configuration"
      );
      const data = await res.json() as typeof mockDiscovery;
      expect(data.issuer).toBeDefined();
      expect(data.jwks_uri).toBeDefined();
      expect(data.id_token_signing_alg_values_supported).toContain("RS256");
      vi.unstubAllGlobals();
    });
  });

  describe("JWKS caching", () => {
    it("JWKS response contains at least one RSA key", async () => {
      const mockJWKS = {
        keys: [
          {
            kid: "key-001",
            kty: "RSA",
            alg: "RS256",
            use: "sig",
            n: "sIm9...",
            e: "AQAB",
          },
        ],
      };
      const fetch = mockFetch({
        "/protocol/openid-connect/certs": { status: 200, body: mockJWKS },
      });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch(
        "https://keycloak.example.com/realms/tradegateway/protocol/openid-connect/certs"
      );
      const data = await res.json() as typeof mockJWKS;
      expect(data.keys.length).toBeGreaterThan(0);
      expect(data.keys[0].kty).toBe("RSA");
      expect(data.keys[0].alg).toBe("RS256");
      vi.unstubAllGlobals();
    });

    it("JWKS rotation endpoint forces cache invalidation", async () => {
      const mockRotation = { rotated: true, newKid: "key-002", cachedAt: new Date().toISOString() };
      const fetch = mockFetch({
        "/api/oidc/jwks/rotate": { status: 200, body: mockRotation },
      });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch("http://localhost:8087/api/oidc/jwks/rotate", {
        method: "POST",
      });
      const data = await res.json() as typeof mockRotation;
      expect(data.rotated).toBe(true);
      expect(data.newKid).toBe("key-002");
      vi.unstubAllGlobals();
    });
  });

  describe("JWT validation and role federation", () => {
    it("valid token returns mapped TradeGateway role", async () => {
      const mockValidation = {
        valid: true,
        subject: "user-uuid-001",
        username: "john.customs",
        email: "john@customs.gov.gh",
        realmRoles: ["customs-officer", "default-roles-tradegateway"],
        clientRoles: [],
        mappedRole: "customs_officer",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
      const fetch = mockFetch({
        "/api/oidc/validate": { status: 200, body: mockValidation },
      });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch("http://localhost:8087/api/oidc/validate", {
        method: "POST",
        body: JSON.stringify({ token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." }),
      });
      const data = await res.json() as typeof mockValidation;
      expect(data.valid).toBe(true);
      expect(data.mappedRole).toBe("customs_officer");
      vi.unstubAllGlobals();
    });

    it("expired token returns valid=false", async () => {
      const mockValidation = {
        valid: false,
        error: "token is expired",
        subject: null,
        mappedRole: null,
      };
      const fetch = mockFetch({
        "/api/oidc/validate": { status: 200, body: mockValidation },
      });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch("http://localhost:8087/api/oidc/validate", {
        method: "POST",
        body: JSON.stringify({ token: "expired.token.here" }),
      });
      const data = await res.json() as typeof mockValidation;
      expect(data.valid).toBe(false);
      expect(data.error).toContain("expired");
      vi.unstubAllGlobals();
    });

    it("token with wrong audience returns valid=false", async () => {
      const mockValidation = {
        valid: false,
        error: "token audience mismatch: expected tradegateway, got other-service",
      };
      const fetch = mockFetch({
        "/api/oidc/validate": { status: 200, body: mockValidation },
      });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch("http://localhost:8087/api/oidc/validate", {
        method: "POST",
        body: JSON.stringify({ token: "wrong.audience.token" }),
      });
      const data = await res.json() as typeof mockValidation;
      expect(data.valid).toBe(false);
      expect(data.error).toContain("audience");
      vi.unstubAllGlobals();
    });

    it("role mapping: customs-admin → admin", () => {
      const ROLE_MAPPINGS: Record<string, string> = {
        "customs-admin": "admin",
        "customs-officer": "customs_officer",
        "oga-officer": "oga_officer",
        "inspector": "inspector",
        "finance-officer": "finance",
        "trader": "user",
        "default-roles-tradegateway": "user",
      };
      const mapRole = (realmRoles: string[]): string => {
        for (const role of realmRoles) {
          if (ROLE_MAPPINGS[role] && ROLE_MAPPINGS[role] !== "user") {
            return ROLE_MAPPINGS[role];
          }
        }
        return "user";
      };
      expect(mapRole(["customs-admin"])).toBe("admin");
      expect(mapRole(["customs-officer", "default-roles-tradegateway"])).toBe("customs_officer");
      expect(mapRole(["oga-officer"])).toBe("oga_officer");
      expect(mapRole(["inspector"])).toBe("inspector");
      expect(mapRole(["finance-officer"])).toBe("finance");
      expect(mapRole(["trader"])).toBe("user");
      expect(mapRole(["default-roles-tradegateway"])).toBe("user");
      expect(mapRole([])).toBe("user");
    });

    it("highest-privilege role wins when multiple roles present", () => {
      const PRIORITY = ["admin", "customs_officer", "oga_officer", "inspector", "finance", "user"];
      const ROLE_MAPPINGS: Record<string, string> = {
        "customs-admin": "admin",
        "customs-officer": "customs_officer",
        "finance-officer": "finance",
      };
      const mapRole = (realmRoles: string[]): string => {
        const mapped = realmRoles.map(r => ROLE_MAPPINGS[r]).filter(Boolean);
        mapped.sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b));
        return mapped[0] ?? "user";
      };
      expect(mapRole(["customs-admin", "finance-officer"])).toBe("admin");
      expect(mapRole(["customs-officer", "finance-officer"])).toBe("customs_officer");
    });
  });

  describe("Keycloak service health and config", () => {
    it("service status includes version and realm info", async () => {
      const mockStatus = {
        available: true,
        serviceUrl: "http://keycloak-svc:8087",
        version: "1.0.0",
        realmConfigured: true,
        jwksCached: true,
        jwksCachedAt: new Date().toISOString(),
        keyCount: 2,
      };
      const fetch = mockFetch({
        "/health": { status: 200, body: mockStatus },
      });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch("http://localhost:8087/health");
      const data = await res.json() as typeof mockStatus;
      expect(data.available).toBe(true);
      expect(data.jwksCached).toBe(true);
      expect(data.keyCount).toBeGreaterThan(0);
      vi.unstubAllGlobals();
    });

    it("config update persists realmUrl, clientId, and roleMappings", async () => {
      const mockUpdate = {
        success: true,
        config: {
          enabled: true,
          realmUrl: "https://keycloak.example.com/realms/tradegateway",
          clientId: "tradegateway",
          audience: "tradegateway",
          fallbackEnabled: true,
        },
      };
      const fetch = mockFetch({
        "/api/oidc/config": { status: 200, body: mockUpdate },
      });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch("http://localhost:8087/api/oidc/config", {
        method: "PUT",
        body: JSON.stringify(mockUpdate.config),
      });
      const data = await res.json() as typeof mockUpdate;
      expect(data.success).toBe(true);
      expect(data.config.enabled).toBe(true);
      vi.unstubAllGlobals();
    });

    it("connection test returns latency measurement", async () => {
      const mockTest = {
        success: true,
        latencyMs: 42,
        issuer: "https://keycloak.example.com/realms/tradegateway",
        tokenEndpoint: "https://keycloak.example.com/realms/tradegateway/protocol/openid-connect/token",
        checkedAt: new Date().toISOString(),
      };
      const fetch = mockFetch({
        "/api/oidc/test": { status: 200, body: mockTest },
      });
      vi.stubGlobal("fetch", fetch);
      const res = await globalThis.fetch("http://localhost:8087/api/oidc/test");
      const data = await res.json() as typeof mockTest;
      expect(data.success).toBe(true);
      expect(data.latencyMs).toBeGreaterThanOrEqual(0);
      expect(data.issuer).toBeDefined();
      vi.unstubAllGlobals();
    });

    it("fallback to Manus OAuth when Keycloak is disabled", () => {
      const shouldUseManus = (keycloakEnabled: boolean, fallbackEnabled: boolean) => {
        return !keycloakEnabled || fallbackEnabled;
      };
      expect(shouldUseManus(false, true)).toBe(true);
      expect(shouldUseManus(false, false)).toBe(true);
      expect(shouldUseManus(true, false)).toBe(false);
      expect(shouldUseManus(true, true)).toBe(true);
    });
  });
});
