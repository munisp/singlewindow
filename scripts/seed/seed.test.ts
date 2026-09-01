/**
 * seed.test.ts — PG-free smoke tests for the demo seeder.
 *
 * Covers: environment gating (production hard-refusal, SEED_DEMO
 * requirement, remote-host guard) and determinism/idempotency of the
 * row-generation logic (same inputs → byte-identical rows, stable ids).
 */
import { describe, it, expect } from "vitest";
import {
  checkSeedingAllowed, isLocalDatabaseUrl, SeedGateError, assertSeedingAllowed,
} from "./gating";
import { fnv1a, uuidFromSeed, serialId, Rng } from "./deterministic";
import { buildRegistry, topoSort, generateRows, ROW_COUNTS, DEFAULT_ROWS } from "./generate";
import { imoWithCheckDigit, mmsiNG } from "./domainData";

const LOCAL_URL = "postgresql://postgres@localhost:55432/singlewindow";

describe("seeder gating", () => {
  it("hard-refuses NODE_ENV=production even with SEED_DEMO=true", () => {
    const r = checkSeedingAllowed({
      NODE_ENV: "production", SEED_DEMO: "true", DATABASE_URL: LOCAL_URL,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/production/i);
  });

  it("refuses without explicit SEED_DEMO=true", () => {
    expect(checkSeedingAllowed({ NODE_ENV: "development", DATABASE_URL: LOCAL_URL }).ok).toBe(false);
    expect(checkSeedingAllowed({ NODE_ENV: "development", SEED_DEMO: "1", DATABASE_URL: LOCAL_URL }).ok).toBe(true);
  });

  it("refuses missing DATABASE_URL", () => {
    expect(checkSeedingAllowed({ SEED_DEMO: "true" }).ok).toBe(false);
  });

  it("refuses remote-looking DATABASE_URL unless SEED_ALLOW_REMOTE=true", () => {
    const remote = "postgresql://u:p@db.prod.example.com:5432/sw";
    expect(checkSeedingAllowed({ SEED_DEMO: "true", DATABASE_URL: remote }).ok).toBe(false);
    expect(
      checkSeedingAllowed({ SEED_DEMO: "true", SEED_ALLOW_REMOTE: "true", DATABASE_URL: remote }).ok
    ).toBe(true);
  });

  it("recognises local URLs (localhost, loopback, unix socket)", () => {
    expect(isLocalDatabaseUrl(LOCAL_URL)).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://u@127.0.0.1:5432/db")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://u@%2Fhome%2Fkimi/db")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://u@db.internal.corp:5432/db")).toBe(false);
  });

  it("assertSeedingAllowed throws SeedGateError outside production", () => {
    expect(() => assertSeedingAllowed({ NODE_ENV: "development" })).toThrow(SeedGateError);
  });
});

describe("deterministic primitives", () => {
  it("fnv1a is stable", () => {
    expect(fnv1a("declarations")).toBe(fnv1a("declarations"));
    expect(fnv1a("a")).not.toBe(fnv1a("b"));
  });

  it("uuidFromSeed is deterministic and v4-shaped", () => {
    const a = uuidFromSeed("users.0");
    expect(a).toBe(uuidFromSeed("users.0"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidFromSeed("users.0")).not.toBe(uuidFromSeed("users.1"));
  });

  it("serialId bands never collide across tables and stay int32-positive", () => {
    const ids = new Set<number>();
    for (const t of ["users", "declarations", "payments", "tenants"]) {
      for (let i = 0; i < 100; i++) {
        const id = serialId(t, i);
        expect(id).toBeGreaterThan(0);
        expect(id).toBeLessThan(2 ** 31);
        ids.add(id);
      }
    }
    expect(ids.size).toBe(400);
  });

  it("Rng sequences are reproducible", () => {
    const a = new Rng("k"), b = new Rng("k");
    for (let i = 0; i < 50; i++) expect(a.float()).toBe(b.float());
  });
});

describe("row generation determinism (idempotency basis)", () => {
  const reg = buildRegistry();

  it("registry covers all drizzle tables", () => {
    expect(reg.size).toBeGreaterThanOrEqual(160);
  });

  it("topoSort seeds users before declarations", () => {
    const order = topoSort(reg);
    expect(order.length).toBe(reg.size);
    expect(order.indexOf("users")).toBeLessThan(order.indexOf("declarations"));
    expect(order.indexOf("declarations")).toBeLessThan(order.indexOf("payments"));
  });

  it("generateRows is byte-identical across invocations", () => {
    const def = reg.get("users")!;
    const a = generateRows(def, 10, new Map());
    const b = generateRows(def, 10, new Map());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("generated primary keys are deterministic and unique within a table", () => {
    const def = reg.get("declarations")!;
    const rows = generateRows(def, 25, new Map());
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every configured table has a positive row count", () => {
    for (const [t, n] of Object.entries(ROW_COUNTS)) {
      expect(n, t).toBeGreaterThan(0);
    }
    expect(DEFAULT_ROWS).toBeGreaterThan(0);
  });
});

describe("domain data validity", () => {
  it("IMO numbers carry a valid check digit", () => {
    for (const base of ["907472", "943610", "900000", "999999"]) {
      const imo = imoWithCheckDigit(base);
      expect(imo).toHaveLength(7);
      const d = imo.split("").map(Number);
      const sum = d[0] * 7 + d[1] * 6 + d[2] * 5 + d[3] * 4 + d[4] * 3 + d[5] * 2;
      expect(sum % 10).toBe(d[6]);
    }
  });

  it("MMSIs are 9 digits with Nigerian MID 657", () => {
    for (const s of [1, 123456, 999999]) {
      const m = mmsiNG(s);
      expect(m).toMatch(/^\d{9}$/);
      expect(m.startsWith("657")).toBe(true);
    }
  });
});
