/**
 * seed.ts — demo seeder entrypoint.
 *
 * Usage:
 *   SEED_DEMO=true DATABASE_URL=postgresql://... tsx scripts/seed/seed.ts
 *
 * Gating: refuses to run under NODE_ENV=production (hard exit) and requires
 * SEED_DEMO=true. Idempotent: deterministic ids + ON CONFLICT DO NOTHING.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { assertSeedingAllowed } from "./gating";
import {
  buildRegistry, topoSort, generateRows, ROW_COUNTS, DEFAULT_ROWS,
} from "./generate";

const BATCH = 200;

export async function runSeed(databaseUrl: string): Promise<void> {
  assertSeedingAllowed();

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  const db = drizzle(pool);
  const reg = buildRegistry();
  const order = topoSort(reg);
  console.log(`[seed] ${reg.size} tables, seeding in dependency order…`);

  const fkPools = new Map<string, unknown[]>();
  const summary: { table: string; attempted: number; inserted: number }[] = [];
  const failures: string[] = [];

  for (const name of order) {
    const def = reg.get(name)!;
    const count = ROW_COUNTS[name] ?? DEFAULT_ROWS;
    if (count <= 0) {
      fkPools.set(name, []);
      continue;
    }
    let rows;
    try {
      rows = generateRows(def, count, fkPools);
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[seed] generation failed for ${name}: ${msg}`);
      failures.push(`${name}: ${msg}`);
      fkPools.set(name, []);
      continue;
    }
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      try {
        const res = await db.insert(def.table).values(chunk).onConflictDoNothing();
        inserted += (res as unknown as { rowCount?: number }).rowCount ?? chunk.length;
      } catch (err) {
        const msg = (err as { cause?: Error })?.cause?.message ?? (err as Error).message;
        console.error(`[seed] insert failed for ${name}: ${msg}`);
        failures.push(`${name}: ${msg}`);
        break; // next chunk
      }
    }
    // Populate pools for children: the PK pool plus a pool per referenced
    // column (FKs may target non-PK unique columns like node_id).
    const pkCols = getTableConfig(def.table).columns.filter((c) => c.primary);
    const refCols = new Set<string>([pkCols[0].name]);
    for (const other of reg.values()) {
      for (const fk of other.fks) {
        if (fk.refTable === name) refCols.add(fk.refColumn);
      }
    }
    for (const colName of refCols) {
      const existing = await db.execute(
        sql.raw(`SELECT DISTINCT "${colName}" AS id FROM "${name}" LIMIT 10000`)
      );
      const vals = (existing.rows as { id: unknown }[]).map((r) => r.id);
      if (colName === pkCols[0].name) fkPools.set(name, vals);
      fkPools.set(`${name}.${colName}`, vals);
    }
    summary.push({ table: name, attempted: count, inserted });
    console.log(`[seed] ${name}: ${inserted}/${count} rows (pool=${fkPools.get(name)!.length})`);
  }

  // KPIs derived honestly from the seeded facts (never fabricated).
  const { seedDerivedKpis } = await import("./derivedKpis");
  await seedDerivedKpis(db);

  const total = summary.reduce((s, r) => s + r.inserted, 0);
  console.log(`[seed] done. ${summary.length} tables seeded, ${total} rows inserted this run (idempotent reruns insert 0).`);
  await pool.end();
  if (failures.length) {
    console.error(`[seed] ${failures.length} table(s) FAILED:\n${failures.join("\n")}`);
    process.exit(1);
  }
}

// CLI
if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  const url = process.env.DATABASE_URL;
  runSeed(url!).catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
