/**
 * coverage.ts — seed coverage audit.
 *
 * Queries information_schema for every public table and its rowcount,
 * cross-references the drizzle schema registry, asserts zero unpopulated
 * tables (excluding an explicit, justified exemption list), and writes
 * docs/seed-coverage.json.
 *
 * Usage: DATABASE_URL=... SEED_DEMO=true tsx scripts/seed/coverage.ts
 */
import pg from "pg";
import { writeFileSync } from "node:fs";
import { checkSeedingAllowed } from "./gating";
import { buildRegistry } from "./generate";

/**
 * Justified exemptions — tables intentionally left empty by the seeder.
 * Each entry MUST have a reason. Keep this list empty unless a table is
 * genuinely unseedable in a demo context.
 */
export const EXEMPTIONS: Record<string, string> = {
  // Example: "some_audit_table": "populated only by live trigger side-effects",
};

export interface CoverageRow {
  table: string;
  rows: number;
  exempt: boolean;
  reason?: string;
}

export async function collectCoverage(databaseUrl: string): Promise<CoverageRow[]> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const { rows } = await pool.query<{ table_name: string }>(`
      SELECT t.table_name
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    `);
    const names = rows.map((r) => r.table_name).sort();
    const out: CoverageRow[] = [];
    for (const name of names) {
      const c = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM "${name}"`);
      const n = Number(c.rows[0].n);
      out.push({
        table: name,
        rows: n,
        exempt: n === 0 && name in EXEMPTIONS,
        reason: n === 0 ? EXEMPTIONS[name] : undefined,
      });
    }
    return out;
  } finally {
    await pool.end();
  }
}

export function assertCoverage(coverage: CoverageRow[], registrySize: number): void {
  const empty = coverage.filter((c) => c.rows === 0 && !c.exempt);
  if (empty.length) {
    throw new Error(
      `Unpopulated tables without exemption: ${empty.map((c) => c.table).join(", ")}`
    );
  }
  if (coverage.length !== registrySize) {
    console.warn(
      `[coverage] warning: DB has ${coverage.length} public tables, drizzle registry has ${registrySize}`
    );
  }
}

if (process.argv[1] && process.argv[1].endsWith("coverage.ts")) {
  const gate = checkSeedingAllowed(process.env);
  if (!gate.ok) {
    console.error(gate.reason);
    process.exit(1);
  }
  (async () => {
    const coverage = await collectCoverage(process.env.DATABASE_URL!);
    const reg = buildRegistry();
    const populated = coverage.filter((c) => c.rows > 0).length;
    const totalRows = coverage.reduce((s, c) => s + c.rows, 0);
    const report = {
      generatedAt: new Date().toISOString(),
      database: "local-demo",
      totalTables: coverage.length,
      populatedTables: populated,
      totalRows,
      exemptions: coverage.filter((c) => c.exempt),
      tables: coverage,
    };
    writeFileSync("docs/seed-coverage.json", JSON.stringify(report, null, 2));
    console.log(`[coverage] ${populated}/${coverage.length} tables populated, ${totalRows} total rows → docs/seed-coverage.json`);
    assertCoverage(coverage, reg.size);
  })().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
