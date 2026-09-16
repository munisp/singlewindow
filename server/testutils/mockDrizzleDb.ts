/**
 * mockDrizzleDb.ts — in-memory mock of the drizzle query-builder chains used
 * by router unit tests (Phase 19 F5a; pattern follows the existing
 * *.remediation.test.ts mocks but with REAL where-condition evaluation).
 *
 * Rows are stored keyed by drizzle TS property names (camelCase — the shape
 * drizzle returns). Conditions built from eq()/and() are evaluated by
 * walking the SQL query chunks and matching Column→Param pairs; the DB
 * column name (snake_case) is camelised to the TS property key.
 *
 * Supported chains (exactly what the Phase-19 routers use):
 *   db.select().from(t)[.where(cond)][.limit(n)]   (awaitable)
 *   db.insert(t).values(v)[.returning()]
 *   db.update(t).set(v).where(cond)[.returning()]
 *   db.delete(t).where(cond)
 */
import { Column, Param, SQL } from "drizzle-orm";

type Row = Record<string, any>;
export type MockStore = Record<string, Row[]>;

function tableName(table: unknown): string {
  const name = (table as any)?.[Symbol.for("drizzle:Name")];
  return String(name ?? "");
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/** Walk a drizzle SQL condition, collecting column→param equality pairs. */
function extractEqPairs(cond: unknown, pairs: Array<{ key: string; value: unknown }>): void {
  if (!(cond instanceof SQL)) return;
  let lastColumn: Column | null = null;
  for (const chunk of (cond as any).queryChunks as unknown[]) {
    if (chunk instanceof SQL) {
      extractEqPairs(chunk, pairs);
      lastColumn = null;
      continue;
    }
    if (chunk instanceof Column) {
      lastColumn = chunk;
      continue;
    }
    if (chunk instanceof Param && lastColumn) {
      pairs.push({ key: snakeToCamel(lastColumn.name), value: (chunk as any).value });
      lastColumn = null;
      continue;
    }
    // StringChunk / Name / Table / plain string separators are ignored:
    // in eq()/and() chains a Param always directly follows its Column.
  }
}

function matches(row: Row, cond: unknown): boolean {
  const pairs: Array<{ key: string; value: unknown }> = [];
  extractEqPairs(cond, pairs);
  return pairs.every((p) => row[p.key] === p.value);
}

function rowsFor(store: MockStore, table: unknown): Row[] {
  const name = tableName(table);
  if (!(name in store)) store[name] = [];
  return store[name];
}

function awaitable<T>(value: T, extra: Record<string, unknown> = {}): any {
  return {
    ...extra,
    then(resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

export function createMockDrizzleDb(store: MockStore) {
  let nextId = 1;
  return {
    select: () => ({
      from: (table: unknown) => {
        const all = rowsFor(store, table);
        const base = awaitable(all, {
          where: (cond: unknown) => {
            const filtered = all.filter((r) => matches(r, cond));
            return awaitable(filtered, {
              limit: async (n: number) => filtered.slice(0, n),
            });
          },
        });
        return base;
      },
    }),
    insert: (table: unknown) => ({
      values: (v: Row | Row[]) => {
        const rows = (Array.isArray(v) ? v : [v]).map((row) => ({ id: nextId++, createdAt: new Date(), ...row }));
        rowsFor(store, table).push(...rows);
        return awaitable(rows, { returning: async () => rows });
      },
    }),
    update: (table: unknown) => ({
      set: (v: Row) => ({
        where: (cond: unknown) => {
          const all = rowsFor(store, table);
          const updated = all.filter((r) => matches(r, cond));
          for (const row of updated) Object.assign(row, v);
          return awaitable(updated, { returning: async () => updated });
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        const all = rowsFor(store, table);
        const doomed = all.filter((r) => matches(r, cond));
        store[tableName(table)] = all.filter((r) => !doomed.includes(r));
        return awaitable(doomed);
      },
    }),
  };
}
