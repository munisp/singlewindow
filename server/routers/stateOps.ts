/**
 * Phase 28 (W1): stateOps — state blue-economy revenue router.
 * State licensing, concessions, aquaculture estates and blue-carbon MRV
 * (monitoring / reporting / verification) for Nigeria's eight coastal states.
 *
 * Phase 29 (W1) extends this router with fisheries permits, IUU penalties,
 * small-craft registry, dredging permits/volume declarations (royalty accrual
 * computed server-side), water-transport routes and state revenue shares
 * (migration 0082_phase29_state_ops_ext).
 *
 * All data is persisted in Postgres (migrations 0081_phase28_state_ops,
 * 0082_phase29_state_ops_ext) — no
 * simulated revenue figures. MRV evidence records are tamper-evident via an
 * HMAC-SHA256 verification hash keyed by PROOF_SIGNING_KEY (fail-closed:
 * with the key unset, addMrvEvidence returns 503 rather than storing
 * unverifiable evidence — same fail-closed pattern as the blue-economy
 * credential-verification flow).
 */
import { z } from "zod";
import { createHmac } from "crypto";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  stateLicenses,
  stateConcessions,
  aquacultureEstates,
  blueCarbonProjects,
  mrvEvidence,
  fisheriesPermits,
  iuuPenalties,
  smallCraftRegistry,
  dredgingPermits,
  dredgingDeclarations,
  waterTransportRoutes,
  stateRevenueShares,
} from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";

/** Nigeria's eight coastal states — the only valid `state` values. */
export const COASTAL_STATES = [
  "Lagos",
  "Rivers",
  "Bayelsa",
  "Delta",
  "Akwa Ibom",
  "Cross River",
  "Ondo",
  "Edo",
] as const;

const CoastalStateEnum = z.enum(COASTAL_STATES);
const LicenseStatusEnum = z.enum(["PENDING", "ACTIVE", "EXPIRED", "REVOKED"]);
const ConcessionStatusEnum = z.enum(["ACTIVE", "SUSPENDED", "TERMINATED", "EXPIRED"]);
const EstateStatusEnum = z.enum(["ACTIVE", "SUSPENDED", "DECOMMISSIONED"]);
const CarbonProjectStatusEnum = z.enum(["PROPOSED", "REGISTERED", "ISSUING", "SUSPENDED", "RETIRED"]);
const FisheriesPermitTypeEnum = z.enum(["industrial", "artisanal", "crab_shrimp", "collection"]);
const FisheriesPermitStatusEnum = z.enum(["active", "suspended", "revoked", "expired"]);
const IuuPenaltyStatusEnum = z.enum(["assessed", "appealed", "paid", "waived"]);
const SmallCraftStatusEnum = z.enum(["active", "suspended", "deregistered"]);
const DredgingPermitStatusEnum = z.enum(["active", "suspended", "revoked", "expired"]);
const WaterRouteStatusEnum = z.enum(["active", "suspended"]);

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
  return db;
}

/** Canonical MRV evidence payload — keep field order stable for recompute. */
function mrvPayload(parts: {
  projectId: number;
  evidenceType: string;
  period: string | null;
  co2Tonnes: string | number;
  documentUri: string | null;
}): string {
  return `${parts.projectId}|${parts.evidenceType}|${parts.period ?? ""}|${parts.co2Tonnes}|${parts.documentUri ?? ""}`;
}

function signMrvPayload(payload: string): string {
  const key = process.env.PROOF_SIGNING_KEY;
  if (!key) {
    // Fail-closed: never store MRV evidence we cannot later verify.
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "MRV signing not configured" });
  }
  return createHmac("sha256", key).update(payload).digest("hex");
}

