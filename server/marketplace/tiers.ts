/**
 * marketplace/tiers.ts — monetization tier model + usage→billing aggregation
 * (Phase 12, WP-8 extension).
 *
 *  - Tier catalogue lives in marketplace_tiers (migration 0066, seeded
 *    free/builder/enterprise; operator pricing wins on conflict).
 *  - Key→tier binding: api_keys.tier_id; binding applies the tier's rate
 *    limit to the key so enforcement stays in the existing requireApiKey
 *    middleware (single metering path).
 *  - Billing is QUERY-TIME aggregation over api_usage_logs — no billing data
 *    duplication. Invoice itemization: production (non-sandbox) calls are
 *    priced at the bound tier's price_per_call_usd; sandbox calls are
 *    itemized at zero. Period is bounded (MAX_INVOICE_PERIOD_DAYS).
 *
 * Fail-closed: invoicing an unknown key, an unbounded/absurd period, or a
 * key with no tier produces explicit errors — never a zero invoice presented
 * as real billing.
 */
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { apiKeys, apiUsageLogs, marketplaceTiers, type MarketplaceTier } from "../../drizzle/schema";

export const MAX_INVOICE_PERIOD_DAYS = 92;

export class MarketplaceBillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplaceBillingError";
  }
}

export async function listTiers(): Promise<MarketplaceTier[]> {
  const db = (await getDb())!;
  return db.select().from(marketplaceTiers).orderBy(marketplaceTiers.monthlyFeeUsd);
}

export async function getTierByCode(code: string): Promise<MarketplaceTier | null> {
  const db = (await getDb())!;
  const [t] = await db.select().from(marketplaceTiers).where(eq(marketplaceTiers.code, code)).limit(1);
  return t ?? null;
}

/**
 * Bind an API key to a tier. Applies the tier's rate limit to the key so the
 * gateway middleware enforces the commercial plan without a second lookup.
 */
export async function bindKeyToTier(keyId: number, tierCode: string): Promise<{ keyId: number; tier: MarketplaceTier }> {
  const db = (await getDb())!;
  const tier = await getTierByCode(tierCode);
  if (!tier) throw new MarketplaceBillingError(`Unknown marketplace tier "${tierCode}"`);
  const [key] = await db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1);
  if (!key) throw new MarketplaceBillingError(`API key ${keyId} not found`);
  await db
    .update(apiKeys)
    .set({ tierId: tier.id, rateLimit: tier.rateLimitPerMinute })
    .where(eq(apiKeys.id, keyId));
  return { keyId, tier };
}

export interface InvoiceLine {
  endpoint: string;
  method: string;
  calls: number;
  unitPriceUsd: string;
  amountUsd: string;
}

export interface UsageInvoice {
  keyId: number;
  keyPrefix: string;
  tier: { code: string; name: string; pricePerCallUsd: string; monthlyFeeUsd: string };
  period: { from: string; to: string };
  lines: InvoiceLine[];
  totalCalls: number;
  billableCalls: number;
  usageChargesUsd: string;
  monthlyFeeUsd: string;
  totalDueUsd: string;
  currency: "USD";
}

/**
 * Pure pricing helper (unit-tested): price one usage bucket.
 * Sandbox usage is always zero-rated.
 */
export function priceBucket(calls: number, unitPrice: string, sandbox: boolean): string {
  if (sandbox || calls <= 0) return "0";
  const unit = Number(unitPrice);
  if (!Number.isFinite(unit) || unit < 0) throw new MarketplaceBillingError(`Invalid tier unit price "${unitPrice}"`);
  return (calls * unit).toFixed(6);
}

/** Validate and normalize an invoice period (pure, fail-closed). */
export function normalizeInvoicePeriod(fromRaw: string, toRaw: string, now: Date = new Date()): { from: Date; to: Date } {
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new MarketplaceBillingError("Invoice period bounds must be valid ISO dates");
  }
  if (from >= to) throw new MarketplaceBillingError("Invoice period 'from' must precede 'to'");
  if (to.getTime() > now.getTime() + 5 * 60_000) {
    throw new MarketplaceBillingError("Invoice period 'to' cannot be in the future");
  }
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days > MAX_INVOICE_PERIOD_DAYS) {
    throw new MarketplaceBillingError(`Invoice period exceeds ${MAX_INVOICE_PERIOD_DAYS} days`);
  }
  return { from, to };
}

