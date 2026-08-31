/**
 * tradeFinance.wp6.db.test.ts — DB-gated tests for the WP-6 consent
 * evidence mirror. Runs only when DATABASE_URL points at a real PostgreSQL;
 * otherwise the suite skips (singlewindow DB-gated convention).
 *
 * Verifies: migration 0051 applies, evidence rows persist with digest
 * evidence, per-trader isolation holds (a trader sees ONLY its own evidence)
 * and FK integrity to users is enforced.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { tradeFinanceConsentEvidence, users } from "../drizzle/schema";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const DB_GATED = DATABASE_URL.startsWith("postgres");

const MIGRATION = readFileSync(
  path.resolve(import.meta.dirname, "../drizzle/migrations/0051_trade_finance_consent_evidence.sql"),
  "utf8"
);

const DIGEST_A = "sha256:" + "a".repeat(64);
const DIGEST_B = "sha256:" + "b".repeat(64);

describe.skipIf(!DB_GATED)("trade-finance consent evidence (real PostgreSQL)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool);
    // Minimal users dependency (the mirror FK-references users.id).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" serial PRIMARY KEY,
        "open_id" varchar(64),
        "name" text,
        "email" varchar(320),
        "login_method" varchar(64),
        "role" varchar(16) DEFAULT 'user' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        "last_signed_in" timestamp DEFAULT now() NOT NULL
      )`);
    await pool.query(`DROP TABLE IF EXISTS "trade_finance_consent_evidence"`);
    await pool.query(MIGRATION);
    await db.insert(users).values([
      { openId: "wp6-trader-1", name: "WP6 Trader One" },
      { openId: "wp6-trader-2", name: "WP6 Trader Two" },
    ] as any).onConflictDoNothing();
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS "trade_finance_consent_evidence"`);
    await pool.end();
  });

  async function userId(openId: string): Promise<number> {
    const rows = await db.select().from(users).where(eq(users.openId, openId));
    return rows[0].id;
  }

  it("persists digest evidence for the consent lifecycle", async () => {
    const trader1 = await userId("wp6-trader-1");
    for (const [action, digest] of [["REQUESTED", DIGEST_A], ["ACTIVATED", DIGEST_B]] as const) {
      await db.insert(tradeFinanceConsentEvidence).values({
        consentId: "tf-con-900",
        traderUserId: trader1,
        traderRef: `sw-user-${trader1}`,
        bankId: "bank-gtb",
        action,
        envelopeDigestSha256: digest,
        detail: { scope: "DECLARATION_DIGESTS" },
      });
    }
    const rows = await db.select().from(tradeFinanceConsentEvidence)
      .where(eq(tradeFinanceConsentEvidence.consentId, "tf-con-900"));
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.action).sort()).toEqual(["ACTIVATED", "REQUESTED"]);
    for (const row of rows) {
      expect(row.envelopeDigestSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it("isolates evidence per trader (negative: no cross-trader leakage)", async () => {
    const trader1 = await userId("wp6-trader-1");
    const trader2 = await userId("wp6-trader-2");
    await db.insert(tradeFinanceConsentEvidence).values({
      consentId: "tf-con-901",
      traderUserId: trader2,
      traderRef: `sw-user-${trader2}`,
      bankId: "bank-zenith",
      action: "REQUESTED",
      envelopeDigestSha256: DIGEST_A,
    });
    const visible = await db.select().from(tradeFinanceConsentEvidence)
      .where(eq(tradeFinanceConsentEvidence.traderUserId, trader1));
    expect(visible.every(r => r.traderUserId === trader1)).toBe(true);
    expect(visible.find(r => r.consentId === "tf-con-901")).toBeUndefined();
  });

  it("enforces the users foreign key (fail-closed referential integrity)", async () => {
    await expect(
      db.insert(tradeFinanceConsentEvidence).values({
        consentId: "tf-con-902",
        traderUserId: 99999999,
        traderRef: "sw-user-99999999",
        bankId: "bank-gtb",
        action: "REQUESTED",
        envelopeDigestSha256: DIGEST_A,
      })
    ).rejects.toThrow();
  });
});
