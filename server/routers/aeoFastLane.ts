/**
 * aeoFastLane.ts — AEO export fast-lane (Phase 16 Wave P1).
 *
 * Risk/queue prioritization for AEO/accredited exporters:
 *   - queue.prioritized        — officer export-declaration queue ordered
 *                                AEO-certified exporters first (tier rank,
 *                                then FIFO by submission).
 *   - drawback.requestFastTrack — certified AEO exporter flags its own
 *                                submitted/under-review drawback claim for
 *                                accelerated review (duty_drawback_claims.
 *                                fast_track, migration 0069).
 *   - drawback.fastTrackQueue  — officer drawback queue, fast-tracked first.
 *   - origin.fastPathQueue     — officer rules-of-origin queue, AEO fast-path
 *                                certificates first (origin_certificates.
 *                                fast_path is set automatically at submission
 *                                time in rulesOfOrigin.submitCertificate).
 *   - admin.accreditedExporters — admin surface of accredited (AEO-certified)
 *                                exporter profiles.
 *
 * Accreditation is read from stakeholder_profiles.aeo_status / aeo_tier — the
 * certification record of the existing AEO workflow (server/routers/aeo.ts).
 * No accreditation is ever inferred; only authority-certified status counts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  declarations,
  dutyDrawbackClaims,
  originCertificates,
  stakeholderProfiles,
  users,
} from "../../drizzle/schema";

const OFFICER_QUEUE_ROLES = [
  "admin", "superadmin", "platform_admin", "customs_commissioner",
  "customs_officer", "inspector", "finance",
];

const TIER_RANK = sql`case ${stakeholderProfiles.aeoTier} when 'gold' then 3 when 'silver' then 2 else 1 end`;

function requireOfficer(role: string): void {
  if (!OFFICER_QUEUE_ROLES.includes(role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Officer role required" });
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database is not available in this environment" });
  }
  return db;
}

/** Accreditation record for a trader, or null when not AEO-certified. */
async function accreditationOf(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number) {
  const [profile] = await db
    .select({ aeoStatus: stakeholderProfiles.aeoStatus, aeoTier: stakeholderProfiles.aeoTier })
    .from(stakeholderProfiles)
    .where(eq(stakeholderProfiles.userId, userId))
    .limit(1);
  if (!profile || profile.aeoStatus !== "certified") return null;
  return profile;
}

