/**
 * crm/stakeholders.ts — Stakeholder-360 unified party profile (Phase 12).
 *
 * Query-time aggregation ONLY — no data duplication. A stakeholder is a row
 * in stakeholder_profiles (party: trader/agent/carrier/insurer/government).
 * The 360 view joins live across the existing domain tables keyed by the
 * profile's user id:
 *   - declarations (trader_id)
 *   - payments (trader_id)
 *   - OGA permits (via the party's declarations)
 *   - clearance certificates (via the party's declarations)
 *   - API marketplace keys + usage (api_keys.user_id / api_usage_logs)
 *   - open CRM cases (crm_cases.stakeholder_profile_id)
 *
 * Tax stamps and insurance policies live in sibling services
 * (blueeconomy-tax-stamps / insurance providers); no local table exists, so
 * those aggregates are reported as honest `unavailable` surfaces rather than
 * fabricated zeros presented as real data (fail-closed doctrine).
 */
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import {
  apiKeys,
  apiUsageLogs,
  clearanceCertificates,
  crmCases,
  declarations,
  ogaPermits,
  payments,
  stakeholderProfiles,
  users,
} from "../../drizzle/schema";

export const SEARCH_MAX_PAGE_SIZE = 50;

export interface StakeholderSearchFilter {
  /** Free-text match across organization name/code, TIN (taxId), license. */
  q?: string;
  stakeholderType?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function searchStakeholders(filter: StakeholderSearchFilter) {
  const db = (await getDb())!;
  const conds: SQL[] = [];
  if (filter.q && filter.q.trim()) {
    const term = `%${filter.q.trim().slice(0, 120)}%`;
    conds.push(
      or(
        ilike(stakeholderProfiles.organizationName, term),
        ilike(stakeholderProfiles.organizationCode, term),
        ilike(stakeholderProfiles.taxId, term),
        ilike(stakeholderProfiles.licenseNumber, term)
      )!
    );
  }
  if (filter.stakeholderType) conds.push(eq(stakeholderProfiles.stakeholderType, filter.stakeholderType as any));
  if (filter.status) conds.push(eq(stakeholderProfiles.status, filter.status as any));
  const where = conds.length ? and(...conds) : undefined;
  // Hard pagination caps — a search page never returns more than
  // SEARCH_MAX_PAGE_SIZE rows, regardless of the requested limit.
  const limit = Math.min(Math.max(filter.limit ?? 25, 1), SEARCH_MAX_PAGE_SIZE);
  const offset = Math.max(filter.offset ?? 0, 0);
  const [items, countRows] = await Promise.all([
    db
      .select({
        id: stakeholderProfiles.id,
        userId: stakeholderProfiles.userId,
        stakeholderType: stakeholderProfiles.stakeholderType,
        organizationName: stakeholderProfiles.organizationName,
        organizationCode: stakeholderProfiles.organizationCode,
        taxId: stakeholderProfiles.taxId,
        licenseNumber: stakeholderProfiles.licenseNumber,
        country: stakeholderProfiles.country,
        status: stakeholderProfiles.status,
        aeoStatus: stakeholderProfiles.aeoStatus,
        aeoTier: stakeholderProfiles.aeoTier,
        createdAt: stakeholderProfiles.createdAt,
      })
      .from(stakeholderProfiles)
      .where(where)
      .orderBy(desc(stakeholderProfiles.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(stakeholderProfiles).where(where),
  ]);
  return { items, total: Number(countRows[0]?.count ?? 0), limit, offset };
}

export class StakeholderNotFoundError extends Error {
  constructor(id: number) {
    super(`Stakeholder profile ${id} not found`);
    this.name = "StakeholderNotFoundError";
  }
}

export async function getStakeholder360(profileId: number) {
  const db = (await getDb())!;
  const [profile] = await db
    .select()
    .from(stakeholderProfiles)
    .where(eq(stakeholderProfiles.id, profileId))
    .limit(1);
  if (!profile) throw new StakeholderNotFoundError(profileId);
  const [owner] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, lastSignedIn: users.lastSignedIn })
    .from(users)
    .where(eq(users.id, profile.userId))
    .limit(1);

  const uid = profile.userId;

  const [declAgg, declRecent, payAgg, keys, openCases, permits, certs] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        cleared: sql<number>`count(*) filter (where ${declarations.status} = 'cleared')::int`,
        // "Active pipeline" = every declaration_status enum value that is
        // neither terminal (cleared/rejected/cancelled) nor pre-submission
        // (draft). NOTE: the declaration_status enum has no 'under_review'
        // or 'assessed' values — the real in-flight values are
        // under_assessment / docs_required / payment_pending /
        // payment_confirmed / under_examination / examination_complete /
        // held_sanctions (see drizzle/schema.ts declarationStatusEnum).
        pending: sql<number>`count(*) filter (where ${declarations.status} in ('submitted','under_assessment','docs_required','payment_pending','payment_confirmed','under_examination','examination_complete','held_sanctions'))::int`,
        totalDuty: sql<string>`coalesce(sum(${declarations.dutyAmount}), 0)::text`,
      })
      .from(declarations)
      .where(eq(declarations.traderId, uid)),
    db
      .select()
      .from(declarations)
      .where(eq(declarations.traderId, uid))
      .orderBy(desc(declarations.createdAt))
      .limit(10),
    db
      .select({
        total: sql<number>`count(*)::int`,
        confirmed: sql<number>`count(*) filter (where ${payments.status} = 'confirmed')::int`,
        failed: sql<number>`count(*) filter (where ${payments.status} = 'failed')::int`,
        totalPaid: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.status} = 'confirmed'), 0)::text`,
      })
      .from(payments)
      .where(eq(payments.traderId, uid)),
    db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        status: apiKeys.status,
        sandboxMode: apiKeys.sandboxMode,
        rateLimit: apiKeys.rateLimit,
        tierId: apiKeys.tierId,
        lastUsedAt: apiKeys.lastUsedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, uid)),
    db
      .select()
      .from(crmCases)
      .where(and(eq(crmCases.stakeholderProfileId, profileId), sql`${crmCases.status} <> 'closed'`))
      .orderBy(desc(crmCases.createdAt))
      .limit(20),
    db
      .select({
        id: ogaPermits.id,
        declarationId: ogaPermits.declarationId,
        agencyCode: ogaPermits.agencyCode,
        status: ogaPermits.status,
        createdAt: ogaPermits.createdAt,
      })
      .from(ogaPermits)
      .innerJoin(declarations, eq(ogaPermits.declarationId, declarations.id))
      .where(eq(declarations.traderId, uid))
      .orderBy(desc(ogaPermits.createdAt))
      .limit(10),
    db
      .select({
        id: clearanceCertificates.id,
        declarationId: clearanceCertificates.declarationId,
      })
      .from(clearanceCertificates)
      .where(eq(clearanceCertificates.traderId, uid))
      .orderBy(desc(clearanceCertificates.id))
      .limit(10),
  ]);

  const keyIds = keys.map((k) => k.id);
  const usage = keyIds.length
    ? await db
        .select({
          apiKeyId: apiUsageLogs.apiKeyId,
          calls30d: sql<number>`count(*) filter (where ${apiUsageLogs.createdAt} >= now() - interval '30 days')::int`,
          callsTotal: sql<number>`count(*)::int`,
        })
        .from(apiUsageLogs)
        .where(inArray(apiUsageLogs.apiKeyId, keyIds))
        .groupBy(apiUsageLogs.apiKeyId)
    : [];
  const usageByKey = new Map(usage.map((u) => [u.apiKeyId, u]));

  // Unified interaction timeline (query-time union; capped).
  const timeline = [
    ...declRecent.map((d) => ({
      at: d.createdAt,
      kind: "declaration" as const,
      ref: d.declarationNumber,
      detail: `${d.declarationType} → ${d.status}`,
    })),
    ...permits.map((p) => ({
      at: p.createdAt,
      kind: "oga_permit" as const,
      ref: `${p.agencyCode}#${p.id}`,
      detail: p.status,
    })),
    ...openCases.map((c) => ({
      at: c.createdAt,
      kind: "case" as const,
      ref: c.caseNumber,
      detail: `${c.caseType} (${c.status})`,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 50);

  return {
    profile,
    owner: owner ?? null,
    aggregates: {
      declarations: declAgg[0] ?? { total: 0, cleared: 0, pending: 0, totalDuty: "0" },
      payments: payAgg[0] ?? { total: 0, confirmed: 0, failed: 0, totalPaid: "0" },
      apiKeys: keys.map((k) => ({
        ...k,
        usage: usageByKey.get(k.id) ?? { calls30d: 0, callsTotal: 0 },
      })),
      openCases: openCases.length,
      // Honest unavailability — these domains are served by sibling services
      // with no local table; we do not fabricate counts.
      taxStamps: { available: false as const, reason: "Served by blueeconomy-tax-stamps (external service); no local store" },
      insurancePolicies: { available: false as const, reason: "Served by external insurance providers; no local store" },
    },
    recentDeclarations: declRecent,
    recentPermits: permits,
    recentCertificates: certs,
    timeline,
  };
}
