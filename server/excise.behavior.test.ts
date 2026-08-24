import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { appRouter } from "./routers";
import { getDb } from "./db";
import type { TrpcContext } from "./_core/context";
import {
  exciseAggregateChildren,
  exciseAggregates,
  exciseAnomalies,
  exciseFacilities,
  exciseLicenceSuspensions,
  exciseLicences,
  exciseMarkActivations,
  exciseMarkingMachines,
  exciseMovementEvents,
  exciseProducts,
  exciseProductionReports,
  exciseReconciliationReports,
  exciseRetirements,
  exciseScans,
  exciseSeizures,
  exciseStampMarks,
  exciseStampOrders,
  exciseTaxSchemes,
  declarations,
  billsOfLading,
  manifests,
  tigerBeetleLedgerEntries,
} from "../drizzle/schema";
import { mintExciseUid } from "./routers/excise";

const ledgerMocks = vi.hoisted(() => ({
  available: vi.fn(async () => true),
  fetch: vi.fn(async (path: string, options?: RequestInit) => {
    if (options?.method === "POST") return { id: `excise-transfer-${Date.now()}` };
    return { id: path.split("/").pop() };
  }),
}));

vi.mock("./routers/ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routers/ledger")>();
  return {
    ...actual,
    tbBridgeAvailable: ledgerMocks.available,
    tbFetch: ledgerMocks.fetch,
  };
});

type Fixture = {
  licenceId: number;
  facilityId: number;
  schemeId: number;
  productId: number;
  orderIds: number[];
  declarationIds: number[];
  markIds: number[];
  aggregateIds: number[];
  transferIds: string[];
  scanUids: string[];
  billIds: number[];
  manifestIds: number[];
};

const fixtures: Fixture[] = [];