export const aeoFastLaneRouter = router({
  queue: router({
    /**
     * Prioritized export-declaration queue: AEO-certified exporters first
     * (gold > silver > standard), then FIFO by submission time. Accreditation
     * is joined live from stakeholder_profiles — never cached or fabricated.
     */
    prioritized: protectedProcedure
      .input(
        z.object({
          status: z.string().optional(),
          limit: z.number().int().min(1).max(200).default(50),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        requireOfficer(ctx.user.role);
        const db = await requireDb();
        const conditions = [eq(declarations.declarationType, "export")];
        if (input?.status) conditions.push(eq(declarations.status, input.status as never));
        const rows = await db
          .select({
            id: declarations.id,
            declarationNumber: declarations.declarationNumber,
            traderId: declarations.traderId,
            traderName: users.name,
            status: declarations.status,
            riskLane: declarations.riskLane,
            riskScore: declarations.riskScore,
            hsCode: declarations.hsCode,
            goodsDescription: declarations.goodsDescription,
            countryOfDestination: declarations.countryOfDestination,
            submittedAt: declarations.submittedAt,
            createdAt: declarations.createdAt,
            aeoStatus: stakeholderProfiles.aeoStatus,
            aeoTier: stakeholderProfiles.aeoTier,
          })
          .from(declarations)
          .leftJoin(users, eq(declarations.traderId, users.id))
          .leftJoin(stakeholderProfiles, eq(declarations.traderId, stakeholderProfiles.userId))
          .where(and(...conditions))
          .orderBy(
            // Accredited exporters first, then tier rank, then FIFO.
            sql`case when ${stakeholderProfiles.aeoStatus} = 'certified' then 0 else 1 end`,
            desc(TIER_RANK),
            sql`${declarations.submittedAt} asc nulls last`,
            desc(declarations.id)
          )
          .limit(input?.limit ?? 50);
        return {
          items: rows.map((r) => ({
            ...r,
            fastLane: r.aeoStatus === "certified",
          })),
        };
      }),
  }),

  drawback: router({
    /** Certified AEO exporter requests accelerated review of its own claim. */
    requestFastTrack: protectedProcedure
      .input(z.object({ claimId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        const accreditation = await accreditationOf(db, ctx.user.id);
        if (!accreditation) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "AEO certification is required for drawback fast-track — accreditation is granted through the AEO workflow only.",
          });
        }
        const [claim] = await db
          .select()
          .from(dutyDrawbackClaims)
          .where(eq(dutyDrawbackClaims.id, input.claimId))
          .limit(1);
        if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
        if (claim.traderId !== ctx.user.id) {
          // Never leak claim ownership across traders.
          throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
        }
        if (!["submitted", "under_review"].includes(claim.status)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Only submitted/under-review claims can be fast-tracked (current status: ${claim.status}).`,
          });
        }
        const [updated] = await db
          .update(dutyDrawbackClaims)
          .set({ fastTrack: true, fastTrackAt: new Date(), updatedAt: new Date() })
          .where(eq(dutyDrawbackClaims.id, claim.id))
          .returning();
        return updated;
      }),

    /** Officer drawback queue: fast-tracked (AEO) claims first, then FIFO. */
    fastTrackQueue: protectedProcedure
      .input(
        z.object({
          status: z.string().optional(),
          limit: z.number().int().min(1).max(200).default(50),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        requireOfficer(ctx.user.role);
        const db = await requireDb();
        const conditions = [];
        if (input?.status) conditions.push(eq(dutyDrawbackClaims.status, input.status as never));
        const rows = await db
          .select({
            id: dutyDrawbackClaims.id,
            claimNumber: dutyDrawbackClaims.claimNumber,
            traderId: dutyDrawbackClaims.traderId,
            traderName: users.name,
            drawbackType: dutyDrawbackClaims.drawbackType,
            status: dutyDrawbackClaims.status,
            claimedAmount: dutyDrawbackClaims.claimedAmount,
            fastTrack: dutyDrawbackClaims.fastTrack,
            fastTrackAt: dutyDrawbackClaims.fastTrackAt,
            submittedAt: dutyDrawbackClaims.submittedAt,
            aeoStatus: stakeholderProfiles.aeoStatus,
            aeoTier: stakeholderProfiles.aeoTier,
          })
          .from(dutyDrawbackClaims)
          .leftJoin(users, eq(dutyDrawbackClaims.traderId, users.id))
          .leftJoin(stakeholderProfiles, eq(dutyDrawbackClaims.traderId, stakeholderProfiles.userId))
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(
            desc(dutyDrawbackClaims.fastTrack),
            sql`${dutyDrawbackClaims.submittedAt} asc nulls last`,
            desc(dutyDrawbackClaims.id)
          )
          .limit(input?.limit ?? 50);
        return { items: rows };
      }),
  }),

  origin: router({
    /** Officer rules-of-origin queue: AEO fast-path certificates first. */
    fastPathQueue: protectedProcedure
      .input(
        z.object({
          status: z.string().optional(),
          limit: z.number().int().min(1).max(200).default(50),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        requireOfficer(ctx.user.role);
        const db = await requireDb();
        const conditions = [];
        if (input?.status) conditions.push(eq(originCertificates.status, input.status as never));
        const rows = await db
          .select({
            id: originCertificates.id,
            certNumber: originCertificates.certNumber,
            certType: originCertificates.certType,
            traderId: originCertificates.traderId,
            traderName: users.name,
            exporterName: originCertificates.exporterName,
            status: originCertificates.status,
            fastPath: originCertificates.fastPath,
            hsCode: originCertificates.hsCode,
            originCountry: originCertificates.originCountry,
            destinationCountry: originCertificates.destinationCountry,
            createdAt: originCertificates.createdAt,
            aeoStatus: stakeholderProfiles.aeoStatus,
            aeoTier: stakeholderProfiles.aeoTier,
          })
          .from(originCertificates)
          .leftJoin(users, eq(originCertificates.traderId, users.id))
          .leftJoin(stakeholderProfiles, eq(originCertificates.traderId, stakeholderProfiles.userId))
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(originCertificates.fastPath), desc(originCertificates.id))
          .limit(input?.limit ?? 50);
        return { items: rows };
      }),
  }),

  /** Trader self-service: my accreditation + fast-lane eligibility. */
  myAccreditation: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const accreditation = await accreditationOf(db, ctx.user.id);
    return { certified: accreditation !== null, aeoTier: accreditation?.aeoTier ?? null };
  }),

  admin: router({
    /** Admin surface: accredited exporter profiles (AEO-certified only). */
    accreditedExporters: adminProcedure
      .input(
        z.object({
          search: z.string().optional(),
          limit: z.number().int().min(1).max(200).default(50),
        }).optional()
      )
      .query(async ({ input }) => {
        const db = await requireDb();
        const rows = await db
          .select({
            profileId: stakeholderProfiles.id,
            userId: stakeholderProfiles.userId,
            userName: users.name,
            userEmail: users.email,
            organizationName: stakeholderProfiles.organizationName,
            stakeholderType: stakeholderProfiles.stakeholderType,
            aeoStatus: stakeholderProfiles.aeoStatus,
            aeoTier: stakeholderProfiles.aeoTier,
            approvedAt: stakeholderProfiles.approvedAt,
          })
          .from(stakeholderProfiles)
          .leftJoin(users, eq(stakeholderProfiles.userId, users.id))
          .where(
            and(
              eq(stakeholderProfiles.aeoStatus, "certified"),
              inArray(stakeholderProfiles.stakeholderType, ["trader", "freight_forwarder"])
            )
          )
          .orderBy(desc(TIER_RANK), desc(stakeholderProfiles.approvedAt))
          .limit(input?.limit ?? 50);
        const items = input?.search
          ? rows.filter((r) =>
              `${r.userName ?? ""} ${r.userEmail ?? ""} ${r.organizationName ?? ""}`
                .toLowerCase()
                .includes(input.search!.toLowerCase())
            )
          : rows;
        return { items };
      }),
  }),
});
