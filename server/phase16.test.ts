/**
 * phase16.test.ts — Phase 16 Wave P1 tests.
 *
 * Covers (no mocks at the HTTP boundary — a REAL local port-interop stub on
 * an ephemeral port, pcs.test.ts precedent):
 *   - pcs.portCalls.status / pcs.vessels.track / pcs.berths.occupancy:
 *     happy path against the stub, honest empty state, unconfigured
 *     fail-closed ("not_configured"), and 404 → "endpoint_not_deployed".
 *   - transshipment bonded-transfer transition map: validity and terminal
 *     states (pure logic, no DB).
 *   - AEO fast-lane ordering helpers indirectly via queue tests (DB-gated
 *     suites live in phase16.db.test.ts and skip cleanly without Postgres).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import { appRouter } from "./routers";
import { BONDED_TRANSFER_TRANSITIONS } from "./routers/transshipment";

// ─── Real local port-interop stub ────────────────────────────────────────────

type Handler = (url: string, res: ServerResponse) => void;

let server: Server;
let stubUrl: string;
let handler: Handler = (_url, res) => json(res, 404, { error: "not found" });

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

beforeAll(async () => {
  server = createServer((req, res) => handler(req.url ?? "", res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("stub did not bind");
  stubUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

const savedEnv = {
  portInteropUrl: ENV.portInteropUrl,
  portInteropToken: ENV.portInteropToken,
  keycloakTokenUrl: ENV.keycloakTokenUrl,
  portInteropClientId: ENV.portInteropClientId,
  portInteropClientSecret: ENV.portInteropClientSecret,
};

beforeEach(() => {
  handler = (_url, res) => json(res, 404, { error: "not found" });
  ENV.portInteropUrl = stubUrl;
  ENV.portInteropToken = "phase16-test-token";
  ENV.keycloakTokenUrl = "";
  ENV.portInteropClientId = "";
  ENV.portInteropClientSecret = "";
});

afterAll(() => {
  ENV.portInteropUrl = savedEnv.portInteropUrl;
  ENV.portInteropToken = savedEnv.portInteropToken;
  ENV.keycloakTokenUrl = savedEnv.keycloakTokenUrl;
  ENV.portInteropClientId = savedEnv.portInteropClientId;
  ENV.portInteropClientSecret = savedEnv.portInteropClientSecret;
});

function makeCtx(userId = 42, role = "user"): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `test-${userId}`,
      email: `trader${userId}@example.com`,
      name: `Trader ${userId}`,
      loginMethod: "keycloak",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as TrpcContext["user"],
    keycloakRoles: [],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const caller = () => appRouter.createCaller(makeCtx());

const PORT_CALL = {
  call_id: "PC-001",
  vessel_imo: "9074729",
  port_code: "NGAPP",
  declaration_reference: "TG-2026-ABC",
  submitted_by: "pcs-trader:42",
  status: "SUBMITTED",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  version: 3,
};

describe("pcs.portCalls.status (Phase 16)", () => {
  it("returns authority port calls on the happy path", async () => {
    handler = (url, res) => {
      expect(url).toContain("/v1/port-calls?port_code=NGAPP");
      json(res, 200, { port_calls: [PORT_CALL] });
    };
    const res = await caller().pcs.portCalls.status({ portCode: "NGAPP" });
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.data.portCalls).toHaveLength(1);
      expect((res.data.portCalls[0] as typeof PORT_CALL).call_id).toBe("PC-001");
    }
  });

  it("zero rows is a truthful empty state, not an outage", async () => {
    handler = (_url, res) => json(res, 200, { port_calls: [] });
    const res = await caller().pcs.portCalls.status({ portCode: "NGAPP" });
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.data.portCalls).toHaveLength(0);
  });

  it("fails closed with not_configured when PORT_INTEROP_URL is unset", async () => {
    ENV.portInteropUrl = "";
    const res = await caller().pcs.portCalls.status({ portCode: "NGAPP" });
    expect(res.status).toBe("unavailable");
    if (res.status === "unavailable") expect(res.reason).toBe("not_configured");
  });

  it("maps upstream 404 to endpoint_not_deployed (never fabricated rows)", async () => {
    handler = (_url, res) => json(res, 404, { error: "unknown route" });
    const res = await caller().pcs.portCalls.status({ portCode: "NGAPP" });
    expect(res.status).toBe("unavailable");
    if (res.status === "unavailable") expect(res.reason).toBe("endpoint_not_deployed");
  });

  it("maps an invalid upstream payload to an honest unavailable state", async () => {
    handler = (_url, res) => json(res, 200, { wrong: true });
    const res = await caller().pcs.portCalls.status({ portCode: "NGAPP" });
    expect(res.status).toBe("unavailable");
    if (res.status === "unavailable") expect(res.reason).toBe("invalid_response");
  });
});

describe("pcs.vessels.track (Phase 16)", () => {
  it("groups port calls by vessel IMO with latest status", async () => {
    handler = (_url, res) =>
      json(res, 200, {
        port_calls: [
          PORT_CALL,
          { ...PORT_CALL, call_id: "PC-002", status: "ACCEPTED", updated_at: "2026-01-03T00:00:00.000Z", version: 4 },
          { ...PORT_CALL, call_id: "PC-003", vessel_imo: "1234567" },
        ],
      });
    const res = await caller().pcs.vessels.track({ portCode: "NGAPP" });
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      const vessels = res.data.vessels as Array<{ vesselImo: string; latestStatus: string; portCalls: unknown[] }>;
      expect(vessels).toHaveLength(2);
      const v1 = vessels.find((v) => v.vesselImo === "9074729")!;
      expect(v1.latestStatus).toBe("ACCEPTED");
      expect(v1.portCalls).toHaveLength(2);
    }
  });

  it("never fabricates vessels when unconfigured", async () => {
    ENV.portInteropUrl = "";
    const res = await caller().pcs.vessels.track({ portCode: "NGAPP" });
    expect(res.status).toBe("unavailable");
  });
});

describe("pcs.berths.occupancy (Phase 16)", () => {
  it("returns berth rows on the happy path", async () => {
    handler = (url, res) => {
      expect(url).toContain("/v1/berths?port_code=NGAPP");
      json(res, 200, {
        berths: [
          { berth_id: "B-01", port_code: "NGAPP", status: "OCCUPIED", vessel_imo: "9074729", call_id: "PC-001", updated_at: "2026-01-02T00:00:00.000Z" },
          { berth_id: "B-02", port_code: "NGAPP", status: "FREE" },
        ],
      });
    };
    const res = await caller().pcs.berths.occupancy({ portCode: "NGAPP" });
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.data.berths).toHaveLength(2);
  });

  it("maps upstream 404 to endpoint_not_deployed", async () => {
    const res = await caller().pcs.berths.occupancy({ portCode: "NGAPP" });
    expect(res.status).toBe("unavailable");
    if (res.status === "unavailable") expect(res.reason).toBe("endpoint_not_deployed");
  });

  it("rejects malformed berth payloads honestly", async () => {
    handler = (_url, res) => json(res, 200, { berths: [{ port_code: "NGAPP" }] });
    const res = await caller().pcs.berths.occupancy({ portCode: "NGAPP" });
    expect(res.status).toBe("unavailable");
    if (res.status === "unavailable") expect(res.reason).toBe("invalid_response");
  });
});

describe("transshipment bonded transfer transitions (Phase 16)", () => {
  it("walks the happy path initiated → in_transit → arrived_bond → under_supervision → released → completed", () => {
    const chain = ["initiated", "in_transit", "arrived_bond", "under_supervision", "released", "completed"];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(BONDED_TRANSFER_TRANSITIONS[chain[i]]).toContain(chain[i + 1]);
    }
  });

  it("terminal states allow no further transitions", () => {
    expect(BONDED_TRANSFER_TRANSITIONS.completed).toEqual([]);
    expect(BONDED_TRANSFER_TRANSITIONS.cancelled).toEqual([]);
  });

  it("cancellation is only possible before bonded arrival", () => {
    expect(BONDED_TRANSFER_TRANSITIONS.initiated).toContain("cancelled");
    expect(BONDED_TRANSFER_TRANSITIONS.in_transit).toContain("cancelled");
    expect(BONDED_TRANSFER_TRANSITIONS.arrived_bond).not.toContain("cancelled");
    expect(BONDED_TRANSFER_TRANSITIONS.under_supervision).not.toContain("cancelled");
  });

  it("skipping states is impossible", () => {
    expect(BONDED_TRANSFER_TRANSITIONS.initiated).not.toContain("released");
    expect(BONDED_TRANSFER_TRANSITIONS.in_transit).not.toContain("completed");
  });
});