function caller(role: "user" | "admin" | "customs_officer" = "user", userId = 1) {
  const context: TrpcContext = {
    user: {
      id: userId,
      openId: `excise-behaviour-${userId}`,
      name: "Excise Behaviour Test",
      email: "excise-behaviour@example.test",
      loginMethod: "test",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { method: "POST", headers: {}, cookies: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext["res"],
  };
  return appRouter.createCaller(context);
}

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Postgres is required for excise behaviour tests.");
  return db;
}

async function makeFixture(options: {
  licenceStatus?: "pending" | "active" | "suspended" | "revoked" | "expired";
  validUntil?: Date;
  orderStatus?: "ordered" | "assessed" | "payment" | "fulfilment" | "delivery";
  quantity?: number;
  declaration?: boolean;
} = {}) {
  const db = await database();
  const now = new Date();
  const [licence] = await db.insert(exciseLicences).values({
    licenseNumber: `EXC-TEST-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    userId: 1,
    licenseeType: "importer",
    economicOperatorId: `EO-TEST-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    productCategories: ["beverages"],
    validFrom: new Date(now.getTime() - 60_000),
    validUntil: options.validUntil ?? new Date(now.getTime() + 86_400_000),
    status: options.licenceStatus ?? "active",
  }).returning();
  const fixture: Fixture = {
    licenceId: licence.id,
    facilityId: 0,
    schemeId: 0,
    productId: 0,
    orderIds: [],
    declarationIds: [],
    markIds: [],
    aggregateIds: [],
    transferIds: [],
    scanUids: [],
    billIds: [],
    manifestIds: [],
  };
  fixtures.push(fixture);

  const [facility] = await db.insert(exciseFacilities).values({
    licenceId: licence.id,
    facilityIdentifier: `FI-TEST-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: "Behaviour Test Facility",
    createdBy: 1,
  }).returning();
  fixture.facilityId = facility.id;

  const [scheme] = await db.insert(exciseTaxSchemes).values({
    code: `SCHEME-TEST-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    schemeType: "specific",
    specificAmount: "1.00",
    specificUnitOfMeasure: "unit",
    currency: "GHS",
    createdBy: 1,
  }).returning();
  fixture.schemeId = scheme.id;

  const [product] = await db.insert(exciseProducts).values({
    licenceId: licence.id,
    sku: `SKU-TEST-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    brand: "Behaviour Test Product",
    packSize: 1,
    unitContent: "1",
    unitOfMeasure: "unit",
    schemeId: scheme.id,
    approvalStatus: "approved",
    approvedBy: 1,
    approvedAt: now,
    createdBy: 1,
  }).returning();
  fixture.productId = product.id;

  if (options.declaration) {
    const [declaration] = await db.insert(declarations).values({
      declarationNumber: `DEC-EXC-${Math.random().toString(36).slice(2, 14)}`,
      ucr: `UCR-EXC-${Math.random().toString(36).slice(2, 14)}`,
      traderId: 1,
      principalId: 1,
      declarationType: "import",
      invoiceCurrency: "GHS",
      totalDue: "100.00",
    }).returning();
    fixture.declarationIds.push(declaration.id);
  }

  const [order] = await db.insert(exciseStampOrders).values({
    orderNumber: `EXO-TEST-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    licenceId: licence.id,
    productId: product.id,
    facilityId: facility.id,
    declarationId: fixture.declarationIds[0],
    quantity: options.quantity ?? 1,
    declaredValue: "100.00",
    liability: "1.00",
    currency: "GHS",
    status: options.orderStatus ?? "fulfilment",
    createdBy: 1,
  }).returning();
  fixture.orderIds.push(order.id);
  return { db, fixture, licence, facility, scheme, product, order, declarationId: fixture.declarationIds[0] };
}

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  for (const fixture of fixtures.splice(0)) {
    if (fixture.orderIds.length) {
      const orderMarks = await db.select({ id: exciseStampMarks.id })
        .from(exciseStampMarks)
        .where(inArray(exciseStampMarks.orderId, fixture.orderIds));
      fixture.markIds.push(...orderMarks.map((mark) => mark.id));
    }
    if (fixture.markIds.length) {
      await db.delete(exciseAnomalies).where(inArray(exciseAnomalies.markId, fixture.markIds));
      await db.delete(exciseScans).where(inArray(exciseScans.markId, fixture.markIds));
      await db.delete(exciseSeizures).where(inArray(exciseSeizures.markId, fixture.markIds));
      await db.delete(exciseMovementEvents).where(inArray(exciseMovementEvents.markId, fixture.markIds));
      await db.delete(exciseAggregateChildren).where(inArray(exciseAggregateChildren.childMarkId, fixture.markIds));
      await db.delete(exciseMarkActivations).where(inArray(exciseMarkActivations.markId, fixture.markIds));
      await db.delete(exciseRetirements).where(inArray(exciseRetirements.markId, fixture.markIds));
      await db.delete(exciseStampMarks).where(inArray(exciseStampMarks.id, fixture.markIds));
    }
    if (fixture.scanUids.length) {
      await db.delete(exciseScans).where(inArray(exciseScans.uid, fixture.scanUids));
    }
    if (fixture.aggregateIds.length) {
      await db.delete(exciseMovementEvents).where(inArray(exciseMovementEvents.aggregateId, fixture.aggregateIds));
      await db.delete(exciseAggregateChildren).where(inArray(exciseAggregateChildren.aggregateId, fixture.aggregateIds));
      await db.delete(exciseAggregates).where(inArray(exciseAggregates.id, fixture.aggregateIds));
    }
    if (fixture.orderIds.length) {
      await db.delete(exciseReconciliationReports).where(inArray(exciseReconciliationReports.orderId, fixture.orderIds));
      await db.delete(exciseProductionReports).where(inArray(exciseProductionReports.orderId, fixture.orderIds));
      await db.delete(tigerBeetleLedgerEntries).where(inArray(tigerBeetleLedgerEntries.reference, fixture.orderIds.map((id) => `EXO-TEST-${id}`)));
      if (fixture.transferIds.length) {
        await db.delete(tigerBeetleLedgerEntries).where(inArray(tigerBeetleLedgerEntries.tbTransferId, fixture.transferIds));
      }
      await db.delete(exciseStampOrders).where(inArray(exciseStampOrders.id, fixture.orderIds));
    }
    if (fixture.declarationIds.length) {
      await db.delete(tigerBeetleLedgerEntries).where(inArray(tigerBeetleLedgerEntries.declarationId, fixture.declarationIds));
      await db.delete(declarations).where(inArray(declarations.id, fixture.declarationIds));
    }
    if (fixture.billIds.length) {
      await db.delete(billsOfLading).where(inArray(billsOfLading.id, fixture.billIds));
    }
    if (fixture.manifestIds.length) {
      await db.delete(manifests).where(inArray(manifests.id, fixture.manifestIds));
    }
    await db.delete(exciseProducts).where(eq(exciseProducts.id, fixture.productId));
    await db.delete(exciseTaxSchemes).where(eq(exciseTaxSchemes.id, fixture.schemeId));
    await db.delete(exciseMarkingMachines).where(eq(exciseMarkingMachines.facilityId, fixture.facilityId));
    await db.delete(exciseFacilities).where(eq(exciseFacilities.id, fixture.facilityId));
    await db.delete(exciseLicenceSuspensions).where(eq(exciseLicenceSuspensions.licenceId, fixture.licenceId));
    await db.delete(exciseLicences).where(eq(exciseLicences.id, fixture.licenceId));
  }
}

