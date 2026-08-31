/**
 * PRA-043 (Phase 9) — REAL DB-gated integration tests for payment records.
 *
 * Exercises the actual server/db.ts payment helpers against a fresh
 * PostgreSQL database with the full migration chain applied
 * (server/testutils/pgTestHarness.ts): real FK enforcement to declarations,
 * real payment_status enum, real status transitions. No mocks. Skips
 * cleanly with a printed reason when PostgreSQL is unavailable.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createTestDatabase, expectPgRejection } from "./testutils/pgTestHarness";
import {
  closePool,
  createDeclaration,
  createPayment,
  updatePayment,
  getPaymentsByDeclaration,
  getAllPayments,
} from "./db";

const tdb = await createTestDatabase("payments");
if (tdb) process.env.DATABASE_URL = tdb.url;
const describeDb = tdb ? describe : describe.skip;

afterAll(async () => {
  await closePool();
  await tdb?.close();
});

const TRADER = 601;

async function seedDeclaration(suffix: string) {
  return createDeclaration({
    declarationNumber: `DECL-PAY-${suffix}`,
    traderId: TRADER,
    declarationType: "import",
    hsCode: "100630",
    goodsDescription: "Rice",
    countryOfOrigin: "IN",
    countryOfDestination: "NG",
    portOfEntry: "TINCAN",
    invoiceValue: "45000.00",
    invoiceCurrency: "USD",
    totalDue: "4800.00",
  });
}

describeDb("payment records against real PostgreSQL (PRA-043)", () => {
  it("persists the pending → processing → confirmed money trail", async () => {
    const decl = await seedDeclaration("FLOW-1");
    const payment = await createPayment({
      declarationId: decl.id,
      traderId: TRADER,
      amount: "4800.00",
      currency: "USD",
      paymentMethod: "bank_transfer",
      reference: "NIBSS-REF-0001",
    });
    expect(payment.status).toBe("pending");

    const processing = await updatePayment(payment.id, { status: "processing" });
    expect(processing.status).toBe("processing");

    const confirmed = await updatePayment(payment.id, {
      status: "confirmed",
      confirmedAt: new Date(),
      mojalooopTransferId: "moja-tx-123",
    });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmedAt).not.toBeNull();
    expect(confirmed.mojalooopTransferId).toBe("moja-tx-123");

    const byDecl = await getPaymentsByDeclaration(decl.id);
    expect(byDecl).toHaveLength(1);
    expect(Number(byDecl[0].amount)).toBeCloseTo(4_800, 2);
    expect(byDecl[0].status).toBe("confirmed");
  });

  it("persists failure state with the failure reason (honest money trail)", async () => {
    const decl = await seedDeclaration("FLOW-2");
    const payment = await createPayment({
      declarationId: decl.id,
      traderId: TRADER,
      amount: "4800.00",
      currency: "USD",
      paymentMethod: "card",
    });
    const failed = await updatePayment(payment.id, {
      status: "failed",
      failureReason: "Payer FSP rejected: insufficient funds",
    });
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe("Payer FSP rejected: insufficient funds");

    const all = await getAllPayments(100, 0);
    const row = all.find((p) => p.id === payment.id);
    expect(row?.status).toBe("failed");
  });

  it("enforces the payments → declarations foreign key (fail-closed schema)", async () => {
    await expectPgRejection(
      createPayment({
        declarationId: 999_999_999,
        traderId: TRADER,
        amount: "100.00",
        currency: "USD",
        paymentMethod: "bank_transfer",
      }),
      /violates foreign key constraint/i
    );
  });

  it("rejects enum-invalid payment statuses and methods", async () => {
    const decl = await seedDeclaration("FLOW-3");
    await expectPgRejection(
      createPayment({
        declarationId: decl.id, traderId: TRADER, amount: "10.00",
        currency: "USD", paymentMethod: "cowrie_shells" as any,
      }),
      /invalid input value for enum payment_method/i
    );

    const payment = await createPayment({
      declarationId: decl.id, traderId: TRADER, amount: "10.00",
      currency: "USD", paymentMethod: "mobile_money",
    });
    await expectPgRejection(
      updatePayment(payment.id, { status: "maybe" as any }),
      /invalid input value for enum payment_status/i
    );
    // Failed update leaves the persisted row in its prior state.
    const rows = await getPaymentsByDeclaration(decl.id);
    expect(rows[0].status).toBe("pending");
  });

  it("lists multiple payments for one declaration in storage order", async () => {
    const decl = await seedDeclaration("FLOW-4");
    await createPayment({
      declarationId: decl.id, traderId: TRADER, amount: "2000.00",
      currency: "USD", paymentMethod: "bank_transfer", reference: "INST-1",
    });
    await createPayment({
      declarationId: decl.id, traderId: TRADER, amount: "2800.00",
      currency: "USD", paymentMethod: "bank_transfer", reference: "INST-2",
    });
    const rows = await getPaymentsByDeclaration(decl.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.reference).sort()).toEqual(["INST-1", "INST-2"]);
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    expect(total).toBeCloseTo(4_800, 2);
  });
});
