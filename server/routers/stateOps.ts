/**
 * Phase 28 (W1): stateOps — state blue-economy revenue router.
 * State licensing, concessions, aquaculture estates and blue-carbon MRV
 * (monitoring / reporting / verification) for Nigeria's eight coastal states.
 *
 * All data is persisted in Postgres (migration 0081_phase28_state_ops) — no
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
});