export const stateOpsRouter = router({
  // ─── Queries ───────────────────────────────────────────────────────────────

  listLicenses: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum.optional(),
      licenseType: z.string().max(32).optional(),
      status: LicenseStatusEnum.optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input?.state ? eq(stateLicenses.state, input.state) : undefined,
        input?.licenseType ? eq(stateLicenses.licenseType, input.licenseType) : undefined,
        input?.status ? eq(stateLicenses.status, input.status) : undefined,
      ].filter((c) => c !== undefined);
      const rows = await db
        .select()
        .from(stateLicenses)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(stateLicenses.createdAt));
      return { licenses: rows, total: rows.length };
    }),

  listConcessions: protectedProcedure
    .input(z.object({ state: CoastalStateEnum.optional() }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(stateConcessions)
        .where(input?.state ? eq(stateConcessions.state, input.state) : undefined)
        .orderBy(desc(stateConcessions.createdAt));
      return { concessions: rows, total: rows.length };
    }),

  listEstates: protectedProcedure
    .input(z.object({ state: CoastalStateEnum.optional() }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(aquacultureEstates)
        .where(input?.state ? eq(aquacultureEstates.state, input.state) : undefined)
        .orderBy(desc(aquacultureEstates.createdAt));
      return { estates: rows, total: rows.length };
    }),

  listCarbonProjects: protectedProcedure
    .input(z.object({ state: CoastalStateEnum.optional() }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(blueCarbonProjects)
        .where(input?.state ? eq(blueCarbonProjects.state, input.state) : undefined)
        .orderBy(desc(blueCarbonProjects.createdAt));
      return { projects: rows, total: rows.length };
    }),

  getMrvEvidence: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(mrvEvidence)
        .where(eq(mrvEvidence.projectId, input.projectId))
        .orderBy(desc(mrvEvidence.createdAt));
      return { evidence: rows, total: rows.length };
    }),

  /**
   * Per-state revenue aggregates. Every figure is computed from persisted
   * rows only; states with no rows simply do not appear in the breakdown.
   */
  stateRevenueSummary: protectedProcedure
    .input(z.object({ state: CoastalStateEnum.optional() }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stateFilter = (col: any) =>
        input?.state ? sql`and ${col} = ${input.state}` : sql``;

      const [licenseAgg] = await db
        .select({
          totalLicenseFees: sql<string>`coalesce(sum(${stateLicenses.feeAmount}) filter (where ${stateLicenses.status} = 'ACTIVE'), 0)`,
        })
        .from(stateLicenses)
        .where(sql`true ${stateFilter(stateLicenses.state)}`);

      const licenseCountByType = await db
        .select({
          licenseType: stateLicenses.licenseType,
          count: sql<number>`count(*)::int`,
        })
        .from(stateLicenses)
        .where(sql`true ${stateFilter(stateLicenses.state)}`)
        .groupBy(stateLicenses.licenseType);

      const [concessionAgg] = await db
        .select({
          concessionAnnualFees: sql<string>`coalesce(sum(${stateConcessions.annualFee}) filter (where ${stateConcessions.status} = 'ACTIVE'), 0)`,
        })
        .from(stateConcessions)
        .where(sql`true ${stateFilter(stateConcessions.state)}`);

      const [estateAgg] = await db
        .select({
          leaseFees: sql<string>`coalesce(sum(${aquacultureEstates.leaseFeeAnnual}) filter (where ${aquacultureEstates.status} = 'ACTIVE'), 0)`,
        })
        .from(aquacultureEstates)
        .where(sql`true ${stateFilter(aquacultureEstates.state)}`);

      const [carbonAgg] = await db
        .select({
          carbonCreditsValue: sql<string>`coalesce(sum(${blueCarbonProjects.creditsIssued} * coalesce(${blueCarbonProjects.pricePerTonne}, 0)), 0)`,
          projectCount: sql<number>`count(*)::int`,
        })
        .from(blueCarbonProjects)
        .where(sql`true ${stateFilter(blueCarbonProjects.state)}`);

      // Phase 29: fisheries fees (active permits), paid IUU fines, dredging
      // royalties (declared/invoiced/paid declarations) and water-transport
      // jetty levies (active routes). All computed from persisted rows only.
      const [fisheriesAgg] = await db
        .select({
          fisheriesFees: sql<string>`coalesce(sum(${fisheriesPermits.feeNaira}) filter (where ${fisheriesPermits.status} = 'active'), 0)`,
        })
        .from(fisheriesPermits)
        .where(sql`true ${stateFilter(fisheriesPermits.state)}`);

      const [iuuAgg] = await db
        .select({
          iuuFines: sql<string>`coalesce(sum(${iuuPenalties.fineNaira}) filter (where ${iuuPenalties.status} = 'paid'), 0)`,
        })
        .from(iuuPenalties)
        .where(sql`true ${stateFilter(iuuPenalties.state)}`);

      const [dredgingAgg] = await db
        .select({
          dredgingRoyalties: sql<string>`coalesce(sum(${dredgingDeclarations.royaltyDueNaira}) filter (where ${dredgingDeclarations.status} in ('declared','invoiced','paid')), 0)`,
        })
        .from(dredgingDeclarations)
        .innerJoin(dredgingPermits, eq(dredgingDeclarations.permitId, dredgingPermits.id))
        .where(sql`true ${stateFilter(dredgingPermits.state)}`);

      const [waterAgg] = await db
        .select({
          waterTransportLevies: sql<string>`coalesce(sum(${waterTransportRoutes.jettyLevyPerTripNaira}) filter (where ${waterTransportRoutes.status} = 'active'), 0)`,
        })
        .from(waterTransportRoutes)
        .where(sql`true ${stateFilter(waterTransportRoutes.state)}`);

      const shareRows = await db
        .select({
          source: stateRevenueShares.source,
          sharePercent: stateRevenueShares.sharePercent,
          effectiveFrom: stateRevenueShares.effectiveFrom,
        })
        .from(stateRevenueShares)
        .where(input?.state ? eq(stateRevenueShares.state, input.state) : undefined);

      const licenseCount: Record<string, number> = {};
      for (const row of licenseCountByType) licenseCount[row.licenseType] = row.count;

      return {
        state: input?.state ?? "ALL",
        totalLicenseFees: Number(licenseAgg?.totalLicenseFees ?? 0),
        licenseCount,
        concessionAnnualFees: Number(concessionAgg?.concessionAnnualFees ?? 0),
        leaseFees: Number(estateAgg?.leaseFees ?? 0),
        carbonCreditsValue: Number(carbonAgg?.carbonCreditsValue ?? 0),
        projectCount: carbonAgg?.projectCount ?? 0,
        fisheriesFees: Number(fisheriesAgg?.fisheriesFees ?? 0),
        iuuFines: Number(iuuAgg?.iuuFines ?? 0),
        dredgingRoyalties: Number(dredgingAgg?.dredgingRoyalties ?? 0),
        waterTransportLevies: Number(waterAgg?.waterTransportLevies ?? 0),
        revenueShares: shareRows.map((r) => ({
          source: r.source,
          sharePercent: r.sharePercent,
          effectiveFrom: r.effectiveFrom,
        })),
      };
    }),

  // ─── Mutations ─────────────────────────────────────────────────────────────

  issueLicense: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum,
      licenseType: z.string().min(2).max(32),
      holderName: z.string().min(2).max(255),
      holderRef: z.string().max(128).optional(),
      feeAmount: z.number().min(0).default(0),
      currency: z.string().length(3).default("NGN"),
      expiresAt: z.coerce.date().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [row] = await db
        .insert(stateLicenses)
        .values({
          state: input.state,
          licenseType: input.licenseType,
          holderName: input.holderName,
          holderRef: input.holderRef,
          status: "ACTIVE",
          feeAmount: String(input.feeAmount),
          currency: input.currency,
          issuedAt: new Date(),
          expiresAt: input.expiresAt,
          metadata: input.metadata ?? {},
        })
        .returning();
      return row;
    }),

  renewLicense: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      newExpiresAt: z.coerce.date(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [row] = await db
        .update(stateLicenses)
        .set({ expiresAt: input.newExpiresAt, status: "ACTIVE", updatedAt: new Date() })
        .where(eq(stateLicenses.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "License not found" });
      return row;
    }),

  revokeLicense: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      reason: z.string().min(3).max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [existing] = await db.select().from(stateLicenses).where(eq(stateLicenses.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "License not found" });
      const [row] = await db
        .update(stateLicenses)
        .set({
          status: "REVOKED",
          updatedAt: new Date(),
          metadata: { ...(existing.metadata as Record<string, unknown> ?? {}), revokeReason: input.reason ?? null },
        })
        .where(eq(stateLicenses.id, input.id))
        .returning();
      return row;
    }),

  upsertConcession: protectedProcedure
    .input(z.object({
      id: z.number().int().positive().optional(),
      state: CoastalStateEnum,
      concessionType: z.string().min(2).max(32),
      operatorName: z.string().min(2).max(255),
      annualFee: z.number().min(0).default(0),
      startsOn: z.coerce.date().optional(),
      endsOn: z.coerce.date().optional(),
      status: ConcessionStatusEnum.default("ACTIVE"),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const values = {
        state: input.state,
        concessionType: input.concessionType,
        operatorName: input.operatorName,
        annualFee: String(input.annualFee),
        startsOn: input.startsOn ? input.startsOn.toISOString().slice(0, 10) : undefined,
        endsOn: input.endsOn ? input.endsOn.toISOString().slice(0, 10) : undefined,
        status: input.status,
      };
      if (input.id) {
        const [row] = await db
          .update(stateConcessions)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(stateConcessions.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Concession not found" });
        return row;
      }
      const [row] = await db.insert(stateConcessions).values(values).returning();
      return row;
    }),

  upsertEstate: protectedProcedure
    .input(z.object({
      id: z.number().int().positive().optional(),
      state: CoastalStateEnum,
      name: z.string().min(2).max(255),
      location: z.string().max(255).optional(),
      hectares: z.number().min(0).default(0),
      leaseFeeAnnual: z.number().min(0).default(0),
      operatorName: z.string().max(255).optional(),
      status: EstateStatusEnum.default("ACTIVE"),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const values = {
        state: input.state,
        name: input.name,
        location: input.location,
        hectares: input.hectares,
        leaseFeeAnnual: String(input.leaseFeeAnnual),
        operatorName: input.operatorName,
        status: input.status,
      };
      if (input.id) {
        const [row] = await db
          .update(aquacultureEstates)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(aquacultureEstates.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Estate not found" });
        return row;
      }
      const [row] = await db.insert(aquacultureEstates).values(values).returning();
      return row;
    }),

  upsertCarbonProject: protectedProcedure
    .input(z.object({
      id: z.number().int().positive().optional(),
      state: CoastalStateEnum,
      name: z.string().min(2).max(255),
      ecosystem: z.string().min(2).max(32),
      areaHa: z.number().min(0).default(0),
      status: CarbonProjectStatusEnum.default("PROPOSED"),
      creditsIssued: z.number().min(0).default(0),
      pricePerTonne: z.number().min(0).optional(),
      registryRef: z.string().max(128).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const values = {
        state: input.state,
        name: input.name,
        ecosystem: input.ecosystem,
        areaHa: input.areaHa,
        status: input.status,
        creditsIssued: String(input.creditsIssued),
        pricePerTonne: input.pricePerTonne != null ? String(input.pricePerTonne) : undefined,
        registryRef: input.registryRef,
      };
      if (input.id) {
        const [row] = await db
          .update(blueCarbonProjects)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(blueCarbonProjects.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Carbon project not found" });
        return row;
      }
      const [row] = await db.insert(blueCarbonProjects).values(values).returning();
      return row;
    }),

  addMrvEvidence: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      evidenceType: z.string().min(2).max(32),
      period: z.string().max(16).optional(),
      co2Tonnes: z.number().min(0).default(0),
      documentUri: z.string().max(2048).optional(),
      verifier: z.string().max(255).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [project] = await db
        .select({ id: blueCarbonProjects.id })
        .from(blueCarbonProjects)
        .where(eq(blueCarbonProjects.id, input.projectId))
        .limit(1);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Carbon project not found" });
      // Canonicalise to numeric(14,2) text so a later recompute against the
      // stored decimal string matches byte-for-byte.
      const payload = mrvPayload({
        projectId: input.projectId,
        evidenceType: input.evidenceType,
        period: input.period ?? null,
        co2Tonnes: input.co2Tonnes.toFixed(2),
        documentUri: input.documentUri ?? null,
      });
      const verificationHash = signMrvPayload(payload); // throws 503 when PROOF_SIGNING_KEY unset
      const [row] = await db
        .insert(mrvEvidence)
        .values({
          projectId: input.projectId,
          evidenceType: input.evidenceType,
          period: input.period,
          co2Tonnes: String(input.co2Tonnes),
          documentUri: input.documentUri,
          verificationHash,
          verifier: input.verifier,
        })
        .returning();
      return row;
    }),

  verifyMrvEvidence: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [row] = await db.select().from(mrvEvidence).where(eq(mrvEvidence.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "MRV evidence not found" });
      const payload = mrvPayload({
        projectId: row.projectId,
        evidenceType: row.evidenceType,
        period: row.period,
        co2Tonnes: row.co2Tonnes,
        documentUri: row.documentUri,
      });
      const expected = signMrvPayload(payload);
      return { id: row.id, valid: row.verificationHash === expected };
    }),

  // ─── Phase 29 (W1): fisheries permits ──────────────────────────────────────

  listFisheriesPermits: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum.optional(),
      status: FisheriesPermitStatusEnum.optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input?.state ? eq(fisheriesPermits.state, input.state) : undefined,
        input?.status ? eq(fisheriesPermits.status, input.status) : undefined,
      ].filter((c) => c !== undefined);
      const rows = await db
        .select()
        .from(fisheriesPermits)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(fisheriesPermits.createdAt));
      return { permits: rows, total: rows.length };
    }),

  issueFisheriesPermit: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum,
      permitType: FisheriesPermitTypeEnum,
      operatorName: z.string().min(2).max(255),
      vesselName: z.string().max(255).optional(),
      vesselRegNo: z.string().max(64).optional(),
      feeNaira: z.number().min(0),
      expiresAt: z.coerce.date().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [row] = await db
        .insert(fisheriesPermits)
        .values({
          state: input.state,
          permitType: input.permitType,
          operatorName: input.operatorName,
          vesselName: input.vesselName,
          vesselRegNo: input.vesselRegNo,
          feeNaira: input.feeNaira,
          status: "active",
          issuedAt: new Date(),
          expiresAt: input.expiresAt,
        })
        .returning();
      return row;
    }),

  revokeFisheriesPermit: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [row] = await db
        .update(fisheriesPermits)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(eq(fisheriesPermits.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Fisheries permit not found" });
      return row;
    }),

  // ─── Phase 29 (W1): IUU penalties ──────────────────────────────────────────

  listIuuPenalties: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum.optional(),
      status: IuuPenaltyStatusEnum.optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input?.state ? eq(iuuPenalties.state, input.state) : undefined,
        input?.status ? eq(iuuPenalties.status, input.status) : undefined,
      ].filter((c) => c !== undefined);
      const rows = await db
        .select()
        .from(iuuPenalties)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(iuuPenalties.createdAt));
      return { penalties: rows, total: rows.length };
    }),

  assessIuuPenalty: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum,
      vesselName: z.string().min(1).max(255),
      offence: z.string().min(3).max(1000),
      fineNaira: z.number().min(0),
      permitId: z.string().uuid().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      if (input.permitId) {
        const [permit] = await db
          .select({ id: fisheriesPermits.id })
          .from(fisheriesPermits)
          .where(eq(fisheriesPermits.id, input.permitId))
          .limit(1);
        if (!permit) throw new TRPCError({ code: "NOT_FOUND", message: "Fisheries permit not found" });
      }
      const [row] = await db
        .insert(iuuPenalties)
        .values({
          state: input.state,
          vesselName: input.vesselName,
          offence: input.offence,
          fineNaira: input.fineNaira,
          permitId: input.permitId,
          status: "assessed",
          assessedAt: new Date(),
        })
        .returning();
      return row;
    }),

  settleIuuPenalty: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [row] = await db
        .update(iuuPenalties)
        .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
        .where(eq(iuuPenalties.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "IUU penalty not found" });
      return row;
    }),

  // ─── Phase 29 (W1): small craft registry ───────────────────────────────────

  listSmallCraft: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum.optional(),
      status: SmallCraftStatusEnum.optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input?.state ? eq(smallCraftRegistry.state, input.state) : undefined,
        input?.status ? eq(smallCraftRegistry.status, input.status) : undefined,
      ].filter((c) => c !== undefined);
      const rows = await db
        .select()
        .from(smallCraftRegistry)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(smallCraftRegistry.createdAt));
      return { craft: rows, total: rows.length };
    }),

  registerSmallCraft: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum,
      registrationNo: z.string().min(3).max(64),
      craftType: z.string().min(2).max(64),
      ownerName: z.string().min(2).max(255),
      capacity: z.number().int().min(0).optional(),
      safetyCertExpiresAt: z.coerce.date().optional(),
      registrationFeeNaira: z.number().min(0),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [row] = await db
        .insert(smallCraftRegistry)
        .values({
          state: input.state,
          registrationNo: input.registrationNo,
          craftType: input.craftType,
          ownerName: input.ownerName,
          capacity: input.capacity,
          safetyCertExpiresAt: input.safetyCertExpiresAt,
          registrationFeeNaira: input.registrationFeeNaira,
          status: "active",
          registeredAt: new Date(),
        })
        .returning();
      return row;
    }),

  // ─── Phase 29 (W1): dredging permits & volume declarations ─────────────────

  listDredgingPermits: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum.optional(),
      status: DredgingPermitStatusEnum.optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input?.state ? eq(dredgingPermits.state, input.state) : undefined,
        input?.status ? eq(dredgingPermits.status, input.status) : undefined,
      ].filter((c) => c !== undefined);
      const rows = await db
        .select()
        .from(dredgingPermits)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(dredgingPermits.createdAt));
      return { permits: rows, total: rows.length };
    }),

  upsertDredgingPermit: protectedProcedure
    .input(z.object({
      id: z.string().uuid().optional(),
      state: CoastalStateEnum,
      operatorName: z.string().min(2).max(255),
      siteDescription: z.string().min(3).max(2000),
      royaltyPerM3Naira: z.number().min(0),
      status: DredgingPermitStatusEnum.default("active"),
      expiresAt: z.coerce.date().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      if (input.id) {
        const [row] = await db
          .update(dredgingPermits)
          .set({
            state: input.state,
            operatorName: input.operatorName,
            siteDescription: input.siteDescription,
            royaltyPerM3Naira: input.royaltyPerM3Naira,
            status: input.status,
            expiresAt: input.expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(dredgingPermits.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Dredging permit not found" });
        return row;
      }
      const [row] = await db
        .insert(dredgingPermits)
        .values({
          state: input.state,
          operatorName: input.operatorName,
          siteDescription: input.siteDescription,
          royaltyPerM3Naira: input.royaltyPerM3Naira,
          status: input.status,
          issuedAt: new Date(),
          expiresAt: input.expiresAt,
        })
        .returning();
      return row;
    }),

  listDredgingDeclarations: protectedProcedure
    .input(z.object({
      permitId: z.string().uuid(),
    }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(dredgingDeclarations)
        .where(eq(dredgingDeclarations.permitId, input.permitId))
        .orderBy(desc(dredgingDeclarations.declaredAt));
      return { declarations: rows, total: rows.length };
    }),

  /**
   * Royalty due is computed SERVER-SIDE from the permit's royalty rate —
   * the client supplies only the volume; a client-supplied royalty figure
   * is never trusted.
   */
  declareDredgingVolume: protectedProcedure
    .input(z.object({
      permitId: z.string().uuid(),
      period: z.string().min(1).max(32),
      volumeM3: z.number().min(0),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [permit] = await db
        .select()
        .from(dredgingPermits)
        .where(eq(dredgingPermits.id, input.permitId))
        .limit(1);
      if (!permit) throw new TRPCError({ code: "NOT_FOUND", message: "Dredging permit not found" });
      const royaltyDueNaira = input.volumeM3 * permit.royaltyPerM3Naira;
      const [row] = await db
        .insert(dredgingDeclarations)
        .values({
          permitId: input.permitId,
          period: input.period,
          volumeM3: input.volumeM3,
          royaltyDueNaira,
          status: "declared",
          declaredAt: new Date(),
        })
        .returning();
      return row;
    }),

  // ─── Phase 29 (W1): water transport routes ─────────────────────────────────

  listWaterRoutes: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum.optional(),
      status: WaterRouteStatusEnum.optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input?.state ? eq(waterTransportRoutes.state, input.state) : undefined,
        input?.status ? eq(waterTransportRoutes.status, input.status) : undefined,
      ].filter((c) => c !== undefined);
      const rows = await db
        .select()
        .from(waterTransportRoutes)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(waterTransportRoutes.createdAt));
      return { routes: rows, total: rows.length };
    }),

  upsertWaterRoute: protectedProcedure
    .input(z.object({
      id: z.string().uuid().optional(),
      state: CoastalStateEnum,
      routeName: z.string().min(2).max(255),
      operatorName: z.string().min(2).max(255),
      fareNaira: z.number().min(0),
      jettyLevyPerTripNaira: z.number().min(0).default(0),
      status: WaterRouteStatusEnum.default("active"),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const values = {
        state: input.state,
        routeName: input.routeName,
        operatorName: input.operatorName,
        fareNaira: input.fareNaira,
        jettyLevyPerTripNaira: input.jettyLevyPerTripNaira,
        status: input.status,
      };
      if (input.id) {
        const [row] = await db
          .update(waterTransportRoutes)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(waterTransportRoutes.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Water route not found" });
        return row;
      }
      const [row] = await db.insert(waterTransportRoutes).values(values).returning();
      return row;
    }),

  // ─── Phase 29 (W1): state revenue shares ───────────────────────────────────

  listRevenueShares: protectedProcedure
    .input(z.object({ state: CoastalStateEnum.optional() }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(stateRevenueShares)
        .where(input?.state ? eq(stateRevenueShares.state, input.state) : undefined)
        .orderBy(desc(stateRevenueShares.createdAt));
      return { shares: rows, total: rows.length };
    }),

  upsertRevenueShare: protectedProcedure
    .input(z.object({
      id: z.string().uuid().optional(),
      state: CoastalStateEnum,
      source: z.string().min(2).max(128),
      sharePercent: z.number().min(0).max(100),
      effectiveFrom: z.coerce.date().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      if (input.id) {
        const [row] = await db
          .update(stateRevenueShares)
          .set({
            state: input.state,
            source: input.source,
            sharePercent: input.sharePercent,
            effectiveFrom: input.effectiveFrom,
          })
          .where(eq(stateRevenueShares.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Revenue share not found" });
        return row;
      }
      const [row] = await db
        .insert(stateRevenueShares)
        .values({
          state: input.state,
          source: input.source,
          sharePercent: input.sharePercent,
          effectiveFrom: input.effectiveFrom,
        })
        .returning();
      return row;
    }),
});
