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

type Comparison = { key: string; op: "=" | "<" | "<=" | ">" | ">=" | "in"; value: unknown };

/** Walk a drizzle SQL condition, collecting column→param comparison triples. */
function extractComparisons(cond: unknown, out: Comparison[]): void {
  if (!(cond instanceof SQL)) return;
  let lastColumn: Column | null = null;
  let pendingOp: Comparison["op"] = "=";
  for (const chunk of (cond as any).queryChunks as unknown[]) {
    if (chunk instanceof SQL) {
      extractComparisons(chunk, out);
      lastColumn = null;
      continue;
    }
    if (chunk instanceof Column) {
      lastColumn = chunk;
      pendingOp = "=";
      continue;
    }
    // Param must be tested before the generic string branch: a Param wrapping
    // a string value (e.g. a status literal) is NOT an operator StringChunk.
    if (chunk instanceof Param) {
      if (lastColumn) {
        out.push({ key: snakeToCamel(lastColumn.name), op: pendingOp, value: (chunk as any).value });
        lastColumn = null;
        pendingOp = "=";
      }
      continue;
    }
    // StringChunk: pick up comparison operators that sit between a Column
    // and its Param (e.g. lte() renders `"col" <= $1`).
    const text = (chunk as any)?.value ?? chunk;
    if (typeof text === "string" || (Array.isArray(text) && text.every((t) => typeof t === "string"))) {
      const s = (Array.isArray(text) ? text.join("") : text).trim();
      if (/\bin\b/i.test(s)) {
        // inArray(col, [...]) renders `"col" in ($1, $2, ...)` — every
        // following Param (until the next Column) belongs to the IN list.
        pendingOp = "in";
      } else if (s === "<=" || s === ">=" || s === "<" || s === ">" || s === "=") {
        pendingOp = s;
      }
      continue;
    }
  }
}

function toComparable(v: unknown): number | string {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number" || typeof v === "string") return v;
  return String(v);
}

function matches(row: Row, cond: unknown): boolean {
  const comparisons: Comparison[] = [];
  extractComparisons(cond, comparisons);
  // Group IN-list values per column: row matches if its value equals ANY.
  const inValues = new Map<string, unknown[]>();
  for (const c of comparisons) {
    if (c.op !== "in") continue;
    const list = inValues.get(c.key) ?? [];
    list.push(c.value);
    inValues.set(c.key, list);
  }
  for (const [key, values] of inValues) {
    if (!values.some((v) => row[key] === v)) return false;
  }
  return comparisons.every((c) => {
    if (c.op === "in") return true; // handled above
    const lhs = toComparable(row[c.key]);
    const rhs = toComparable(c.value);
    switch (c.op) {
      case "<": return lhs < rhs;
      case "<=": return lhs <= rhs;
      case ">": return lhs > rhs;
      case ">=": return lhs >= rhs;
      default: return row[c.key] === c.value;
    }
  });
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

/** Extract (column, direction) sort keys from orderBy() arguments. */
function sortKeysFrom(args: unknown[]): Array<{ key: string; dir: 1 | -1 }> {
  const keys: Array<{ key: string; dir: 1 | -1 }> = [];
  for (const arg of args) {
    if (arg instanceof Column) {
      keys.push({ key: snakeToCamel(arg.name), dir: 1 });
      continue;
    }
    if (arg instanceof SQL) {
      let key: string | null = null;
      let dir: 1 | -1 = 1;
      for (const chunk of (arg as any).queryChunks as unknown[]) {
        if (chunk instanceof Column) key = snakeToCamel(chunk.name);
        const text = (chunk as any)?.value ?? chunk;
        const s = Array.isArray(text) ? text.join("") : typeof text === "string" ? text : "";
        if (/\bdesc\b/i.test(s)) dir = -1;
      }
      if (key) keys.push({ key, dir });
    }
  }
  return keys;
}

function sortRows(rows: Row[], args: unknown[]): Row[] {
  const keys = sortKeysFrom(args);
  if (keys.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const { key, dir } of keys) {
      const av = toComparable(a[key]);
      const bv = toComparable(b[key]);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
    }
    return 0;
  });
}

export function createMockDrizzleDb(store: MockStore) {
  let nextId = 1;
  /** Chainable result set supporting where/orderBy/limit/offset.
   *  limit/offset are applied at resolution time so `LIMIT n OFFSET m`
   *  returns rows m..m+n (NOT slice(0,n) then drop m). */
  const makeChain = (rows: Row[], lim?: number, off = 0): any => {
    const resolved = () => rows.slice(off, lim === undefined ? undefined : off + lim);
    return {
      limit: (n: number) => makeChain(rows, n, off),
      offset: (n: number) => makeChain(rows, lim, n),
      orderBy: (...cols: unknown[]) => makeChain(sortRows(resolved(), cols)),
      then(resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(resolved()).then(resolve, reject);
      },
    };
  };
  return {
    select: () => ({
      from: (table: unknown) => {
        const all = rowsFor(store, table);
        return awaitable(all, {
          where: (cond: unknown) => makeChain(all.filter((r) => matches(r, cond))),
          orderBy: (...cols: unknown[]) => makeChain(sortRows(all, cols)),
          limit: (n: number) => makeChain(all.slice(0, n)),
          offset: (n: number) => makeChain(all.slice(n)),
        });
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
