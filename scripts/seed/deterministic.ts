/**
 * deterministic.ts — deterministic PRNG + ID helpers.
 *
 * Every value the seeder emits is a pure function of (table, rowIndex, column)
 * so re-running the seeder produces byte-identical rows and ON CONFLICT DO
 * NOTHING makes reruns no-ops (idempotent).
 */

export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — small, fast, deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;
  constructor(seedKey: string) {
    this.next = mulberry32(fnv1a(seedKey));
  }
  float(): number {
    return this.next();
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  bigint(min: bigint, max: bigint): bigint {
    const span = max - min + 1n;
    const r = BigInt(Math.floor(this.next() * Number(span > 1_000_000n ? 1_000_000n : span)));
    return min + (span > 1_000_000n ? r * (span / 1_000_000n) : r);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** Weighted pick: pairs of [value, weight]. */
  weighted<T>(pairs: readonly (readonly [T, number])[]): T {
    const total = pairs.reduce((s, p) => s + p[1], 0);
    let r = this.next() * total;
    for (const [v, w] of pairs) {
      r -= w;
      if (r <= 0) return v;
    }
    return pairs[pairs.length - 1][0];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  hex(len: number): string {
    let s = "";
    while (s.length < len) {
      s += Math.floor(this.next() * 0xffffffff)
        .toString(16)
        .padStart(8, "0");
    }
    return s.slice(0, len);
  }
}

/** Deterministic UUID (v4-shaped) from a seed string. */
export function uuidFromSeed(seed: string): string {
  const h = (salt: number) =>
    fnv1a(`${salt}:${seed}`).toString(16).padStart(8, "0");
  const hex = (h(1) + h(2) + h(3) + h(4)).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(
    16,
    20
  )}-${s.slice(20, 32)}`;
}

/**
 * Deterministic serial id for a (table, rowIndex). Uses a per-table band of
 * 1,000,000 ids inside the positive int32 range, reserved high so they never
 * collide with organically-sequence-allocated ids in a fresh demo database.
 */
export function serialId(table: string, rowIndex: number): number {
  const band = fnv1a(`serial-band:${table}`) % 1900; // 0..1899
  return 100_000_000 + band * 1_000_000 + (rowIndex % 1_000_000);
}

/** Fixed anchor instant — all seeded timestamps derive from this. */
export const SEED_EPOCH = Date.UTC(2026, 0, 15, 8, 0, 0); // 2026-01-15T08:00Z

export function daysBeforeEpoch(rng: Rng, maxDays: number, jitterHours = 10): Date {
  const ms =
    rng.int(0, maxDays) * 86_400_000 + rng.int(0, jitterHours) * 3_600_000 +
    rng.int(0, 3599) * 1000;
  return new Date(SEED_EPOCH - ms);
}

export function daysAfter(rng: Rng, base: Date, minDays: number, maxDays: number): Date {
  return new Date(base.getTime() + rng.int(minDays, maxDays) * 86_400_000 +
    rng.int(0, 8) * 3_600_000);
}
