/**
 * PRA-043 (Phase 9) — REAL DB-gated integration tests for the declarations
 * lifecycle (draft → submitted → payment → cleared) and the tamper-evident
 * audit trail that accompanies it.
 *
 * Runs the actual server/db.ts helpers against a fresh PostgreSQL database
 * carrying the full migration chain (server/testutils/pgTestHarness.ts).
 * No mocks. Skips cleanly with a printed reason when PostgreSQL is down.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { createTestDatabase, expectPgRejection } from "./testutils/pgTestHarness";
import {
  closePool,
  createDeclaration,
  getDeclarationById,
  getDeclarationByNumber,
  getDeclarationsByTrader,
  getDeclarationStats,
  updateDeclaration,
  logAuditEvent,
  getAuditTrail,
} from "./db";

const tdb = await createTestDatabase("decl_lifecycle");
if (tdb) process.env.DATABASE_URL = tdb.url;
const describeDb = tdb ? describe : describe.skip;

afterAll(async () => {
  await closePool();
  await tdb?.close();
});

const TRADER = 501;

async function seedDeclaration(suffix: string, traderId = TRADER) {
  return createDeclaration({
    declarationNumber: `DECL-2026-${suffix}`,
    traderId,
    declarationType: "import",
    hsCode: "870380",
    goodsDescription: "Electric vehicles",
    countryOfOrigin: "CN",
    countryOfDestination: "NG",
    portOfEntry: "APAPA",
    invoiceValue: "120000.00",
    invoiceCurrency: "USD",
    dutyAmount: "9000.00",
    vatAmount: "6750.00",
    totalDue: "15750.00",
  });
}

describeDb("declarations lifecycle against real PostgreSQL (PRA-043)", () => {
  it("walks the real status machine: draft → submitted → payment_pending → payment_confirmed → cleared", async () => {
    const decl = await seedDeclaration("LC-001");
    expect(decl.status).toBe("draft");

    const submitted = await updateDeclaration(decl.id, { status: "submitted", submittedAt: new Date() });
    expect(submitted.status).toBe("submitted");
    expect(submitted.submittedAt).not.toBeNull();

    const assessed = await updateDeclaration(decl.id, { status: "payment_pending" });
    expect(assessed.status).toBe("payment_pending");

    const paid = await updateDeclaration(decl.id, { status: "payment_confirmed" });
    expect(paid.status).toBe("payment_confirmed");

    const cleared = await updateDeclaration(decl.id, { status: "cleared", clearedAt: new Date() });
    expect(cleared.status).toBe("cleared");
    expect(cleared.clearedAt).not.toBeNull();

    // Read back through a fresh query — persistence, not in-memory state.
    const reread = await getDeclarationById(decl.id);
    expect(reread?.status).toBe("cleared");
    expect(Number(reread?.totalDue)).toBeCloseTo(15_750, 2);
  });

  it("enforces declaration_number uniqueness at the database level", async () => {
    await seedDeclaration("LC-DUP");
    await expectPgRejection(seedDeclaration("LC-DUP"), /duplicate key value violates unique constraint/i);
    expect((await getDeclarationByNumber("DECL-2026-LC-DUP"))?.declarationNumber).toBe("DECL-2026-LC-DUP");
  });

  it("scopes trader listings and aggregate stats to real rows", async () => {
    const mine = await seedDeclaration("LC-STAT-1", 777);
    await updateDeclaration(mine.id, { status: "submitted" });
    await seedDeclaration("LC-STAT-2", 888);

    const traderRows = await getDeclarationsByTrader(777);
    expect(traderRows.map((d) => d.declarationNumber)).toContain("DECL-2026-LC-STAT-1");
    expect(traderRows.every((d) => d.traderId === 777)).toBe(true);

    const stats = await getDeclarationStats();
    expect(stats).not.toBeNull();
    expect(stats!.total).toBeGreaterThanOrEqual(2);
    expect(stats!.pending).toBeGreaterThanOrEqual(1); // LC-STAT-1 is "submitted"
  });

  it("rejects enum-invalid status transitions (fail-closed schema)", async () => {
    const decl = await seedDeclaration("LC-BAD");
    await expectPgRejection(
      updateDeclaration(decl.id, { status: "approved" as any }),
      /invalid input value for enum declaration_status/i
    );
    // Failed transition leaves the persisted row untouched.
    expect((await getDeclarationById(decl.id))?.status).toBe("draft");
  });

  it("maintains a verifiable tamper-evident hash chain across lifecycle events", async () => {
    const decl = await seedDeclaration("LC-AUDIT");
    const events: Array<[string, unknown]> = [
      ["created", { status: "draft" }],
      ["submitted", { status: "submitted" }],
      ["cleared", { status: "cleared" }],
    ];
    for (const [action, newState] of events) {
      await logAuditEvent({
        entityType: "declaration",
        entityId: decl.id,
        action,
        actorId: TRADER,
        actorType: "trader",
        newState,
      });
    }

    const trail = await getAuditTrail("declaration", decl.id);
    expect(trail.length).toBeGreaterThanOrEqual(3);
    const ordered = [...trail].reverse(); // getAuditTrail returns newest-first

    // Verify the chain: each row's prevHash links to the previous entryHash,
    // and every entryHash recomputes from the row content.
    let prevHash = "";
    for (const row of ordered.slice(-3)) {
      expect(row.prevHash ?? "").toBe(prevHash);
      const recomputed = createHash("sha256")
        .update([
          row.entityType, String(row.entityId), row.action,
          String(row.actorId ?? ""), row.createdAt.toISOString(),
          prevHash, JSON.stringify(row.newState ?? null),
        ].join("|"))
        .digest("hex");
      expect(row.entryHash).toBe(recomputed);
      prevHash = row.entryHash!;
    }
  });
});
