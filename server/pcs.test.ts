/**
 * pcs.test.ts — Phase 8 PCS router tests.
 *
 * The port-interop upstream is a REAL local HTTP server (node:http, ephemeral
 * port — tariffClient.test.ts precedent; no fetch mocks). The database is the
 * only mocked boundary, through the dbPcs helper seam (db-helper mock pattern
 * per tariffAssessment.test.ts). Covers: down-vs-empty taxonomy, ownership
 * regression (trader A cannot read trader B's consignment/booking), live
 * booking initiation (success, idempotent replay, upstream 4xx/5xx mapping,
 * unconfigured fail-closed), provenance honesty (every rendered milestone
 * carries source_event_id), and billing lag labelling.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";

// ─── dbPcs mock (state-driven) ───────────────────────────────────────────────

const state = {
  dbDown: false,
  consignments: [] as Array<Record<string, unknown>>,
  milestones: [] as Array<Record<string, unknown>>,
  bookingLinks: [] as Array<Record<string, unknown>>,
  declarations: [] as Array<{ id: number; declarationNumber: string }>,
  billing: [] as Array<Record<string, unknown>>,
  documents: [] as Array<Record<string, unknown>>,
  notifPrefs: [] as Array<{ notificationType: string; channel: string; enabled: boolean }>,
  upserts: 0,
  insertedLinks: [] as Array<Record<string, unknown>>,
};

vi.mock("./dbPcs", () => ({
  listPcsConsignmentsForTrader: vi.fn(async (traderId: number, opts: { limit: number; offset: number }) => {
    if (state.dbDown) return { down: true };
    const mine = state.consignments.filter((c) => c.traderUserId === traderId);
    return { down: false, value: { rows: mine.slice(opts.offset, opts.offset + opts.limit), nextCursor: null } };
  }),
  getPcsConsignmentForTrader: vi.fn(async (traderId: number, id: number) => {
    if (state.dbDown) return { down: true };
    return { down: false, value: state.consignments.find((c) => c.id === id && c.traderUserId === traderId) ?? null };
  }),
  listPcsMilestones: vi.fn(async (consignmentId: number) => {
    if (state.dbDown) return { down: true };
    return { down: false, value: state.milestones.filter((m) => m.consignmentId === consignmentId) };
  }),
  linkPcsConsignmentDeclaration: vi.fn(async (id: number, urn: string) => {
    if (state.dbDown) return { down: true };
    const c = state.consignments.find((x) => x.id === id);
    if (c) c.declarationUrn = urn;
    return { down: false, value: c ?? null };
  }),
  findOwnedDeclaration: vi.fn(async (traderId: number, urn: string) => {
    if (state.dbDown) return { down: true };
    void traderId;
    return { down: false, value: state.declarations.find((d) => d.declarationNumber === urn) ?? null };
  }),
  listPcsBookingLinksForTrader: vi.fn(async (traderId: number) => {
    if (state.dbDown) return { down: true };
    return { down: false, value: state.bookingLinks.filter((l) => l.traderUserId === traderId) };
  }),
  findPcsBookingLinkForTrader: vi.fn(async (traderId: number, bookingId: string) => {
    if (state.dbDown) return { down: true };
    return { down: false, value: state.bookingLinks.find((l) => l.bookingId === bookingId && l.traderUserId === traderId) ?? null };
  }),
  insertPcsBookingLink: vi.fn(async (values: Record<string, unknown>) => {
    if (state.dbDown) return { down: true };
    state.insertedLinks.push(values);
    return { down: false, value: undefined };
  }),
  listPcsBillingSnapshotsForBookings: vi.fn(async (bookingIds: string[]) => {
    if (state.dbDown) return { down: true };
    return { down: false, value: state.billing.filter((b) => bookingIds.includes(b.bookingId as string)) };
  }),
  findPcsBillingSnapshotForBookings: vi.fn(async (bookingIds: string[], id: string) => {
    if (state.dbDown) return { down: true };
    return {
      down: false,
      value: state.billing.find((b) => bookingIds.includes(b.bookingId as string) && (b.invoiceId === id || b.receiptId === id)) ?? null,
    };
  }),
  listPcsDocuments: vi.fn(async () => {
    if (state.dbDown) return { down: true };
    return { down: false, value: state.documents };
  }),
  listPcsNotificationPreferences: vi.fn(async () => {
    if (state.dbDown) return { down: true };
    return { down: false, value: state.notifPrefs };
  }),
  upsertPcsNotificationPreference: vi.fn(async () => {
    if (state.dbDown) return { down: true };
    state.upserts++;
    return { down: false, value: undefined };
  }),
}));

// documentVault's upload path touches RustFS/ClamAV — the share procedure is
// covered by delegating to the shared helper, mocked here to observe routing.
vi.mock("./routers/documentVault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routers/documentVault")>();
  return {
    ...actual,
    uploadVaultDocument: vi.fn(async (ownerId: number, input: Record<string, unknown>) => ({
      id: 501,
      ownerId,
      ...input,
      fileData: undefined,
      status: "active",
    })),
  };
});

import { appRouter } from "./routers";

// ─── Real local port-interop stub ────────────────────────────────────────────

interface CapturedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

type Handler = (req: CapturedRequest, res: ServerResponse) => void;

let server: Server;
let stubUrl: string;
let handler: Handler = (_req, res) => json(res, 404, { error: "not found" });
let captured: CapturedRequest[] = [];

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
  state.dbDown = false;
  state.consignments = [];
  state.milestones = [];
  state.bookingLinks = [];
  state.declarations = [];
  state.billing = [];
  state.documents = [];
  state.notifPrefs = [];
  state.upserts = 0;
  state.insertedLinks = [];
  captured = [];
  handler = (_req, res) => json(res, 404, { error: "not found" });
  // Static token auth against the local stub; no Keycloak env (unique token
  // per test is unnecessary — the client cache key includes baseUrl+token).
  ENV.portInteropUrl = stubUrl;
  ENV.portInteropToken = "pcs-test-token";
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

// ─── Context factories ───────────────────────────────────────────────────────

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

function makePublicCtx(): TrpcContext {
  return {
    user: null,
    keycloakRoles: [],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function sampleBooking(id: string) {
  return {
    booking_id: id,
    tenant_id: "t1",
    request_id: `req-${id}`,
    truck_plate: "KJA-1234",
    trucker_msisdn: "+2348012345678",
    terminal_id: "TIN-CT1",
    channel: "WEB",
    status: "PAID",
    amount_kobo: 4500000,
    currency: "NGN",
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:05:00.000Z",
    expires_at: "2026-09-02T10:00:00.000Z",
    version: 3,
  };
}

// ─── Auth gate ───────────────────────────────────────────────────────────────

describe("pcs — authentication", () => {
  it("rejects unauthenticated callers", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(caller.pcs.myConsignments.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.pcs.bookings.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.pcs.ports.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─── Reference data ──────────────────────────────────────────────────────────

describe("pcs.ports.list", () => {
  it("returns the versioned UN/LOCODE subset", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.ports.list();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.version).toMatch(/^2026\./);
    expect(result.data.ports.length).toBeGreaterThan(0);
    expect(result.data.ports[0].code).toMatch(/^NG/);
  });
});

// ─── Consignments: down-vs-empty + ownership ─────────────────────────────────

describe("pcs.myConsignments", () => {
  it("returns truthful EMPTY when the trader has no consignments", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.myConsignments.list({});
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.consignments).toEqual([]);
    expect(result.gaps.map((g) => g.id)).toContain("GAP-PCS-AIS");
  });

  it("returns UNAVAILABLE (never fabricated rows) when the read model is down", async () => {
    state.dbDown = true;
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.myConsignments.list({});
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toBe("database_unavailable");
  });

  it("timeline enforces ownership: trader A cannot read trader B's consignment", async () => {
    state.consignments = [{ id: 7, traderUserId: 99, blNumber: "BL-1" }];
    const callerA = appRouter.createCaller(makeCtx(42));
    await expect(callerA.pcs.myConsignments.timeline({ consignmentId: 7 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("timeline returns milestones ordered with provenance on every row", async () => {
    state.consignments = [{ id: 7, traderUserId: 42, blNumber: "BL-1" }];
    state.milestones = [
      {
        id: 2, consignmentId: 7, milestone: "customs_released",
        occurredAt: new Date("2026-09-01T12:00:00Z"), sourceTopic: "ports.booking.v1",
        sourceEventId: "e-2", provenanceSignatureVerified: true,
      },
      {
        id: 1, consignmentId: 7, milestone: "customs_hold",
        occurredAt: new Date("2026-09-01T09:00:00Z"), sourceTopic: "ports.booking.v1",
        sourceEventId: "e-1", provenanceSignatureVerified: true,
      },
    ];
    const caller = appRouter.createCaller(makeCtx(42));
    const result = await caller.pcs.myConsignments.timeline({ consignmentId: 7 });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const milestones = result.data.milestones as Array<{ id: number; sourceEventId?: string; sourceTopic?: string }>;
    expect(milestones.map((m) => m.id)).toEqual([1, 2]); // occurred_at ASC
    // Honesty regression: no milestone renders without provenance.
    for (const m of milestones) {
      expect(m.sourceEventId).toBeTruthy();
      expect(m.sourceTopic).toBeTruthy();
    }
    expect(result.gaps.map((g) => g.id)).toEqual(expect.arrayContaining(["GAP-PCS-AIS", "GAP-PCS-BERTH-OPS"]));
  });

  it("linkDeclaration refuses another trader's declaration reference", async () => {
    state.consignments = [{ id: 7, traderUserId: 42, blNumber: "BL-1" }];
    state.declarations = []; // the URN exists for nobody → rejected
    const caller = appRouter.createCaller(makeCtx(42));
    await expect(
      caller.pcs.myConsignments.linkDeclaration({ consignmentId: 7, urn: "DECL-2026-0001" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("linkDeclaration refuses a consignment owned by another trader", async () => {
    state.consignments = [{ id: 7, traderUserId: 99, blNumber: "BL-1" }];
    const caller = appRouter.createCaller(makeCtx(42));
    await expect(
      caller.pcs.myConsignments.linkDeclaration({ consignmentId: 7, urn: "DECL-2026-0001" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("linkDeclaration links an owned declaration", async () => {
    state.consignments = [{ id: 7, traderUserId: 42, blNumber: "BL-1" }];
    state.declarations = [{ id: 3, declarationNumber: "DECL-2026-0001" }];
    const caller = appRouter.createCaller(makeCtx(42));
    const updated = await caller.pcs.myConsignments.linkDeclaration({ consignmentId: 7, urn: "DECL-2026-0001" });
    expect(updated).toMatchObject({ id: 7, declarationUrn: "DECL-2026-0001" });
  });
});

// ─── Vessel visits (read-through) ────────────────────────────────────────────

describe("pcs.vesselVisits.forMyCargo", () => {
  it("returns EMPTY with the port-call linkage gap when nothing is linked", async () => {
    state.consignments = [{ id: 7, traderUserId: 42, portCallId: null }];
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.vesselVisits.forMyCargo({});
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.visits).toEqual([]);
    expect(result.data.unlinkedConsignments).toBe(1);
    expect(result.gaps.map((g) => g.id)).toContain("GAP-PCS-PORTCALL-LINKAGE");
  });

  it("read-throughs authority port calls for linked consignments", async () => {
    state.consignments = [{ id: 7, traderUserId: 42, portCallId: "pc-1", portCode: "NGAPP" }];
    handler = (req, res) => {
      if (req.url === "/v1/port-calls/pc-1") {
        return json(res, 200, {
          call_id: "pc-1", vessel_imo: "9074729", port_code: "NGAPP",
          declaration_reference: "DECL/2026/0001", submitted_by: "agent:1",
          status: "ACCEPTED", created_at: "2026-09-01T08:00:00.000Z",
          updated_at: "2026-09-01T09:00:00.000Z", version: 2,
        });
      }
      json(res, 404, { error: "not found" });
    };
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.vesselVisits.forMyCargo({});
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const visits = result.data.visits as Array<{ portCall: { call_id: string }; provenance: { recordVersion: number } }>;
    expect(visits).toHaveLength(1);
    expect(visits[0].portCall.call_id).toBe("pc-1");
    expect(visits[0].provenance.recordVersion).toBe(2);
    // The AIS gap is ALWAYS disclosed — no vessel positions are synthesized.
    expect(result.gaps.map((g) => g.id)).toContain("GAP-PCS-AIS");
  });

  it("returns UNAVAILABLE when port-interop is down (never zeros)", async () => {
    state.consignments = [{ id: 7, traderUserId: 42, portCallId: "pc-1" }];
    handler = (_req, res) => json(res, 500, { error: "boom" });
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.vesselVisits.forMyCargo({});
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toBe("upstream_5xx");
  });
});

// ─── Bookings ────────────────────────────────────────────────────────────────

describe("pcs.bookings", () => {
  it("list returns truthful EMPTY when the trader has no booking links", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.bookings.list();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.bookings).toEqual([]);
    expect(result.gaps).toEqual([]); // booking initiation is LIVE — no gap disclosure
  });

  it("list read-throughs linked bookings from port-interop", async () => {
    state.bookingLinks = [{ id: 1, traderUserId: 42, bookingId: "bk-1", consignmentId: null, createdVia: "pcs" }];
    handler = (req, res) => {
      if (req.url === "/v1/bookings/bk-1") return json(res, 200, sampleBooking("bk-1"));
      json(res, 404, { error: "not found" });
    };
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.bookings.list();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const bookings = result.data.bookings as Array<{ booking: { booking_id: string } }>;
    expect(bookings).toHaveLength(1);
    expect(bookings[0].booking.booking_id).toBe("bk-1");
    expect(captured[0].headers.authorization).toBe("Bearer pcs-test-token");
  });

  it("list is DOWN (not empty) when every upstream call fails", async () => {
    state.bookingLinks = [{ id: 1, traderUserId: 42, bookingId: "bk-1", consignmentId: null, createdVia: "pcs" }];
    handler = (_req, res) => json(res, 503, {});
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.bookings.list();
    expect(result.status).toBe("unavailable");
  });

  it("detail enforces ownership via the booking link (trader A vs trader B)", async () => {
    state.bookingLinks = [{ id: 1, traderUserId: 99, bookingId: "bk-1", consignmentId: null, createdVia: "pcs" }];
    const callerA = appRouter.createCaller(makeCtx(42));
    await expect(callerA.pcs.bookings.detail({ bookingId: "bk-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(captured).toHaveLength(0); // upstream never queried for a foreign booking
  });

  it("detail returns booking + observer with labelled partial state", async () => {
    state.bookingLinks = [{ id: 1, traderUserId: 42, bookingId: "bk-1", consignmentId: null, createdVia: "pcs" }];
    handler = (req, res) => {
      if (req.url === "/v1/bookings/bk-1") return json(res, 200, sampleBooking("bk-1"));
      if (req.url === "/v1/bookings/bk-1/observer") return json(res, 404, { error: "no workflow" });
      json(res, 404, {});
    };
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.bookings.detail({ bookingId: "bk-1" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.booking.booking_id).toBe("bk-1");
    expect(result.data.observer).toBeNull();
    expect(result.data.observerUnavailable).toBeTruthy(); // labelled, never fabricated
  });

  it("request fails CLOSED with a typed UNCONFIGURED error when port-interop is not configured", async () => {
    ENV.portInteropUrl = "";
    ENV.portInteropToken = "";
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.pcs.bookings.request({
        terminalId: "TIN-CT1",
        slotWindow: { startsAt: "2026-09-02T08:00:00.000Z", endsAt: "2026-09-03T08:00:00.000Z" },
        truckPlate: "KJA-1234",
        truckerMsisdn: "+2348012345678",
        amountKobo: 4500000,
      })
    ).rejects.toThrow(/PORT_INTEROP_UNCONFIGURED/);
    expect(captured).toHaveLength(0); // no upstream call when unconfigured
    expect(state.insertedLinks).toHaveLength(0);
  });

  it("request routes to port-interop with a server idempotency key and records the link", async () => {
    handler = (req, res) => {
      if (req.url === "/v1/bookings" && req.method === "POST") {
        return json(res, 201, sampleBooking("bk-new"));
      }
      json(res, 404, {});
    };
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.bookings.request({
      terminalId: "TIN-CT1",
      slotWindow: { startsAt: "2026-09-02T08:00:00.000Z", endsAt: "2026-09-03T08:00:00.000Z" },
      truckPlate: "KJA-1234",
      truckerMsisdn: "+2348012345678",
      amountKobo: 4500000,
    });
    expect(result.booking.booking_id).toBe("bk-new");
    const post = captured.find((r) => r.url === "/v1/bookings");
    expect(post).toBeTruthy();
    const body = JSON.parse(post!.body);
    expect(body.request_id).toBe(result.requestId);
    expect(post!.headers["idempotency-key"]).toBe(result.requestId);
    expect(state.insertedLinks).toEqual([
      { traderUserId: 42, bookingId: "bk-new", consignmentId: null, createdVia: "pcs" },
    ]);
  });

  it("request surfaces upstream 4xx verbatim as BAD_REQUEST", async () => {
    handler = (_req, res) => json(res, 409, { error: "request id conflicts with a retained booking" });
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.pcs.bookings.request({
        terminalId: "TIN-CT1",
        slotWindow: { startsAt: "2026-09-02T08:00:00.000Z", endsAt: "2026-09-03T08:00:00.000Z" },
        truckPlate: "KJA-1234",
        truckerMsisdn: "+2348012345678",
        amountKobo: 4500000,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.insertedLinks).toHaveLength(0);
  });

  it("request maps upstream 5xx to SERVICE_UNAVAILABLE (never a fake booking)", async () => {
    handler = (_req, res) => json(res, 502, { error: "bad gateway" });
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.pcs.bookings.request({
        terminalId: "TIN-CT1",
        slotWindow: { startsAt: "2026-09-02T08:00:00.000Z", endsAt: "2026-09-03T08:00:00.000Z" },
        truckPlate: "KJA-1234",
        truckerMsisdn: "+2348012345678",
        amountKobo: 4500000,
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(state.insertedLinks).toHaveLength(0);
  });

  it("idempotent replay: an exact retry carries the same request_id and replays to the same booking", async () => {
    const seen = new Map<string, string>();
    handler = (req, res) => {
      if (req.url === "/v1/bookings" && req.method === "POST") {
        const body = JSON.parse(req.body);
        // Emulate the port-interop idempotency contract: replay on request_id.
        if (!seen.has(body.request_id)) seen.set(body.request_id, `bk-${seen.size + 1}`);
        const booking = sampleBooking(seen.get(body.request_id)!);
        booking.request_id = body.request_id;
        return json(res, 200, booking);
      }
      json(res, 404, {});
    };
    const caller = appRouter.createCaller(makeCtx());
    const input = {
      terminalId: "TIN-CT1",
      slotWindow: { startsAt: "2026-09-02T08:00:00.000Z", endsAt: "2026-09-03T08:00:00.000Z" },
      truckPlate: "KJA-1234",
      truckerMsisdn: "+2348012345678",
      amountKobo: 4500000,
    };
    const first = await caller.pcs.bookings.request(input);
    const second = await caller.pcs.bookings.request(input);
    expect(second.requestId).toBe(first.requestId);
    expect(second.booking.booking_id).toBe(first.booking.booking_id); // replay → same booking
    const posts = captured.filter((r) => r.url === "/v1/bookings" && r.method === "POST");
    expect(posts).toHaveLength(2);
    expect(JSON.parse(posts[0].body).request_id).toBe(JSON.parse(posts[1].body).request_id);
  });
});

// ─── Billing ─────────────────────────────────────────────────────────────────

describe("pcs.billing", () => {
  it("list returns EMPTY + tariff gap when the trader has no bookings", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.billing.list({});
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.snapshots).toEqual([]);
    expect(result.gaps.map((g) => g.id)).toContain("GAP-PCS-TARIFF");
  });

  it("list returns lag-labelled projections for linked bookings only", async () => {
    state.bookingLinks = [{ id: 1, traderUserId: 42, bookingId: "bk-1" }];
    state.billing = [
      {
        id: 1, bookingId: "bk-1", invoiceId: null, amountKobo: 4500000, currency: "NGN",
        status: "PAID", receiptId: "rcpt-77", ledgerCommitHash: "tb-99",
        projectionLagMs: 1200, sourceEventId: "e-1", occurredAt: new Date(),
      },
      { id: 2, bookingId: "bk-OTHER", amountKobo: 1, status: "PAID", receiptId: "rcpt-X" }, // not linked to trader 42
    ];
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.billing.list({});
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const snapshots = result.data.snapshots as Array<{ bookingId: string; projectionLagMs: number }>;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].bookingId).toBe("bk-1");
    expect(snapshots[0].projectionLagMs).toBe(1200);
  });

  it("receipt is trader-scoped and projection-sourced with the read-through gap", async () => {
    state.bookingLinks = [{ id: 1, traderUserId: 42, bookingId: "bk-1" }];
    state.billing = [
      { id: 1, bookingId: "bk-1", status: "PAID", receiptId: "rcpt-77", projectionLagMs: 900, ledgerCommitHash: "tb-99" },
    ];
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.billing.receipt({ invoiceId: "rcpt-77" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.gaps.map((g) => g.id)).toEqual(expect.arrayContaining(["GAP-PCS-TARIFF", "GAP-PCS-RECEIPT-READTHROUGH"]));
    // Another trader's receipt id is invisible.
    await expect(caller.pcs.billing.receipt({ invoiceId: "rcpt-OTHER" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── Documents + notifications ───────────────────────────────────────────────

describe("pcs.documents", () => {
  it("inbox lists only PCS categories and supports the empty state", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.documents.inbox({});
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.documents).toEqual([]);
  });

  it("share routes through the shared vault write path with a PCS category", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const record = await caller.pcs.documents.share({
      filename: "delivery-order.pdf",
      contentType: "application/pdf",
      fileData: Buffer.from("pdf").toString("base64"),
      sizeBytes: 3,
      category: "delivery_order",
    });
    expect(record).toMatchObject({ id: 501, ownerId: 42, category: "delivery_order", accessLevel: "shared_with_customs" });
  });

  it("share rejects non-PCS categories at the schema edge", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.pcs.documents.share({
        filename: "invoice.pdf",
        contentType: "application/pdf",
        fileData: Buffer.from("pdf").toString("base64"),
        sizeBytes: 3,
        // @ts-expect-error — non-PCS category must be rejected by validation
        category: "commercial_invoice",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("pcs.notifications", () => {
  it("preferences returns the four PCS event types with defaults", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.notifications.preferences();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const prefs = result.data.preferences as Array<{ eventType: string }>;
    expect(prefs.map((p) => p.eventType)).toEqual([
      "pcs_booking_confirmed", "pcs_gate_window", "pcs_berth_change", "pcs_invoice_issued",
    ]);
  });

  it("subscribe upserts channel preferences per event type", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.pcs.notifications.subscribe({
      eventTypes: ["pcs_booking_confirmed", "pcs_invoice_issued"],
      channels: ["email", "push"],
      enabled: true,
    });
    expect(result).toMatchObject({ success: true, updated: 4 });
    expect(state.upserts).toBe(4);
  });
});
