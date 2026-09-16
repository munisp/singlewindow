/**
 * shorePass.test.ts — Phase 19 (F5a / A5-C5) shore-pass lifecycle router.
 *
 * Covers: FAL5-pattern application validation, the SUBMITTED→APPROVED/
 * REJECTED→REVOKED/EXPIRED state machine, the verification-gated approval
 * (fail closed), the honest CREW_REGISTRY_NOT_CONFIGURED state when the
 * upstream seafarer/STCW registry is not configured, lazy + sweep expiry,
 * and the append-only audit trail.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createMockDrizzleDb, type MockStore } from "../testutils/mockDrizzleDb";

const store: MockStore = {};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => createMockDrizzleDb(store)),
  logAuditEvent: vi.fn(async () => {}),
}));

import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

function makeCtx(role = "user", userId = 42): TrpcContext {
  return {
    user: {
      id: userId, openId: `t-${role}-${userId}`, email: `${role}@e.com`, name: role,
      loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const APPLY_INPUT = {
  vesselImoNumber: "9074729",
  voyageNumber: "V-2026-014",
  portCode: "NGLOS",
  crew: {
    familyName: "OKAFOR",
    givenNames: "CHINEDU",
    nationalityCode: "NG",
    rankOrRating: "Chief Officer",
    dateOfBirth: "1988-04-17",
  },
  purpose: "Medical appointment ashore",
  stcwCertificateNumber: "NG-STCW-1234",
};

function stubRegistry(outcome: string, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      status === 200
        ? new Response(
            JSON.stringify({ certificateNumber: "NG-STCW-1234", outcome, certificateType: "STCW-II/1" }),
            { status: 200 }
          )
        : new Response("boom", { status })
    )
  );
}

async function applyAs(userId = 42) {
  const caller = appRouter.createCaller(makeCtx("user", userId));
  const res = await caller.shorePass.submit(APPLY_INPUT);
  return res.application as any;
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  process.env.PORT_INTEROP_URL = "http://registry.test";
  process.env.PORT_INTEROP_TOKEN = "test-token";
  stubRegistry("VALID");
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PORT_INTEROP_URL;
  delete process.env.PORT_INTEROP_TOKEN;
});

describe("shorePass.submit", () => {
  it("creates a SUBMITTED application with an audit event", async () => {
    const app = await applyAs();
    expect(app.status).toBe("SUBMITTED");
    expect(app.verificationStatus).toBe("NOT_REQUESTED");
    expect(app.applicationNumber).toMatch(/^SP-\d{4}-[0-9A-F]{8}$/);
    expect(store.shore_pass_events).toHaveLength(1);
    expect(store.shore_pass_events[0]).toMatchObject({ action: "submitted", toStatus: "SUBMITTED" });
  });

  it.each([
    [{ vesselImoNumber: "123" }, "IMO"],
    [{ vesselImoNumber: "907472A" }, "IMO"],
    [{ portCode: "LGS" }, "port"],
    [{ crew: { ...APPLY_INPUT.crew, nationalityCode: "NGA" } }, "nationality"],
    [{ crew: { ...APPLY_INPUT.crew, dateOfBirth: "17/04/1988" } }, "dob"],
  ])("rejects malformed FAL5 fields (%s)", async (patch, _label) => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.shorePass.submit({ ...APPLY_INPUT, ...patch } as any)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(store.shore_pass_applications ?? []).toHaveLength(0);
  });
});

describe("shorePass.verifyCertificate + decide (verification-gated approval)", () => {
  it("VERIFIED certificate → officer can approve with validity window", async () => {
    const app = await applyAs();
    const officer = appRouter.createCaller(makeCtx("customs_officer", 7));
    const v = await officer.shorePass.verifyCertificate({ applicationId: app.id });
    expect(v).toEqual({ verificationStatus: "VERIFIED", outcome: "VALID" });
    const until = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const d = await officer.shorePass.decide({ applicationId: app.id, approve: true, validUntil: until });
    expect(d.status).toBe("APPROVED");
    const actions = store.shore_pass_events.map((e: any) => e.action);
    expect(actions).toEqual(["submitted", "certificate_verified", "approved"]);
  });

  it("blocks approval while verification is outstanding (fail closed)", async () => {
    const app = await applyAs();
    const officer = appRouter.createCaller(makeCtx("customs_officer", 7));
    await expect(
      officer.shorePass.decide({
        applicationId: app.id,
        approve: true,
        validUntil: new Date(Date.now() + 3600_000).toISOString(),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(store.shore_pass_applications[0].status).toBe("SUBMITTED");
  });

  it("non-VALID registry outcome → FAILED, approval permanently blocked", async () => {
    stubRegistry("EXPIRED");
    const app = await applyAs();
    const officer = appRouter.createCaller(makeCtx("customs_officer", 7));
    const v = await officer.shorePass.verifyCertificate({ applicationId: app.id });
    expect(v).toEqual({ verificationStatus: "FAILED", outcome: "EXPIRED" });
    await expect(
      officer.shorePass.decide({
        applicationId: app.id,
        approve: true,
        validUntil: new Date(Date.now() + 3600_000).toISOString(),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("honest NOT_CONFIGURED state when the seafarer registry is not configured", async () => {
    delete process.env.PORT_INTEROP_URL;
    const app = await applyAs();
    const officer = appRouter.createCaller(makeCtx("customs_officer", 7));
    await expect(officer.shorePass.verifyCertificate({ applicationId: app.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("CREW_REGISTRY_NOT_CONFIGURED"),
    });
    expect(store.shore_pass_applications[0].verificationStatus).toBe("NOT_CONFIGURED");
    await expect(
      officer.shorePass.decide({
        applicationId: app.id,
        approve: true,
        validUntil: new Date(Date.now() + 3600_000).toISOString(),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("upstream unreachable → honest UNAVAILABLE, verification NOT performed", async () => {
    stubRegistry("", 503);
    const app = await applyAs();
    const officer = appRouter.createCaller(makeCtx("customs_officer", 7));
    await expect(officer.shorePass.verifyCertificate({ applicationId: app.id })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: expect.stringContaining("CREW_REGISTRY_UNAVAILABLE"),
    });
    expect(store.shore_pass_applications[0].verificationStatus).toBe("NOT_CONFIGURED");
  });

  it("rejects approve without validUntil and reject without reason", async () => {
    const caller = appRouter.createCaller(makeCtx("user", 42));
    const res = await caller.shorePass.submit({ ...APPLY_INPUT, stcwCertificateNumber: null });
    const officer = appRouter.createCaller(makeCtx("customs_officer", 7));
    await expect(officer.shorePass.decide({ applicationId: res.application.id, approve: true })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(officer.shorePass.decide({ applicationId: res.application.id, approve: false })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("cert-free applications (NOT_REQUESTED) can be decided on FAL5 data alone", async () => {
    const caller = appRouter.createCaller(makeCtx("user", 42));
    const res = await caller.shorePass.submit({ ...APPLY_INPUT, stcwCertificateNumber: undefined });
    const officer = appRouter.createCaller(makeCtx("customs_officer", 7));
    const d = await officer.shorePass.decide({
      applicationId: res.application.id,
      approve: true,
      validUntil: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(d.status).toBe("APPROVED");
  });

  it("non-officers cannot verify or decide", async () => {
    const app = await applyAs();
    const trader = appRouter.createCaller(makeCtx("user", 42));
    await expect(trader.shorePass.verifyCertificate({ applicationId: app.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      trader.shorePass.decide({ applicationId: app.id, approve: false, reason: "x" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("shorePass revoke + expiry", () => {
  async function approvedApp() {
    const app = await applyAs();
    const officer = appRouter.createCaller(makeCtx("customs_officer", 7));
    await officer.shorePass.verifyCertificate({ applicationId: app.id });
    await officer.shorePass.decide({
      applicationId: app.id,
      approve: true,
      validUntil: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    });
    return { app, officer };
  }

  it("officer revokes an APPROVED pass with reason; revocation is audited", async () => {
    const { app, officer } = await approvedApp();
    const r = await officer.shorePass.revoke({ applicationId: app.id, reason: "Crew member hospitalised" });
    expect(r.status).toBe("REVOKED");
    expect(store.shore_pass_events.map((e: any) => e.action)).toContain("revoked");
    await expect(
      officer.shorePass.decide({ applicationId: app.id, approve: true, validUntil: new Date().toISOString() })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lazy expiry: an APPROVED pass past validUntil reads as EXPIRED and is audited", async () => {
    const { app, officer } = await approvedApp();
    store.shore_pass_applications[0].validUntil = new Date(Date.now() - 1000);
    const got = await officer.shorePass.get({ applicationId: app.id });
    expect(got.application.status).toBe("EXPIRED");
    expect(store.shore_pass_events.map((e: any) => e.action)).toContain("expired");
  });

  it("expireSweep expires only lapsed passes", async () => {
    const { app, officer } = await approvedApp();
    const fresh = await applyAs(43);
    void fresh;
    store.shore_pass_applications[0].validUntil = new Date(Date.now() - 1000);
    const res = await officer.shorePass.expireSweep();
    expect(res).toEqual({ scanned: 1, expired: 1 });
    expect(store.shore_pass_applications[0].status).toBe("EXPIRED");
  });

  it("owner reads own application + trail; strangers are refused", async () => {
    const app = await applyAs();
    const owner = appRouter.createCaller(makeCtx("user", 42));
    const got = await owner.shorePass.get({ applicationId: app.id });
    expect(got.events).toHaveLength(1);
    const stranger = appRouter.createCaller(makeCtx("user", 99));
    await expect(stranger.shorePass.get({ applicationId: app.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