export async function buildUsageInvoice(keyId: number, fromRaw: string, toRaw: string): Promise<UsageInvoice> {
  const db = (await getDb())!;
  const { from, to } = normalizeInvoicePeriod(fromRaw, toRaw);
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1);
  if (!key) throw new MarketplaceBillingError(`API key ${keyId} not found`);
  if (key.tierId == null) {
    throw new MarketplaceBillingError(
      `API key ${keyId} has no tier binding; refusing to price unclassified usage (fail-closed)`
    );
  }
  const [tier] = await db.select().from(marketplaceTiers).where(eq(marketplaceTiers.id, key.tierId)).limit(1);
  if (!tier) throw new MarketplaceBillingError(`Tier ${key.tierId} referenced by key ${keyId} not found`);

  const buckets = await db
    .select({
      endpoint: apiUsageLogs.endpoint,
      method: apiUsageLogs.method,
      sandboxMode: apiUsageLogs.sandboxMode,
      calls: sql<number>`count(*)::int`,
    })
    .from(apiUsageLogs)
    .where(
      and(
        eq(apiUsageLogs.apiKeyId, keyId),
        gte(apiUsageLogs.createdAt, from),
        lte(apiUsageLogs.createdAt, to)
      )
    )
    .groupBy(apiUsageLogs.endpoint, apiUsageLogs.method, apiUsageLogs.sandboxMode)
    .orderBy(apiUsageLogs.endpoint);

  const lines: InvoiceLine[] = buckets.map((b) => ({
    endpoint: b.endpoint,
    method: b.method,
    calls: b.calls,
    unitPriceUsd: b.sandboxMode ? "0" : tier.pricePerCallUsd,
    amountUsd: priceBucket(b.calls, tier.pricePerCallUsd, b.sandboxMode),
  }));
  const totalCalls = lines.reduce((s, l) => s + l.calls, 0);
  const billableCalls = buckets.filter((b) => !b.sandboxMode).reduce((s, b) => s + b.calls, 0);
  const usageCharges = lines.reduce((s, l) => s + Number(l.amountUsd), 0);
  const totalDue = usageCharges + Number(tier.monthlyFeeUsd);

  return {
    keyId: key.id,
    keyPrefix: key.keyPrefix,
    tier: {
      code: tier.code,
      name: tier.name,
      pricePerCallUsd: tier.pricePerCallUsd,
      monthlyFeeUsd: tier.monthlyFeeUsd,
    },
    period: { from: from.toISOString(), to: to.toISOString() },
    lines,
    totalCalls,
    billableCalls,
    usageChargesUsd: usageCharges.toFixed(6),
    monthlyFeeUsd: tier.monthlyFeeUsd,
    totalDueUsd: totalDue.toFixed(2),
    currency: "USD",
  };
}

/** Usage rollup for the marketplace portal charts (per-day buckets). */
export async function usageSeriesForKey(keyId: number, days = 30) {
  const db = (await getDb())!;
  const capped = Math.min(Math.max(days, 1), 92);
  const since = new Date(Date.now() - capped * 86_400_000);
  return db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${apiUsageLogs.createdAt}), 'YYYY-MM-DD')`,
      calls: sql<number>`count(*)::int`,
      productionCalls: sql<number>`count(*) filter (where ${apiUsageLogs.sandboxMode} = false)::int`,
    })
    .from(apiUsageLogs)
    .where(and(eq(apiUsageLogs.apiKeyId, keyId), gte(apiUsageLogs.createdAt, since)))
    .groupBy(sql`date_trunc('day', ${apiUsageLogs.createdAt})`)
    .orderBy(sql`date_trunc('day', ${apiUsageLogs.createdAt})`);
}