afterEach(async () => {
  ledgerMocks.available.mockResolvedValue(true);
  ledgerMocks.fetch.mockClear();
  delete process.env.EXCISE_UID_HMAC_KEY;
  delete process.env.EXCISE_UID_KEY_ID;
  await cleanup();
});

describe.sequential("excise money and lifecycle behaviour", () => {
  it("posts one transfer for repeated payOrder calls", async () => {
    process.env.EXCISE_UID_HMAC_KEY = "a".repeat(64);
    const { fixture, order } = await makeFixture({ orderStatus: "assessed" });
    const first = await caller().excise.payOrder({ orderId: order.id });
    const second = await caller().excise.payOrder({ orderId: order.id });
    expect(first.status).toBe("payment");
    expect(second.status).toBe("payment");
    expect(ledgerMocks.fetch.mock.calls.filter(([path, options]) => path === "/api/ledger/transfers" && options?.method === "POST")).toHaveLength(1);
    expect(first.ledgerTransferId).toBe(second.ledgerTransferId);
    fixture.transferIds.push(first.ledgerTransferId!);

    const recovery = await makeFixture({ orderStatus: "assessed" });
    const recoveredTransferId = `excise-recovered-${recovery.order.id}`;
    await recovery.db.insert(tigerBeetleLedgerEntries).values({
      tbTransferId: recoveredTransferId,
      debitAccountId: "trader-1",
      creditAccountId: "ncs-revenue-account",
      amountMinorUnits: 100,
      currency: "GHS",
      entryType: "excise_stamp_liability",
      status: "posted",
      reference: recovery.order.orderNumber,
      metadata: { idempotencyKey: `excise:pay:${recovery.order.id}` },
      postedAt: new Date(),
    });
    const postCountBeforeRecovery = ledgerMocks.fetch.mock.calls.filter(([path, options]) =>
      path === "/api/ledger/transfers" && options?.method === "POST").length;
    const recovered = await caller().excise.payOrder({ orderId: recovery.order.id });
    expect(recovered.ledgerTransferId).toBe(recoveredTransferId);
    expect(ledgerMocks.fetch.mock.calls.filter(([path, options]) =>
      path === "/api/ledger/transfers" && options?.method === "POST")).toHaveLength(postCountBeforeRecovery);
    recovery.fixture.transferIds.push(recoveredTransferId);
  });

  it("refuses currency-mismatched, unsettled, and unavailable duty settlement", async () => {
    const mismatched = await makeFixture({ declaration: true, orderStatus: "payment" });
    const [mismatchEntry] = await mismatched.db.insert(tigerBeetleLedgerEntries).values({
      tbTransferId: `tb-mismatch-${Date.now()}`,
      debitAccountId: "trader-1",
      creditAccountId: "ncs-revenue-account",
      amountMinorUnits: 10_000,
      currency: "USD",
      entryType: "duty_payment",
      status: "posted",
      declarationId: mismatched.declarationId,
      reference: "duty-mismatch",
    }).returning();
    await expect(caller().excise.fulfilOrder({ orderId: mismatched.order.id })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await mismatched.db.delete(tigerBeetleLedgerEntries).where(eq(tigerBeetleLedgerEntries.id, mismatchEntry.id));

    const unsettled = await makeFixture({ declaration: true, orderStatus: "payment" });
    await expect(caller().excise.fulfilOrder({ orderId: unsettled.order.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    ledgerMocks.available.mockResolvedValue(false);
    const unavailableLedger = await makeFixture({ declaration: true, orderStatus: "payment" });
    await expect(caller().excise.fulfilOrder({ orderId: unavailableLedger.order.id })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("rejects terminal order re-entry and action through expired or suspended licences", async () => {
    const terminal = await makeFixture({ orderStatus: "delivery" });
    await expect(caller().excise.deliverOrder({ orderId: terminal.order.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const expired = await makeFixture({ licenceStatus: "expired", validUntil: new Date(Date.now() - 1_000) });
    await expect(caller().excise.createAggregate({ licenceId: expired.licence.id, aggregateType: "case" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const suspended = await makeFixture({ licenceStatus: "suspended" });
    await expect(caller().excise.createAggregate({ licenceId: suspended.licence.id, aggregateType: "case" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not approve a revoked licence", async () => {
    const { licence } = await makeFixture({ licenceStatus: "revoked" });
    await expect(caller("customs_officer", 2).excise.approveLicence({ licenceId: licence.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("activates a mark idempotently", async () => {
    process.env.EXCISE_UID_HMAC_KEY = "a".repeat(64);
    const { db, fixture, order } = await makeFixture({ quantity: 1 });
    const signed = mintExciseUid();
    const [mark] = await db.insert(exciseStampMarks).values({
      uid: signed.uid,
      payload: signed.payload,
      signature: signed.signature,
      keyId: signed.keyId,
      orderId: order.id,
      productId: fixture.productId,
      facilityId: fixture.facilityId,
      status: "issued",
    }).returning();
    fixture.markIds.push(mark.id);
    const first = await caller().excise.activateMark({ uid: mark.uid });
    const second = await caller().excise.activateMark({ uid: mark.uid });
    expect(first.status).toBe("active");
    expect(second.status).toBe("active");
    expect(await db.select().from(exciseMarkActivations).where(eq(exciseMarkActivations.markId, mark.id))).toHaveLength(1);
  });

  it("resumes minting and does not over-mint racing calls", async () => {
    process.env.EXCISE_UID_HMAC_KEY = "b".repeat(64);
    process.env.EXCISE_UID_KEY_ID = "test-mint";
    const { fixture, order } = await makeFixture({ quantity: 6 });
    const first = await caller().excise.mintMarks({ orderId: order.id, batchSize: 2 });
    expect(first.mintedCount).toBe(2);
    const results = await Promise.allSettled([
      caller().excise.mintMarks({ orderId: order.id, batchSize: 10 }),
      caller().excise.mintMarks({ orderId: order.id, batchSize: 10 }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const db = await database();
    const marks = await db.select().from(exciseStampMarks).where(eq(exciseStampMarks.orderId, order.id));
    if (marks.length < 6) {
      await caller().excise.mintMarks({ orderId: order.id, batchSize: 10 });
    }
    const completedMarks = await db.select().from(exciseStampMarks).where(eq(exciseStampMarks.orderId, order.id));
    expect(completedMarks).toHaveLength(6);
    expect(new Set(completedMarks.map((mark) => mark.uid)).size).toBe(6);
    fixture.markIds.push(...completedMarks.map((mark) => mark.id));
  });

  it("refuses a mark in a second live aggregate", async () => {
    process.env.EXCISE_UID_HMAC_KEY = "b".repeat(64);
    const { db, fixture, order, licence } = await makeFixture();
    const signed = mintExciseUid();
    const [mark] = await db.insert(exciseStampMarks).values({
      uid: signed.uid,
      payload: signed.payload,
      signature: signed.signature,
      keyId: signed.keyId,
      orderId: order.id,
      productId: fixture.productId,
      facilityId: fixture.facilityId,
      status: "issued",
    }).returning();
    fixture.markIds.push(mark.id);
    const first = await caller().excise.createAggregate({ licenceId: licence.id, aggregateType: "case" });
    const second = await caller().excise.createAggregate({ licenceId: licence.id, aggregateType: "case" });
    fixture.aggregateIds.push(first.id, second.id);
    await caller().excise.addToAggregate({ aggregateId: first.id, markId: mark.id });
    await expect(caller().excise.addToAggregate({ aggregateId: second.id, markId: mark.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reports zero stamp and production variance for a clean order", async () => {
    process.env.EXCISE_UID_HMAC_KEY = "c".repeat(64);
    const { db, fixture, order } = await makeFixture({ quantity: 3 });
    const marks = [];
    for (let index = 0; index < 3; index += 1) {
      const signed = mintExciseUid();
      const [mark] = await db.insert(exciseStampMarks).values({
        uid: signed.uid,
        payload: signed.payload,
        signature: signed.signature,
        keyId: signed.keyId,
        orderId: order.id,
        productId: fixture.productId,
        facilityId: fixture.facilityId,
        status: index === 0 ? "active" : index === 1 ? "retired" : "issued",
        activatedAt: index === 0 ? new Date() : undefined,
        retiredAt: index === 1 ? new Date() : undefined,
      }).returning();
      marks.push(mark);
      fixture.markIds.push(mark.id);
    }
    await db.insert(exciseProductionReports).values({
      orderId: order.id,
      productId: fixture.productId,
      facilityId: fixture.facilityId,
      quantity: 1,
      reportedBy: 1,
    });
    const report = await caller().excise.reconcileOrder({ orderId: order.id });
    expect(report.stampVariance).toBe(0);
    expect(report.productionVariance).toBe(0);
  });

  it("keeps public verification status-only and fails closed when signing is unavailable", async () => {
    process.env.EXCISE_UID_HMAC_KEY = "c".repeat(64);
    const signed = mintExciseUid();
    const result = await caller().excise.publicVerify({ uid: signed.uid });
    expect(Object.keys(result)).toEqual(["status"]);
    expect(result.status).toBe("unknown");

    delete process.env.EXCISE_UID_HMAC_KEY;
    const unavailable = await caller().excise.publicVerify({ uid: signed.uid });
    expect(unavailable).toEqual({ status: "unavailable" });
  });

  it("retains both scans and flags the mark for impossible travel", async () => {
    process.env.EXCISE_UID_HMAC_KEY = "d".repeat(64);
    const signed = mintExciseUid();
    const fixture = await makeFixture();
    fixture.fixture.scanUids.push(signed.uid);
    await caller().excise.publicVerify({ uid: signed.uid, latitude: 0, longitude: 0 });
    const result = await caller().excise.publicVerify({ uid: signed.uid, latitude: 0, longitude: 1 });
    expect(result.status).toBe("unknown");
    const db = await database();
    const scans = await db.select().from(exciseScans).where(eq(exciseScans.uid, signed.uid));
    expect(scans).toHaveLength(2);
    expect(scans.some((scan) => scan.impossibleTravel)).toBe(true);
    expect(scans[1].previousScanId).toBe(scans[0].id);
  });

  it("returns distinct source-link outcomes and permits self-filed traversal", async () => {
    await expect(caller("customs_officer", 2).excise.traverseSource({ uid: "missing-excise-mark" })).resolves.toMatchObject({
      available: false,
      reason: "mark_not_found",
    });
    process.env.EXCISE_UID_HMAC_KEY = "e".repeat(64);
    const noDeclaration = await makeFixture();
    const noDeclarationUid = mintExciseUid();
    const [noDeclarationMark] = await noDeclaration.db.insert(exciseStampMarks).values({
      uid: noDeclarationUid.uid,
      payload: noDeclarationUid.payload,
      signature: noDeclarationUid.signature,
      keyId: noDeclarationUid.keyId,
      orderId: noDeclaration.order.id,
      productId: noDeclaration.fixture.productId,
      facilityId: noDeclaration.fixture.facilityId,
      status: "issued",
    }).returning();
    noDeclaration.fixture.markIds.push(noDeclarationMark.id);
    await expect(caller("customs_officer", 2).excise.traverseSource({ uid: noDeclarationMark.uid })).resolves.toMatchObject({
      available: false,
      reason: "declaration_missing",
    });
    const linked = await makeFixture({ declaration: true });
    const declarationId = linked.declarationId!;
    const linkedDeclaration = await linked.db.select().from(declarations).where(eq(declarations.id, declarationId)).limit(1);
    expect(linkedDeclaration).toHaveLength(1);
    await expect(caller("customs_officer", 2).excise.traverseSource({ uid: noDeclarationMark.uid })).resolves.toMatchObject({
      reason: "declaration_missing",
    });
    const signed = mintExciseUid();
    const [mark] = await linked.db.insert(exciseStampMarks).values({
      uid: signed.uid,
      payload: signed.payload,
      signature: signed.signature,
      keyId: signed.keyId,
      orderId: linked.order.id,
      productId: linked.fixture.productId,
      facilityId: linked.fixture.facilityId,
      status: "issued",
    }).returning();
    linked.fixture.markIds.push(mark.id);
    await expect(caller("customs_officer", 2).excise.traverseSource({ uid: mark.uid })).resolves.toMatchObject({
      available: false,
      reason: "bill_of_lading_not_linked",
    });
    await linked.db.update(declarations).set({ billOfLadingNumber: "BL-NOT-FILED" }).where(eq(declarations.id, declarationId));
    await expect(caller("customs_officer", 2).excise.traverseSource({ uid: mark.uid })).resolves.toMatchObject({
      available: false,
      reason: "bill_of_lading_missing",
    });

    const [manifestOne] = await linked.db.insert(manifests).values({
      manifestNumber: `MAN-EXC-${Date.now()}-1`,
      manifestType: "IMPORT",
      submittedBy: 1,
      vesselName: "MV Ambiguous",
      voyageNumber: "V1",
      portOfLoading: "Lagos",
      portOfDischarge: "Tema",
    }).returning();
    const [manifestTwo] = await linked.db.insert(manifests).values({
      manifestNumber: `MAN-EXC-${Date.now()}-2`,
      manifestType: "IMPORT",
      submittedBy: 1,
      vesselName: "MV Ambiguous",
      voyageNumber: "V2",
      portOfLoading: "Lagos",
      portOfDischarge: "Tema",
    }).returning();
    linked.fixture.manifestIds.push(manifestOne.id, manifestTwo.id);
    const [billOne] = await linked.db.insert(billsOfLading).values({
      manifestId: manifestOne.id,
      blNumber: "BL-AMBIGUOUS",
      shipper: "Test Shipper",
      consignee: "Test Consignee",
      description: "Test goods",
    }).returning();
    const [billTwo] = await linked.db.insert(billsOfLading).values({
      manifestId: manifestTwo.id,
      blNumber: "BL-AMBIGUOUS",
      shipper: "Test Shipper",
      consignee: "Test Consignee",
      description: "Test goods",
    }).returning();
    linked.fixture.billIds.push(billOne.id, billTwo.id);
    await linked.db.update(declarations).set({ billOfLadingNumber: "BL-AMBIGUOUS" }).where(eq(declarations.id, declarationId));
    await expect(caller("customs_officer", 2).excise.traverseSource({ uid: mark.uid })).resolves.toMatchObject({
      available: false,
      reason: "bill_of_lading_ambiguous",
    });

    await linked.db.update(declarations).set({ billOfLadingId: billOne.id, billOfLadingNumber: "BL-AMBIGUOUS", actingAgentId: null }).where(eq(declarations.id, declarationId));
    const traversed = await caller("customs_officer", 2).excise.traverseSource({ uid: mark.uid });
    expect(traversed).toMatchObject({
      available: true,
      importerUserId: 1,
      actingAgentUserId: null,
      billOfLading: { id: billOne.id },
      manifest: { id: manifestOne.id },
    });
  });
});
