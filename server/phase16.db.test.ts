/**
 * phase16.db.test.ts — REAL DB-gated integration tests for Phase 16 Wave P1:
 * migration 0069 (declaration_type 'transshipment', fast-lane columns,
 * transshipment_links + bonded_transfers tables), the transshipment router
 * (manifest coupling validation, append-only bonded transfer transitions) and
 * the AEO fast-lane router (queue prioritization, drawback fast-track).
 *
 * Skips cleanly with a printed reason when PostgreSQL is unavailable
 * (pgTestHarness precedent) — never a fake pass.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "./testutils/pgTestHarness";
import type { TrpcContext } from "./_core/context";
import {
  declarations,
  dutyDrawbackClaims,
  manifests,
  stakeholderProfiles,
  users,
} from "../drizzle/schema";

const tdb = await createTestDatabase("phase16");
if (tdb) process.env.DATABASE_URL = tdb.url;
const describeDb = tdb ? describe : describe.skip;

// Lazy imports: DATABASE_URL must point at the cloned template BEFORE any
// module that initializes the db pool is loaded (import side-effects in the
// router graph cache a null DB otherwise).
const { closePool, getDb } = await import("./db");
const { appRouter } = await import("./routers");

afterAll(async () => {
  await closePool();
  await tdb?.close();
});

let seq = 0;
async function seedUser(role: "user" | "admin" | "customs_officer" = "user") {
  const db = (await getDb())!;
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({ openId: `phase16-${Date.now()}-${seq}`, name: `P16 User ${seq}`, role })
    .returning();
  return u;
}

async function seedProfile(userId: number, aeoStatus: "none" | "certified", aeoTier?: "gold" | "silver") {
  const db = (await getDb())!;
  await db.insert(stakeholderProfiles).values({
    userId,
    stakeholderType: "trader",
    organizationName: `Org ${userId}`,
    status: "approved",
    aeoStatus,
    aeoTier: aeoTier ?? (aeoStatus === "certified" ? "standard" : null),
  });
}

async function seedManifest(submittedBy: number, suffix: string, pol: string, pod: string) {
  const db = (await getDb())!;
  const [m] = await db
    .insert(manifests)
    .values({
      manifestNumber: `MF-P16-${suffix}`,
      manifestType: "SEA",
      submittedBy,
      vesselName: "MV Test",
      voyageNumber: "V001",
      portOfLoading: pol,
      portOfDischarge: pod,
    })
    .returning();
  return m;
}

function makeCtx(user: { id: number; openId: string; role: string }): TrpcContext {
  return {
    user: {
      ...user,
      email: `u${user.id}@example.com`,
      name: `U${user.id}`,
      loginMethod: "keycloak",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as TrpcContext["user"],
    keycloakRoles: [],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describeDb("Phase 16 transshipment lane against real PostgreSQL", () => {
  it("creates a transshipment declaration coupling valid in/out manifests, with the first audit row", async () => {
    const trader = await seedUser();
    const inbound = await seedManifest(trader.id, "IN1", "NGLOS", "NGAPP");
    const outbound = await seedManifest(trader.id, "OUT1", "NGAPP", "NLRTM");
    const caller = appRouter.createCaller(makeCtx(trader));
    const res = await caller.transshipment.create({
      inboundManifestNumber: inbound.manifestNumber,
      outboundManifestNumber: outbound.manifestNumber,
      goodsDescription: "Containerized electronics for transshipment",
      hsCode: "847130",
    });
    expect(res.declaration.declarationType).toBe("transshipment");
    expect(res.link.transshipmentPort).toBe("NGAPP");

    const detail = await caller.transshipment.get({ linkId: res.link.id });
    expect(detail.currentStatus).toBe("initiated");
    expect(detail.history).toHaveLength(1);
    expect(detail.allowedTransitions).toEqual(["in_transit", "cancelled"]);
  });

  it("rejects coupling when inbound discharge port differs from outbound loading port", async () => {
    const trader = await seedUser();
    const inbound = await seedManifest(trader.id, "IN2", "NGLOS", "NGAPP");
    const outbound = await seedManifest(trader.id, "OUT2", "NGPHC", "NLRTM");
    const caller = appRouter.createCaller(makeCtx(trader));
    await expect(
      caller.transshipment.create({
        inboundManifestNumber: inbound.manifestNumber,
        outboundManifestNumber: outbound.manifestNumber,
        goodsDescription: "Mismatched coupling attempt",
      })
    ).rejects.toThrow(/coupling invalid/i);
  });

  it("rejects unknown manifests honestly", async () => {
    const trader = await seedUser();
    const caller = appRouter.createCaller(makeCtx(trader));
    await expect(
      caller.transshipment.create({
        inboundManifestNumber: "MF-NOPE-1",
        outboundManifestNumber: "MF-NOPE-2",
        goodsDescription: "No such manifests",
      })
    ).rejects.toThrow(/not found/i);
  });

  it("walks bonded transfer transitions append-only and rejects invalid jumps", async () => {
    const trader = await seedUser();
    const inbound = await seedManifest(trader.id, "IN3", "NGLOS", "NGAPP");
    const outbound = await seedManifest(trader.id, "OUT3", "NGAPP", "NLRTM");
    const caller = appRouter.createCaller(makeCtx(trader));
    const { link } = await caller.transshipment.create({
      inboundManifestNumber: inbound.manifestNumber,
      outboundManifestNumber: outbound.manifestNumber,
      goodsDescription: "Transition walk",
    });

    await expect(
      caller.transshipment.transition({ linkId: link.id, toStatus: "released" })
    ).rejects.toThrow(/invalid bonded transfer transition/i);

    await caller.transshipment.transition({ linkId: link.id, toStatus: "in_transit", note: "departed quay" });
    await caller.transshipment.transition({ linkId: link.id, toStatus: "arrived_bond" });
    const detail = await caller.transshipment.get({ linkId: link.id });
    expect(detail.currentStatus).toBe("arrived_bond");
    expect(detail.history.map((h) => h.toStatus)).toEqual(["initiated", "in_transit", "arrived_bond"]);
  });

  it("does not expose another trader's transshipment link", async () => {
    const traderA = await seedUser();
    const traderB = await seedUser();
    const inbound = await seedManifest(traderA.id, "IN4", "NGLOS", "NGAPP");
    const outbound = await seedManifest(traderA.id, "OUT4", "NGAPP", "NLRTM");
    const callerA = appRouter.createCaller(makeCtx(traderA));
    const { link } = await callerA.transshipment.create({
      inboundManifestNumber: inbound.manifestNumber,
      outboundManifestNumber: outbound.manifestNumber,
      goodsDescription: "Ownership check",
    });
    const callerB = appRouter.createCaller(makeCtx(traderB));
    await expect(callerB.transshipment.get({ linkId: link.id })).rejects.toThrow(/not found/i);
  });
});

describeDb("Phase 16 AEO export fast-lane against real PostgreSQL", () => {
  it("orders AEO-certified exporters first in the prioritized export queue", async () => {
    const plain = await seedUser();
    const aeo = await seedUser();
    await seedProfile(plain.id, "none");
    await seedProfile(aeo.id, "certified", "gold");
    const db = (await getDb())!;
    // Plain trader files FIRST — FIFO alone would put them ahead.
    const [d1] = await db
      .insert(declarations)
      .values({
        declarationNumber: `TG-P16-Q1`,
        traderId: plain.id,
        declarationType: "export",
        status: "submitted",
        submittedAt: new Date(Date.now() - 60_000),
      })
      .returning();
    const [d2] = await db
      .insert(declarations)
      .values({
        declarationNumber: `TG-P16-Q2`,
        traderId: aeo.id,
        declarationType: "export",
        status: "submitted",
        submittedAt: new Date(),
      })
      .returning();
    expect(d1.id).toBeLessThan(d2.id);

    const officer = await seedUser("customs_officer");
    const caller = appRouter.createCaller(makeCtx(officer));
    const res = await caller.aeoFastLane.queue.prioritized({ limit: 100 });
    const ids = res.items.map((i) => i.id);
    expect(ids.indexOf(d2.id)).toBeLessThan(ids.indexOf(d1.id));
    expect(res.items.find((i) => i.id === d2.id)?.fastLane).toBe(true);
    expect(res.items.find((i) => i.id === d1.id)?.fastLane).toBe(false);
  });

  it("denies the prioritized queue to traders", async () => {
    const trader = await seedUser();
    const caller = appRouter.createCaller(makeCtx(trader));
    await expect(caller.aeoFastLane.queue.prioritized({})).rejects.toThrow(/officer role required/i);
  });

  it("fast-tracks drawback claims only for AEO-certified exporters", async () => {
    const db = (await getDb())!;
    const aeo = await seedUser();
    const plain = await seedUser();
    await seedProfile(aeo.id, "certified", "silver");
    await seedProfile(plain.id, "none");

    const [claimAeo] = await db
      .insert(dutyDrawbackClaims)
      .values({
        claimNumber: "DB-P16-1",
        traderId: aeo.id,
        importDeclarationId: 1,
        importDeclarationNumber: "TG-X",
        drawbackType: "unused_merchandise",
        status: "submitted",
        originalDutyPaid: "1000.00",
        claimedAmount: "990.00",
      })
      .returning();
    const [claimPlain] = await db
      .insert(dutyDrawbackClaims)
      .values({
        claimNumber: "DB-P16-2",
        traderId: plain.id,
        importDeclarationId: 1,
        importDeclarationNumber: "TG-Y",
        drawbackType: "manufacturing",
        status: "submitted",
        originalDutyPaid: "500.00",
        claimedAmount: "400.00",
      })
      .returning();

    const callerAeo = appRouter.createCaller(makeCtx(aeo));
    const updated = await callerAeo.aeoFastLane.drawback.requestFastTrack({ claimId: claimAeo.id });
    expect(updated.fastTrack).toBe(true);
    expect(updated.fastTrackAt).toBeTruthy();

    const callerPlain = appRouter.createCaller(makeCtx(plain));
    await expect(
      callerPlain.aeoFastLane.drawback.requestFastTrack({ claimId: claimPlain.id })
    ).rejects.toThrow(/AEO certification is required/i);

    // Cross-trader fast-track is invisible (NOT_FOUND, not FORBIDDEN).
    await expect(
      callerAeo.aeoFastLane.drawback.requestFastTrack({ claimId: claimPlain.id })
    ).rejects.toThrow(/not found/i);

    // Officer queue shows the fast-tracked claim first.
    const officer = await seedUser("customs_officer");
    const queue = await appRouter.createCaller(makeCtx(officer)).aeoFastLane.drawback.fastTrackQueue({ limit: 100 });
    expect(queue.items[0]?.id).toBe(claimAeo.id);
  });

  it("flags rules-of-origin certificates fast-path for certified exporters at submission", async () => {
    const aeo = await seedUser();
    await seedProfile(aeo.id, "certified");
    const caller = appRouter.createCaller(makeCtx(aeo));
    const cert = await caller.rulesOfOrigin.submitCertificate({
      exporterName: "AEO Exporter Ltd",
      exporterAddress: "1 Port Road, Lagos",
      importerName: "Rotterdam Buyer BV",
      importerAddress: "2 Havenweg, Rotterdam",
      originCountry: "NGA",
      destinationCountry: "NLD",
      hsCode: "847130",
      goodsDescription: "Laptop computers assembled in Nigeria",
    });
    expect(cert.fastPath).toBe(true);

    const plain = await seedUser();
    await seedProfile(plain.id, "none");
    const cert2 = await appRouter.createCaller(makeCtx(plain)).rulesOfOrigin.submitCertificate({
      exporterName: "Plain Trader Ltd",
      exporterAddress: "3 Market Street, Kano",
      importerName: "Hamburg Buyer GmbH",
      importerAddress: "4 Hafenstr, Hamburg",
      originCountry: "NGA",
      destinationCountry: "DEU",
      hsCode: "090111",
      goodsDescription: "Green coffee beans, not roasted",
    });
    expect(cert2.fastPath).toBe(false);
  });
});

describeDb("Phase 16 migration 0069 shape", () => {
  it("declaration_type accepts 'transshipment' (migration applied)", async () => {
    const db = (await getDb())!;
    const trader = await seedUser();
    const [d] = await db
      .insert(declarations)
      .values({
        declarationNumber: "TG-P16-TS",
        traderId: trader.id,
        declarationType: "transshipment",
      })
      .returning();
    expect(d.declarationType).toBe("transshipment");
    await db.delete(declarations).where(eq(declarations.id, d.id));
  });
});
