/**
 * PRA-043 (Phase 9) — REAL DB-gated integration tests for the fund-flow
 * money-lifecycle guards (server/routers/fund-flow.ts).
 *
 * Verifies the authorization/precondition/write guards that run BEFORE any
 * Redis idempotency or Temporal workflow hop, against a fresh PostgreSQL
 * database with the full migration chain (server/testutils/pgTestHarness.ts).
 * No mocks; the database is real. Skips cleanly with a printed reason when
 * PostgreSQL is unavailable.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createTestDatabase } from "./testutils/pgTestHarness";
import { closePool, getDb, createDeclaration } from "./db";
import { dutyDrawbackClaims } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { fundFlowRouter } from "./routers/fund-flow";

const tdb = await createTestDatabase("fund_flow");
if (tdb) process.env.DATABASE_URL = tdb.url;
const describeDb = tdb ? describe : describe.skip;

afterAll(async () => {
  await closePool();
  await tdb?.close();
});

const TRADER_ID = 701;
const traderCtx = {
  user: { id: TRADER_ID, role: "trader", openId: "t-701", name: "Trader" },
  req: {}, res: {},
} as any;
const otherTraderCtx = {
  user: { id: 702, role: "trader", openId: "t-702", name: "Other" },
  req: {}, res: {},
} as any;
const financeCtx = {
  user: { id: 3, role: "finance", openId: "f-3", name: "Finance" },
  req: {}, res: {},
} as any;

async function seedDeclaration(status: "draft" | "payment_pending", suffix: string, traderId = TRADER_ID) {
  const decl = await createDeclaration({
    declarationNumber: `DECL-FF-${suffix}`,
    traderId,
    declarationType: "import",
    hsCode: "870380",
    goodsDescription: "EVs",
    countryOfOrigin: "CN",
    countryOfDestination: "NG",
    portOfEntry: "APAPA",
    invoiceValue: "80000.00",
    invoiceCurrency: "USD",
    dutyAmount: "6000.00",
    levyAmount: "400.00",
    totalDue: "6400.00",
  });
  if (status !== "draft") {
    const db = await getDb();
    const { declarations } = await import("../drizzle/schema");
    await db!.update(declarations).set({ status }).where(eq(declarations.id, decl.id));
    decl.status = status;
  }
  return decl;
}

describeDb("fund-flow money guards against real PostgreSQL (PRA-043)", () => {
  it("collectImportDuty returns NOT_FOUND for a missing declaration", async () => {
    const caller = fundFlowRouter.createCaller(traderCtx);
    await expect(caller.collectImportDuty({ declarationId: 987_654_321 }))
      .rejects.toThrow(/Declaration not found/);
  });

  it("collectImportDuty forbids paying duty on another trader's declaration", async () => {
    const decl = await seedDeclaration("payment_pending", "OWN-1");
    const caller = fundFlowRouter.createCaller(otherTraderCtx);
    await expect(caller.collectImportDuty({ declarationId: decl.id }))
      .rejects.toThrow(/your own declarations/);
  });

  it("collectImportDuty rejects declarations that are not payment-ready", async () => {
    const decl = await seedDeclaration("draft", "STATE-1");
    const caller = fundFlowRouter.createCaller(traderCtx);
    await expect(caller.collectImportDuty({ declarationId: decl.id }))
      .rejects.toThrow(/not ready for duty collection/);
  });

  it("collectExportLevy enforces ownership with a real declaration row", async () => {
    const decl = await seedDeclaration("payment_pending", "OWN-2");
    const caller = fundFlowRouter.createCaller(otherTraderCtx);
    await expect(caller.collectExportLevy({ declarationId: decl.id }))
      .rejects.toThrow(/your own declarations/);
    await expect(fundFlowRouter.createCaller(otherTraderCtx).collectExportLevy({ declarationId: 987_654_322 }))
      .rejects.toThrow(/Declaration not found/);
  });

  it("submitDrawbackClaim persists a real claim with server-computed amounts", async () => {
    const decl = await seedDeclaration("payment_pending", "DBC-1");
    const caller = fundFlowRouter.createCaller(traderCtx);
    const result = await caller.submitDrawbackClaim({
      declarationId: decl.id,
      claimedAmountMinor: 150_000, // ₦1,500.00
      supportingDocuments: ["s3://evidence/reexport-bol.pdf"],
    });
    expect(result.claimId).toBeGreaterThan(0);
    expect(result.status).toBe("submitted");

    const db = await getDb();
    const [row] = await db!.select().from(dutyDrawbackClaims)
      .where(eq(dutyDrawbackClaims.id, result.claimId));
    expect(row.traderId).toBe(TRADER_ID);
    expect(row.importDeclarationId).toBe(decl.id);
    expect(Number(row.claimedAmount)).toBeCloseTo(1_500, 2);
    expect(Number(row.originalDutyPaid)).toBeCloseTo(1_500, 2);
    expect(row.claimNumber).toMatch(/^DBC-/);
    expect(row.reExportEvidence).toEqual(["s3://evidence/reexport-bol.pdf"]);
  });

  it("approveDrawbackClaim rejects approvals above the persisted claimed amount", async () => {
    const decl = await seedDeclaration("payment_pending", "DBC-2");
    const trader = fundFlowRouter.createCaller(traderCtx);
    const { claimId } = await trader.submitDrawbackClaim({
      declarationId: decl.id,
      claimedAmountMinor: 100_000, // ₦1,000.00
      supportingDocuments: ["s3://evidence/x.pdf"],
    });

    const finance = fundFlowRouter.createCaller(financeCtx);
    await expect(
      finance.approveDrawbackClaim({ claimId, approvedAmountMinor: 100_001 })
    ).rejects.toThrow(/cannot exceed the claimed amount/);

    // The rejected approval must not have mutated the persisted claim.
    const db = await getDb();
    const [row] = await db!.select().from(dutyDrawbackClaims).where(eq(dutyDrawbackClaims.id, claimId));
    expect(row.approvedAmount).toBeNull();
    expect(row.status).toBe("draft");
  });

  it("approveDrawbackClaim is role-gated and NOT_FOUND-honest", async () => {
    const trader = fundFlowRouter.createCaller(traderCtx);
    await expect(trader.approveDrawbackClaim({ claimId: 1, approvedAmountMinor: 1 }))
      .rejects.toThrow(/Only customs\/finance officers/);
    const finance = fundFlowRouter.createCaller(financeCtx);
    await expect(finance.approveDrawbackClaim({ claimId: 987_654_323, approvedAmountMinor: 1 }))
      .rejects.toThrow(/Drawback claim not found/);
  });
});
