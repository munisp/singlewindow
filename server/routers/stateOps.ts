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
 * 0082_phase29_state_ops_ext, 0083_phase30_state_ops_tier2,
 * 0084_phase31_state_ops_tier3) — no
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
  tourismOperators,
  tourismLevyDeclarations,
  maricultureFarms,
  trainingAcademies,
  trainingCertifications,
  renewableEnergyCredits,
  blueBondIssuances,
  bondImpactReports,
  dataSubscriptions,
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

      // Phase 30: tourism levies (declared/invoiced/paid, joined via operator
      // for the state filter), mariculture lease fees (active farms), training
      // certification fees, and sold REC revenue. Persisted rows only.
      const [tourismAgg] = await db
        .select({
          tourismLevies: sql<string>`coalesce(sum(${tourismLevyDeclarations.levyDueNaira}) filter (where ${tourismLevyDeclarations.status} in ('declared','invoiced','paid')), 0)`,
        })
        .from(tourismLevyDeclarations)
        .innerJoin(tourismOperators, eq(tourismLevyDeclarations.operatorId, tourismOperators.id))
        .where(sql`true ${stateFilter(tourismOperators.state)}`);

      const [maricultureAgg] = await db
        .select({
          maricultureLeases: sql<string>`coalesce(sum(${maricultureFarms.leaseFeeNaira}) filter (where ${maricultureFarms.status} = 'active'), 0)`,
        })
        .from(maricultureFarms)
        .where(sql`true ${stateFilter(maricultureFarms.state)}`);

      const [trainingAgg] = await db
        .select({
          trainingFees: sql<string>`coalesce(sum(${trainingCertifications.certFeeNaira}), 0)`,
        })
        .from(trainingCertifications)
        .innerJoin(trainingAcademies, eq(trainingCertifications.academyId, trainingAcademies.id))
        .where(sql`true ${stateFilter(trainingAcademies.state)}`);

      const [recAgg] = await db
        .select({
          recRevenue: sql<string>`coalesce(sum(${renewableEnergyCredits.mwh} * ${renewableEnergyCredits.creditPriceNaira}) filter (where ${renewableEnergyCredits.status} = 'sold'), 0)`,
        })
        .from(renewableEnergyCredits)
        .where(sql`true ${stateFilter(renewableEnergyCredits.state)}`);

      // Phase 31: bond facilitation fees (issued/closed bonds) and active
      // data-intelligence subscription fees. Persisted rows only.
      const [bondAgg] = await db
        .select({
          bondFacilitationFees: sql<string>`coalesce(sum(${blueBondIssuances.facilitationFeeNaira}) filter (where ${blueBondIssuances.status} in ('issued','closed')), 0)`,
        })
        .from(blueBondIssuances)
        .where(sql`true ${stateFilter(blueBondIssuances.state)}`);

      const [subsAgg] = await db
        .select({
          subscriptionFees: sql<string>`coalesce(sum(${dataSubscriptions.feeNaira}) filter (where ${dataSubscriptions.status} = 'active'), 0)`,
        })
        .from(dataSubscriptions)
        .where(sql`true ${input?.state ? sql`and (${dataSubscriptions.state} = ${input.state} or ${dataSubscriptions.state} is null)` : sql``}`);

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
        tourismLevies: Number(tourismAgg?.tourismLevies ?? 0),
        maricultureLeases: Number(maricultureAgg?.maricultureLeases ?? 0),
        trainingFees: Number(trainingAgg?.trainingFees ?? 0),
        recRevenue: Number(recAgg?.recRevenue ?? 0),
        bondFacilitationFees: Number(bondAgg?.bondFacilitationFees ?? 0),
        subscriptionFees: Number(subsAgg?.subscriptionFees ?? 0),
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
  // ─── Phase 30: tourism operators & visitor levies ─────────────────────────

  listTourismOperators: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum.optional(),
      status: z.enum(["active", "suspended", "expired", "revoked"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input?.state ? eq(tourismOperators.state, input.state) : undefined,
        input?.status ? eq(tourismOperators.status, input.status) : undefined,
      ].filter(Boolean);
      const rows = await db
        .select()
        .from(tourismOperators)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(tourismOperators.createdAt));
      return { operators: rows, total: rows.length };
    }),

  upsertTourismOperator: protectedProcedure
    .input(z.object({
      id: z.string().uuid().optional(),
      state: CoastalStateEnum,
      operatorName: z.string().min(2).max(256),
      operatorType: z.enum(["beach_resort", "boat_tour", "eco_lodge", "mangrove_boardwalk", "jet_ski", "other"]),
      siteDescription: z.string().max(1024).optional(),
      licenceFeeNaira: z.number().min(0),
      visitorLevyNaira: z.number().min(0).default(0),
      status: z.enum(["active", "suspended", "expired", "revoked"]).optional(),
      expiresAt: z.coerce.date().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      if (input.id) {
        const [row] = await db
          .update(tourismOperators)
          .set({
            state: input.state,
            operatorName: input.operatorName,
            operatorType: input.operatorType,
            siteDescription: input.siteDescription,
            licenceFeeNaira: input.licenceFeeNaira,
            visitorLevyNaira: input.visitorLevyNaira,
            status: input.status,
            expiresAt: input.expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(tourismOperators.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Tourism operator not found" });
        return row;
      }
      const [row] = await db
        .insert(tourismOperators)
        .values({
          state: input.state,
          operatorName: input.operatorName,
          operatorType: input.operatorType,
          siteDescription: input.siteDescription,
          licenceFeeNaira: input.licenceFeeNaira,
          visitorLevyNaira: input.visitorLevyNaira,
          expiresAt: input.expiresAt,
        })
        .returning();
      return row;
    }),

  listTourismLevies: protectedProcedure
    .input(z.object({
      operatorId: z.string().uuid().optional(),
      status: z.enum(["declared", "invoiced", "paid"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input?.operatorId ? eq(tourismLevyDeclarations.operatorId, input.operatorId) : undefined,
        input?.status ? eq(tourismLevyDeclarations.status, input.status) : undefined,
      ].filter(Boolean);
      const rows = await db
        .select()
        .from(tourismLevyDeclarations)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(tourismLevyDeclarations.declaredAt));
      return { levies: rows, total: rows.length };
    }),

  declareTourismLevy: protectedProcedure
    .input(z.object({
      operatorId: z.string().uuid(),
      period: z.string().regex(/^\d{4}-\d{2}$/),
      visitorCount: z.number().int().min(0),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [operator] = await db
        .select()
        .from(tourismOperators)
        .where(eq(tourismOperators.id, input.operatorId));
      if (!operator) throw new TRPCError({ code: "NOT_FOUND", message: "Tourism operator not found" });
      // Levy is computed server-side — never trusted from the client.
      const levyDueNaira = input.visitorCount * (operator.visitorLevyNaira ?? 0);
      const [row] = await db
        .insert(tourismLevyDeclarations)
        .values({
          operatorId: input.operatorId,
          period: input.period,
          visitorCount: input.visitorCount,
          levyDueNaira,
        })
        .returning();
      return row;
    }),

  // ─── Phase 30: mariculture farms ──────────────────────────────────────────

  listMaricultureFarms: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum.optional(),
      farmType: z.enum(["seaweed", "oyster", "mussel", "shrimp", "finfish_cage"]).optional(),
      status: z.enum(["active", "suspended", "decommissioned"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input?.state ? eq(maricultureFarms.state, input.state) : undefined,
        input?.farmType ? eq(maricultureFarms.farmType, input.farmType) : undefined,
        input?.status ? eq(maricultureFarms.status, input.status) : undefined,
      ].filter(Boolean);
      const rows = await db
        .select()
        .from(maricultureFarms)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(maricultureFarms.createdAt));
      return { farms: rows, total: rows.length };
    }),

  upsertMaricultureFarm: protectedProcedure
    .input(z.object({
      id: z.string().uuid().optional(),
      state: CoastalStateEnum,
      estateId: z.string().uuid().optional(),
      farmType: z.enum(["seaweed", "oyster", "mussel", "shrimp", "finfish_cage"]),
      operatorName: z.string().min(2).max(256),
      areaHectares: z.number().min(0).optional(),
      leaseFeeNaira: z.number().min(0),
      offtakerName: z.string().max(256).optional(),
      status: z.enum(["active", "suspended", "decommissioned"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      if (input.id) {
        const [row] = await db
          .update(maricultureFarms)
          .set({
            state: input.state,
            estateId: input.estateId,
            farmType: input.farmType,
            operatorName: input.operatorName,
            areaHectares: input.areaHectares,
            leaseFeeNaira: input.leaseFeeNaira,
            offtakerName: input.offtakerName,
            status: input.status,
            updatedAt: new Date(),
          })
          .where(eq(maricultureFarms.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Mariculture farm not found" });
        return row;
      }
      const [row] = await db
        .insert(maricultureFarms)
        .values({
          state: input.state,
          estateId: input.estateId,
          farmType: input.farmType,
          operatorName: input.operatorName,
          areaHectares: input.areaHectares,
          leaseFeeNaira: input.leaseFeeNaira,
          offtakerName: input.offtakerName,
        })
        .returning();
      return row;
    }),

  // ─── Phase 30: training academies & HMAC-verified certifications ──────────

  listAcademies: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum.optional(),
      status: z.enum(["active", "suspended"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input?.state ? eq(trainingAcademies.state, input.state) : undefined,
        input?.status ? eq(trainingAcademies.status, input.status) : undefined,
      ].filter(Boolean);
      const rows = await db
        .select()
        .from(trainingAcademies)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(trainingAcademies.createdAt));
      return { academies: rows, total: rows.length };
    }),

  upsertAcademy: protectedProcedure
    .input(z.object({
      id: z.string().uuid().optional(),
      state: CoastalStateEnum,
      academyName: z.string().min(2).max(256),
      programType: z.enum(["fishery_skills", "boat_handling", "diving", "hospitality", "stcw_adjacent"]),
      capacity: z.number().int().min(0).optional(),
      status: z.enum(["active", "suspended"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      if (input.id) {
        const [row] = await db
          .update(trainingAcademies)
          .set({
            state: input.state,
            academyName: input.academyName,
            programType: input.programType,
            capacity: input.capacity,
            status: input.status,
            updatedAt: new Date(),
          })
          .where(eq(trainingAcademies.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Academy not found" });
        return row;
      }
      const [row] = await db
        .insert(trainingAcademies)
        .values({
          state: input.state,
          academyName: input.academyName,
          programType: input.programType,
          capacity: input.capacity,
        })
        .returning();
      return row;
    }),

  listCertifications: protectedProcedure
    .input(z.object({
      academyId: z.string().uuid().optional(),
      certNo: z.string().max(128).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input?.academyId ? eq(trainingCertifications.academyId, input.academyId) : undefined,
        input?.certNo ? eq(trainingCertifications.certNo, input.certNo) : undefined,
      ].filter(Boolean);
      const rows = await db
        .select()
        .from(trainingCertifications)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(trainingCertifications.issuedAt));
      return { certifications: rows, total: rows.length };
    }),

  issueCertification: protectedProcedure
    .input(z.object({
      academyId: z.string().uuid(),
      traineeName: z.string().min(2).max(256),
      program: z.string().min(2).max(256),
      certNo: z.string().min(4).max(128),
      certFeeNaira: z.number().min(0).default(0),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [academy] = await db
        .select()
        .from(trainingAcademies)
        .where(eq(trainingAcademies.id, input.academyId));
      if (!academy) throw new TRPCError({ code: "NOT_FOUND", message: "Academy not found" });
      // Fail-closed: throws 503 if PROOF_SIGNING_KEY is unset.
      const verificationHash = signMrvPayload(
        `${input.academyId}|${input.traineeName}|${input.program}|${input.certNo}`
      );
      const [row] = await db
        .insert(trainingCertifications)
        .values({
          academyId: input.academyId,
          traineeName: input.traineeName,
          program: input.program,
          certNo: input.certNo,
          certFeeNaira: input.certFeeNaira,
          verificationHash,
        })
        .returning();
      return row;
    }),

  verifyCertification: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [row] = await db
        .select()
        .from(trainingCertifications)
        .where(eq(trainingCertifications.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Certification not found" });
      const expected = signMrvPayload(
        `${row.academyId}|${row.traineeName}|${row.program}|${row.certNo}`
      );
      return { valid: expected === row.verificationHash, certification: row };
    }),

  // ─── Phase 30: renewable energy credits (RECs) ────────────────────────────

  listRecs: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum.optional(),
      source: z.enum(["tidal", "offshore_wind", "solar_floating"]).optional(),
      status: z.enum(["issued", "verified", "sold"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input?.state ? eq(renewableEnergyCredits.state, input.state) : undefined,
        input?.source ? eq(renewableEnergyCredits.source, input.source) : undefined,
        input?.status ? eq(renewableEnergyCredits.status, input.status) : undefined,
      ].filter(Boolean);
      const rows = await db
        .select()
        .from(renewableEnergyCredits)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(renewableEnergyCredits.createdAt));
      return { recs: rows, total: rows.length };
    }),

  issueRec: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum,
      projectName: z.string().min(2).max(256),
      source: z.enum(["tidal", "offshore_wind", "solar_floating"]),
      mwh: z.number().min(0),
      period: z.string().regex(/^\d{4}-\d{2}$/),
      creditPriceNaira: z.number().min(0),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      // Fail-closed: throws 503 if PROOF_SIGNING_KEY is unset.
      const verificationHash = signMrvPayload(
        `${input.projectName}|${input.source}|${input.period}|${input.mwh.toFixed(3)}`
      );
      const [row] = await db
        .insert(renewableEnergyCredits)
        .values({
          state: input.state,
          projectName: input.projectName,
          source: input.source,
          mwh: input.mwh,
          period: input.period,
          creditPriceNaira: input.creditPriceNaira,
          verificationHash,
        })
        .returning();
      return row;
    }),

  verifyRec: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [row] = await db
        .select()
        .from(renewableEnergyCredits)
        .where(eq(renewableEnergyCredits.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "REC not found" });
      const expected = signMrvPayload(
        `${row.projectName}|${row.source}|${row.period}|${Number(row.mwh).toFixed(3)}`
      );
      return { valid: expected === row.verificationHash, rec: row };
    }),

  markRecSold: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [row] = await db
        .update(renewableEnergyCredits)
        .set({ status: "sold", updatedAt: new Date() })
        .where(eq(renewableEnergyCredits.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "REC not found" });
      return row;
    }),
  // ─── Phase 31: blue-bond origination ──────────────────────────────────────

  listBlueBonds: protectedProcedure
    .input(z.object({
      state: CoastalStateEnum.optional(),
      status: z.enum(["proposed", "approved", "issued", "closed", "defaulted"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input?.state ? eq(blueBondIssuances.state, input.state) : undefined,
        input?.status ? eq(blueBondIssuances.status, input.status) : undefined,
      ].filter(Boolean);
      const rows = await db
        .select()
        .from(blueBondIssuances)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(blueBondIssuances.createdAt));
      return { bonds: rows, total: rows.length };
    }),

  upsertBlueBond: protectedProcedure
    .input(z.object({
      id: z.string().uuid().optional(),
      state: CoastalStateEnum,
      bondName: z.string().min(2).max(256),
      issuerName: z.string().min(2).max(256),
      targetAmountNaira: z.number().min(0),
      raisedAmountNaira: z.number().min(0).default(0),
      couponRate: z.number().min(0).max(100).optional(),
      maturityDate: z.coerce.date().optional(),
      useOfProceeds: z.string().max(2048).optional(),
      facilitationFeeNaira: z.number().min(0).default(0),
      status: z.enum(["proposed", "approved", "issued", "closed", "defaulted"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      if (input.id) {
        // Updates never re-hash: the issuance hash binds the original terms.
        const [row] = await db
          .update(blueBondIssuances)
          .set({
            state: input.state,
            bondName: input.bondName,
            issuerName: input.issuerName,
            targetAmountNaira: input.targetAmountNaira,
            raisedAmountNaira: input.raisedAmountNaira,
            couponRate: input.couponRate,
            maturityDate: input.maturityDate,
            useOfProceeds: input.useOfProceeds,
            facilitationFeeNaira: input.facilitationFeeNaira,
            status: input.status,
            issuedAt: input.status === "issued" ? new Date() : undefined,
            updatedAt: new Date(),
          })
          .where(eq(blueBondIssuances.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Blue bond not found" });
        return row;
      }
      // Fail-closed: throws 503 if PROOF_SIGNING_KEY is unset.
      const verificationHash = signMrvPayload(
        `${input.state}|${input.bondName}|${input.issuerName}|${input.targetAmountNaira.toFixed(2)}`
      );
      const [row] = await db
        .insert(blueBondIssuances)
        .values({
          state: input.state,
          bondName: input.bondName,
          issuerName: input.issuerName,
          targetAmountNaira: input.targetAmountNaira,
          raisedAmountNaira: input.raisedAmountNaira,
          couponRate: input.couponRate,
          maturityDate: input.maturityDate,
          useOfProceeds: input.useOfProceeds,
          facilitationFeeNaira: input.facilitationFeeNaira,
          verificationHash,
          issuedAt: input.status === "issued" ? new Date() : undefined,
        })
        .returning();
      return row;
    }),

  verifyBlueBond: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [row] = await db
        .select()
        .from(blueBondIssuances)
        .where(eq(blueBondIssuances.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Blue bond not found" });
      const expected = signMrvPayload(
        `${row.state}|${row.bondName}|${row.issuerName}|${Number(row.targetAmountNaira).toFixed(2)}`
      );
      return { valid: expected === row.verificationHash, bond: row };
    }),

  listBondImpactReports: protectedProcedure
    .input(z.object({ bondId: z.string().uuid().optional() }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(bondImpactReports)
        .where(input?.bondId ? eq(bondImpactReports.bondId, input.bondId) : undefined)
        .orderBy(desc(bondImpactReports.reportedAt));
      return { reports: rows, total: rows.length };
    }),

  addBondImpactReport: protectedProcedure
    .input(z.object({
      bondId: z.string().uuid(),
      period: z.string().regex(/^\d{4}-\d{2}$/),
      allocationNaira: z.number().min(0),
      impactSummary: z.string().min(2).max(4096),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [bond] = await db
        .select()
        .from(blueBondIssuances)
        .where(eq(blueBondIssuances.id, input.bondId));
      if (!bond) throw new TRPCError({ code: "NOT_FOUND", message: "Blue bond not found" });
      // Fail-closed: throws 503 if PROOF_SIGNING_KEY is unset.
      const verificationHash = signMrvPayload(
        `${input.bondId}|${input.period}|${input.allocationNaira.toFixed(2)}`
      );
      const [row] = await db
        .insert(bondImpactReports)
        .values({
          bondId: input.bondId,
          period: input.period,
          allocationNaira: input.allocationNaira,
          impactSummary: input.impactSummary,
          verificationHash,
        })
        .returning();
      return row;
    }),

  verifyBondImpactReport: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [row] = await db
        .select()
        .from(bondImpactReports)
        .where(eq(bondImpactReports.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Impact report not found" });
      const expected = signMrvPayload(
        `${row.bondId}|${row.period}|${Number(row.allocationNaira).toFixed(2)}`
      );
      return { valid: expected === row.verificationHash, report: row };
    }),

  // ─── Phase 31: data-intelligence subscriptions ────────────────────────────

  listDataSubscriptions: protectedProcedure
    .input(z.object({
      tier: z.enum(["explorer", "professional", "enterprise"]).optional(),
      status: z.enum(["active", "suspended", "expired"]).optional(),
      state: CoastalStateEnum.optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input?.tier ? eq(dataSubscriptions.tier, input.tier) : undefined,
        input?.status ? eq(dataSubscriptions.status, input.status) : undefined,
        input?.state ? eq(dataSubscriptions.state, input.state) : undefined,
      ].filter(Boolean);
      const rows = await db
        .select()
        .from(dataSubscriptions)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(dataSubscriptions.createdAt));
      return { subscriptions: rows, total: rows.length };
    }),

  upsertDataSubscription: protectedProcedure
    .input(z.object({
      id: z.string().uuid().optional(),
      subscriberOrg: z.string().min(2).max(256),
      contactEmail: z.string().email().max(256).optional(),
      tier: z.enum(["explorer", "professional", "enterprise"]),
      datasetScope: z.string().min(2).max(1024),
      state: CoastalStateEnum.optional(),
      feeNaira: z.number().min(0),
      period: z.string().regex(/^\d{4}-\d{2}$/),
      status: z.enum(["active", "suspended", "expired"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      if (input.id) {
        const [row] = await db
          .update(dataSubscriptions)
          .set({
            subscriberOrg: input.subscriberOrg,
            contactEmail: input.contactEmail,
            tier: input.tier,
            datasetScope: input.datasetScope,
            state: input.state,
            feeNaira: input.feeNaira,
            period: input.period,
            status: input.status,
            updatedAt: new Date(),
          })
          .where(eq(dataSubscriptions.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Subscription not found" });
        return row;
      }
      const [row] = await db
        .insert(dataSubscriptions)
        .values({
          subscriberOrg: input.subscriberOrg,
          contactEmail: input.contactEmail,
          tier: input.tier,
          datasetScope: input.datasetScope,
          state: input.state,
          feeNaira: input.feeNaira,
          period: input.period,
        })
        .returning();
      return row;
    }),

  suspendDataSubscription: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [row] = await db
        .update(dataSubscriptions)
        .set({ status: "suspended", updatedAt: new Date() })
        .where(eq(dataSubscriptions.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Subscription not found" });
      return row;
    }),
});
