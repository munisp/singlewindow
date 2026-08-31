/**
 * tariffAssessment.test.ts — PRA-100 router wiring tests for
 * declarations.assessDuty against a REAL local tariff-engine HTTP server
 * (node:http, ephemeral port — the only mock boundary is the database, which
 * is not on the tariff code path).
 *
 * Covers: engine-verified assessment replacing the flat-rate estimate,
 * deterministic idempotency-key replay, ownership enforcement, and classified
 * upstream errors (4xx → BAD_REQUEST, 5xx-after-retries → SERVICE_UNAVAILABLE).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { TrpcContext } from "./_core/context";

// ─── Database mock (the tariff path itself is NOT mocked) ────────────────────

const state = {
  decl: null as null | Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
  auditEvents: [] as Array<Record<string, unknown>>,
};

vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  createDeclaration: vi.fn(async () => ({ id: 1 })),
  getDeclarationById: vi.fn(async () => state.decl),
  getDeclarationsByTrader: vi.fn(async () => []),
  getAllDeclarations: vi.fn(async () => []),
  updateDeclaration: vi.fn(async (_id: number, v: Record<string, unknown>) => {
    state.updates.push(v);
    return { ...state.decl, ...v };
  }),
  getDeclarationStats: vi.fn(async () => ({})),
  getDeclarationStatsByTrader: vi.fn(async () => ({})),
  logAuditEvent: vi.fn(async (e: Record<string, unknown>) => {
    state.auditEvents.push(e);
  }),
  createNotification: vi.fn(async () => {}),
  createUserNotification: vi.fn(async () => ({ id: 1 })),
  getProfileByUserId: vi.fn(async () => ({ status: "approved" })),
  getLatestKYCVerification: vi.fn(async () => ({ status: "APPROVED" })),
  withRlsContext: vi.fn(async (_c: unknown, fn: (db: unknown) => unknown) => fn(null)),
}));

vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn(async () => ({})) }));
vi.mock("./_core/permify", () => ({ assertCan: vi.fn(async () => {}), setOwner: vi.fn(async () => {}) }));
vi.mock("./_core/polyglotClients", () => ({
  scoreDeclarationRisk: vi.fn(async () => null),
  validateDeclarationWithEngine: vi.fn(async () => ({})),
  getCargoPosition: vi.fn(async () => ({})),
}));
vi.mock("./_core/kafka", () => ({ publishEvent: vi.fn(async () => {}), TOPICS: { DECLARATION_SUBMITTED: "d.s" } }));
vi.mock("./_core/wsServer", () => ({
  broadcastNotification: vi.fn(),
  broadcastUnreadCount: vi.fn(),
  broadcastWorkloadUpdate: vi.fn(),
}));
vi.mock("./_core/opensearch", () => ({
  indexDeclaration: vi.fn(async () => {}),
  searchDeclarations: vi.fn(async () => ({ hits: [] })),
}));

// ─── Real local tariff-engine test server ────────────────────────────────────

interface CapturedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

type EngineHandler = (req: CapturedRequest, res: ServerResponse) => void;

let server: Server;
let engineUrl: string;
let handler: EngineHandler;
let captured: CapturedRequest[];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function assessmentResponse(key: string) {
  return {
    assessmentId: `asm-${key.slice(-12)}`,
    request: {},
    asOf: "2026-08-30",
    lines: [
      {
        lineNo: 1,
        instrument: "NPA_SHIP_DUES",
        agency: "NPA",
        applicability: "CHARGED",
        basis: "PER_GRT_BAND 20001-50000 GRT",
        statutoryReference: "NPA Act s.7",
        amountMinor: 250_000,
        currency: "USD",
      },
      {
        lineNo: 2,
        instrument: "SEA_PROTECTION_LEVY_2012",
        agency: "NIMASA",
        applicability: "CHARGED",
        basis: "PER_GRT_BAND",
        statutoryReference: "NIMASA Act s.15",
        amountMinor: 50_000,
        currency: "USD",
      },
      {
        lineNo: 3,
        instrument: "CABOTAGE_SURCHARGE",
        agency: "FMMBE",
        applicability: "EXEMPT",
        basis: "statutory exemption EX-NLING-01",
        exemptionId: "EX-NLING-01",
        amountMinor: 0,
        currency: "USD",
      },
    ],
    totalUsdMinor: 300_000,
    totalNgnMinor: 0,
    requester: "dev:dev-tariff-service-token",
    correlationId: "decl-5",
    createdAt: "2026-08-30T12:00:00.000Z",
  };
}

type AppRouter = typeof import("./routers").appRouter;
let appRouter: AppRouter;

beforeAll(async () => {
  server = createServer((req, res) => {
    void readBody(req).then((body) => {
      const entry: CapturedRequest = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body };
      captured.push(entry);
      handler(entry, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("test server did not bind");
  engineUrl = `http://127.0.0.1:${addr.port}`;

  // env.ts captures TARIFF_SERVICE_URL at module load — set it BEFORE the
  // first import of the router tree, then import dynamically.
  process.env.TARIFF_SERVICE_URL = engineUrl;
  delete process.env.TARIFF_SERVICE_TOKEN; // dev-token path (non-production)
  appRouter = (await import("./routers")).appRouter;
});

afterAll(async () => {
  delete process.env.TARIFF_SERVICE_URL;
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

function makeCtx(role = "user", userId = 42): TrpcContext {
  return {
    user: {
      id: userId, openId: `t-${role}`, email: `${role}@e.com`, name: role,
      loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const ASSESS_INPUT = {
  declarationId: 5,
  vesselGrt: 32_000,
  vesselClass: "TANKER",
  voyageType: "INTERNATIONAL",
  routeKind: "SEA",
  nigeriaPortCall: true,
  grossFreightUsdMinor: 1_250_000,
} as const;

beforeEach(() => {
  state.decl = {
    id: 5,
    declarationNumber: "TG-2026-XYZ",
    traderId: 42,
    status: "under_assessment",
    hsCode: "2710.12",
    invoiceCurrency: "USD",
    totalDue: "1150.00",
    aiExplanation: { source: "python-ml", dutyAssessment: "ESTIMATE_UNVERIFIED" },
  };
  state.updates = [];
  state.auditEvents = [];
  captured = [];
  handler = (req, res) => json(res, 201, assessmentResponse(String(req.headers["idempotency-key"] ?? "none")));
});

describe("declarations.assessDuty — tariff-engine wiring (PRA-100)", () => {
  it("replaces the flat-rate estimate with a TARIFF_ENGINE_VERIFIED assessment", async () => {
    const caller = appRouter.createCaller(makeCtx("user", 42));
    const result = await caller.declarations.assessDuty({ ...ASSESS_INPUT });

    expect(result.assessment.totalMinor).toBe(300_000);
    expect(result.assessment.dutyMinor).toBe(250_000);
    expect(result.assessment.levyMinor).toBe(50_000);
    expect(result.assessment.lines).toHaveLength(3);

    // The declaration money columns are rewritten from engine minor units.
    expect(state.updates).toHaveLength(1);
    const update = state.updates[0];
    expect(update.dutyAmount).toBe("2500.00");
    expect(update.levyAmount).toBe("500.00");
    expect(update.vatAmount).toBe("0.00");
    expect(update.totalDue).toBe("3000.00");
    const explanation = update.aiExplanation as Record<string, any>;
    expect(explanation.dutyAssessment).toBe("TARIFF_ENGINE_VERIFIED");
    expect(explanation.source).toBe("python-ml"); // prior risk explanation preserved
    expect(explanation.tariffAssessment.assessmentId).toBe(result.assessment.assessmentId);
    expect(explanation.tariffAssessment.idempotencyKey).toMatch(/^tg-decl-5-[0-9a-f]{24}$/);

    // Wire-level contract: idempotency key, correlation id, bearer auth.
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("/v1/tariffs/assess");
    expect(captured[0].headers["idempotency-key"]).toMatch(/^tg-decl-5-[0-9a-f]{24}$/);
    expect(captured[0].headers["x-correlation-id"]).toBe("decl-5");
    expect(captured[0].headers["authorization"]).toBe("Bearer dev-tariff-service-token");
    const sent = JSON.parse(captured[0].body);
    expect(sent).toMatchObject({
      vesselGrt: 32_000,
      vesselClass: "TANKER",
      entityRef: "trader:42",
      cargoCategory: "2710.12", // derived from the declaration HS code
      voyageType: "INTERNATIONAL",
      routeKind: "SEA",
      nigeriaPortCall: true,
      grossFreightUsdMinor: 1_250_000,
    });

    expect(state.auditEvents[0]).toMatchObject({ action: "tariff_assessed", entityId: 5 });
  });

  it("replays deterministically: identical reassessment reuses the idempotency key", async () => {
    const store = new Map<string, { body: string; response: unknown }>();
    handler = (req, res) => {
      const key = String(req.headers["idempotency-key"] ?? "");
      const existing = store.get(key);
      if (existing && existing.body === req.body) return json(res, 201, existing.response);
      if (existing) return json(res, 409, { error: "idempotency key conflict" });
      const response = assessmentResponse(key);
      store.set(key, { body: req.body, response });
      return json(res, 201, response);
    };
    const caller = appRouter.createCaller(makeCtx("user", 42));
    const first = await caller.declarations.assessDuty({ ...ASSESS_INPUT });
    const second = await caller.declarations.assessDuty({ ...ASSESS_INPUT });
    expect(second.assessment.assessmentId).toBe(first.assessment.assessmentId);
    expect(captured).toHaveLength(2);
    expect(captured[0].headers["idempotency-key"]).toBe(captured[1].headers["idempotency-key"]);
  });

  it("forbids non-owners without hitting the engine", async () => {
    const caller = appRouter.createCaller(makeCtx("user", 7));
    await expect(caller.declarations.assessDuty({ ...ASSESS_INPUT })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(captured).toHaveLength(0);
  });

  it("rejects assessment of non-assessable statuses without hitting the engine", async () => {
    state.decl = { ...state.decl!, status: "draft" };
    const caller = appRouter.createCaller(makeCtx("user", 42));
    await expect(caller.declarations.assessDuty({ ...ASSESS_INPUT })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(captured).toHaveLength(0);
  });

  it("refuses non-USD/NGN currencies instead of fabricating an FX conversion", async () => {
    state.decl = { ...state.decl!, invoiceCurrency: "GHS" };
    const caller = appRouter.createCaller(makeCtx("user", 42));
    await expect(caller.declarations.assessDuty({ ...ASSESS_INPUT })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("GHS"),
    });
    expect(captured).toHaveLength(0);
  });

  it("maps an engine 4xx to BAD_REQUEST with the upstream reason (no retry storm)", async () => {
    handler = (_req, res) => json(res, 400, { error: "vesselClass \"YACHT\" is not a known class" });
    const caller = appRouter.createCaller(makeCtx("customs_officer", 9));
    await expect(caller.declarations.assessDuty({ ...ASSESS_INPUT })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("YACHT"),
    });
    expect(captured).toHaveLength(1);
    expect(state.updates).toHaveLength(0); // estimate left untouched
  });

  it("maps an engine outage to SERVICE_UNAVAILABLE after bounded retries", async () => {
    handler = (_req, res) => json(res, 503, { error: "store unavailable" });
    const caller = appRouter.createCaller(makeCtx("user", 42));
    await expect(caller.declarations.assessDuty({ ...ASSESS_INPUT })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: expect.stringContaining("Tariff engine unavailable"),
    });
    // 3 bounded attempts (Go money-path policy), never a fabricated rate.
    expect(captured).toHaveLength(3);
    expect(state.updates).toHaveLength(0);
  }, 20_000);
});
