/**
 * shorePass.ts — Shore-pass / crew-change lifecycle (Phase 19, F5a / audit
 * A5-C5 completion).
 *
 * Builds on the existing FAL5/FAL6 IMO Compendium crew-list modelling
 * (server/data/imoMapping/v1/fal5.json field patterns) and the port-interop
 * seafarer/STCW registry (blueeconomy-port-interoperability
 * internal/registry/seafarer.go), which is consumed via the config-gated
 * server/_core/seafarerRegistryClient.ts — exactly like the PCS pages
 * consume port-interop.
 *
 * State machine (fail-closed, append-only audit via shore_pass_events):
 *
 *   SUBMITTED ──decide(approve)──▶ APPROVED ──revoke──▶ REVOKED
 *      │                            │
 *      └──decide(reject)──▶ REJECTED└──expiry (lazy + sweep)──▶ EXPIRED
 *
 * Approval gate: if the application carries an STCW certificate number, its
 * verificationStatus must be VERIFIED before an officer may approve.
 * NOT_CONFIGURED (port-interop not configured / unreachable) and FAILED
 * (registry outcome ≠ VALID) block approval — honest unavailable state,
 * never a silent pass. Applications without a certificate number
 * (NOT_REQUESTED) may be decided on the crew-list (FAL5) data alone.
 *
 * Crew data honesty: singlewindow does NOT hold the crew list; the FAL5/6
 * digest path (NIS) and the seafarer registry live upstream. When the
 * registry is not configured, `verifyCertificate` records NOT_CONFIGURED and
 * surfaces the honest state instead of fabricating a verification.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { randomBytes } from "node:crypto";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { shorePassApplications, shorePassEvents } from "../../drizzle/schema";
import { and, desc, eq, lte } from "drizzle-orm";
import { requireOfficer } from "./aeoFastLane";
import { verifyStcwCertificate } from "../_core/seafarerRegistryClient";
import {
  PortInteropConfigError,
  PortInteropRejectedError,
  PortInteropUnavailableError,
} from "../_core/portInteropClient";

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database is not available in this environment",
    });
  }
  return db;
}

// FAL5-derived field patterns (server/data/imoMapping/v1/fal5.json).
const IMO_NUMBER_RE = /^[0-9]{7}$/;
const PORT_CODE_RE = /^[A-Z]{2}[A-Z0-9]{3}$/;
const NATIONALITY_RE = /^[A-Z]{2}$/;
const DOB_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const crewInput = z.object({
  familyName: z.string().min(1).max(128),
  givenNames: z.string().min(1).max(128),
  nationalityCode: z.string().regex(NATIONALITY_RE, "nationalityCode must be an ISO-3166 alpha-2 code"),
  rankOrRating: z.string().min(1).max(64),
  dateOfBirth: z.string().regex(DOB_RE, "dateOfBirth must be YYYY-MM-DD"),
});

type ShorePassStatus = "SUBMITTED" | "APPROVED" | "REJECTED" | "REVOKED" | "EXPIRED";

async function recordEvent(
  db: any,
  event: {
    applicationId: number;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    actorId: number;
    detail?: string | null;
  }
) {
  await db.insert(shorePassEvents).values({
    applicationId: event.applicationId,
    action: event.action,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    actorId: event.actorId,
    detail: event.detail ?? null,
  });
}

/**
 * Lazy expiry: an APPROVED pass whose validUntil has passed transitions to
 * EXPIRED at read time (with an audit event) — expiry is wall-clock
 * authoritative, the stored row is bookkeeping.
 */
/**
 * Batched expiry sweep (Phase 21 perf): one set-based UPDATE transitions every
 * APPROVED pass whose validUntil has lapsed, plus one batched audit-event
 * insert — replacing up to N serialized lazy-expiry UPDATEs inside list
 * endpoints. Expiry remains wall-clock authoritative and fail-closed.
 * Returns the number of passes transitioned.
 */
async function sweepExpiredApplications(db: any): Promise<number> {
  const now = new Date();
  const expired = await db
    .update(shorePassApplications)
    .set({ status: "EXPIRED", updatedAt: now })
    .where(and(eq(shorePassApplications.status, "APPROVED"), lte(shorePassApplications.validUntil, now)))
    .returning();
  if (expired.length > 0) {
    await db.insert(shorePassEvents).values(
      expired.map((application: any) => ({
        applicationId: application.id,
        action: "expired",
        fromStatus: "APPROVED",
        toStatus: "EXPIRED",
        actorId: application.decidedBy ?? application.requestedBy,
        detail: "validUntil passed (batched expiry sweep)",
      }))
    );
  }
  return expired.length;
}

async function applyLazyExpiry(db: any, application: any): Promise<any> {
  if (
    application.status === "APPROVED" &&
    application.validUntil &&
    new Date(application.validUntil).getTime() <= Date.now()
  ) {
    await db
      .update(shorePassApplications)
      .set({ status: "EXPIRED", updatedAt: new Date() })
      .where(eq(shorePassApplications.id, application.id));
    await recordEvent(db, {
      applicationId: application.id,
      action: "expired",
      fromStatus: "APPROVED",
      toStatus: "EXPIRED",
      actorId: application.decidedBy ?? application.requestedBy,
      detail: "validUntil passed (lazy expiry at read time)",
    });
    return { ...application, status: "EXPIRED" };
  }
  return application;
}

export const shorePassRouter = router({
  submit: protectedProcedure
    .input(
      z.object({
        vesselImoNumber: z.string().regex(IMO_NUMBER_RE, "vesselImoNumber must be the 7-digit IMO number"),
        voyageNumber: z.string().min(1).max(64),
        portCode: z.string().regex(PORT_CODE_RE, "portCode must be a UN/LOCODE (e.g. NGLOS)"),
        crew: crewInput,
        purpose: z.string().min(3).max(2000),
        stcwCertificateNumber: z.string().min(4).max(64).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const applicationNumber = `SP-${new Date().getUTCFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`;
      const inserted = await db
        .insert(shorePassApplications)
        .values({
          applicationNumber,
          vesselImoNumber: input.vesselImoNumber,
          voyageNumber: input.voyageNumber,
          portCode: input.portCode,
          crewFamilyName: input.crew.familyName,
          crewGivenNames: input.crew.givenNames,
          crewNationalityCode: input.crew.nationalityCode,
          crewRankOrRating: input.crew.rankOrRating,
          crewDateOfBirth: input.crew.dateOfBirth,
          purpose: input.purpose,
          stcwCertificateNumber: input.stcwCertificateNumber ?? null,
          verificationStatus: "NOT_REQUESTED",
          status: "SUBMITTED",
          requestedBy: ctx.user.id,
        })
        .returning();
      await recordEvent(db, {
        applicationId: inserted[0].id,
        action: "submitted",
        fromStatus: null,
        toStatus: "SUBMITTED",
        actorId: ctx.user.id,
        detail: `shore pass requested for ${input.crew.familyName}, ${input.crew.givenNames} on IMO ${input.vesselImoNumber}`,
      });
      return { application: inserted[0] };
    }),

  /**
   * Officer: verify the application's STCW certificate against the upstream
   * seafarer registry. Honest states:
   *   - outcome VALID                          → verificationStatus VERIFIED
   *   - outcome EXPIRED/SUSPENDED/REVOKED/NOT_FOUND → FAILED (approval blocked)
   *   - registry not configured / unreachable  → NOT_CONFIGURED (approval
   *     blocked) plus a PRECONDITION_FAILED/INTERNAL_SERVER_ERROR signal;
   *     the recorded state is the durable honest artifact.
   */
  verifyCertificate: protectedProcedure
    .input(z.object({ applicationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);
      const db = await requireDb();
      const rows = await db
        .select()
        .from(shorePassApplications)
        .where(eq(shorePassApplications.id, input.applicationId))
        .limit(1);
      const application = rows[0];
      if (!application) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Shore-pass application ${input.applicationId} not found` });
      }
      if (application.status !== "SUBMITTED") {
        throw new TRPCError({ code: "CONFLICT", message: `Application is ${application.status} — verification only applies to SUBMITTED` });
      }
      if (!application.stcwCertificateNumber) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Application carries no STCW certificate number" });
      }

      try {
        const verification = await verifyStcwCertificate(application.stcwCertificateNumber, {
          principal: `user:${ctx.user.id}`,
        });
        const ok = verification.outcome === "VALID";
        await db
          .update(shorePassApplications)
          .set({
            verificationStatus: ok ? "VERIFIED" : "FAILED",
            verificationOutcome: verification.outcome,
            updatedAt: new Date(),
          })
          .where(eq(shorePassApplications.id, application.id));
        await recordEvent(db, {
          applicationId: application.id,
          action: ok ? "certificate_verified" : "certificate_failed",
          fromStatus: application.status,
          toStatus: application.status,
          actorId: ctx.user.id,
          detail: `STCW ${application.stcwCertificateNumber}: registry outcome ${verification.outcome}`,
        });
        return { verificationStatus: ok ? "VERIFIED" : "FAILED", outcome: verification.outcome };
      } catch (err) {
        if (err instanceof PortInteropConfigError) {
          await db
            .update(shorePassApplications)
            .set({ verificationStatus: "NOT_CONFIGURED", verificationOutcome: null, updatedAt: new Date() })
            .where(eq(shorePassApplications.id, application.id));
          await recordEvent(db, {
            applicationId: application.id,
            action: "verification_unavailable",
            fromStatus: application.status,
            toStatus: application.status,
            actorId: ctx.user.id,
            detail: "CREW_REGISTRY_NOT_CONFIGURED: seafarer/STCW registry is not configured in this deployment",
          });
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "CREW_REGISTRY_NOT_CONFIGURED: the seafarer/STCW registry (port-interop) is not configured, " +
              "so certificate verification is unavailable and this application cannot be approved.",
          });
        }
        if (err instanceof PortInteropRejectedError) {
          await db
            .update(shorePassApplications)
            .set({ verificationStatus: "FAILED", verificationOutcome: null, updatedAt: new Date() })
            .where(eq(shorePassApplications.id, application.id));
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        if (err instanceof PortInteropUnavailableError) {
          await db
            .update(shorePassApplications)
            .set({ verificationStatus: "NOT_CONFIGURED", verificationOutcome: null, updatedAt: new Date() })
            .where(eq(shorePassApplications.id, application.id));
          await recordEvent(db, {
            applicationId: application.id,
            action: "verification_unavailable",
            fromStatus: application.status,
            toStatus: application.status,
            actorId: ctx.user.id,
            detail: `CREW_REGISTRY_UNAVAILABLE: ${err.reason}`,
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `CREW_REGISTRY_UNAVAILABLE: the seafarer/STCW registry is unreachable (${err.reason}) — verification was NOT performed.`,
          });
        }
        throw err;
      }
    }),

  /** Officer: approve or reject. Approval is verification-gated (fail closed). */
  decide: protectedProcedure
    .input(
      z.object({
        applicationId: z.number().int().positive(),
        approve: z.boolean(),
        reason: z.string().max(2000).optional(),
        validFrom: z.string().datetime().optional(),
        validUntil: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);
      const db = await requireDb();
      const rows = await db
        .select()
        .from(shorePassApplications)
        .where(eq(shorePassApplications.id, input.applicationId))
        .limit(1);
      const application = rows[0];
      if (!application) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Shore-pass application ${input.applicationId} not found` });
      }
      if (application.status !== "SUBMITTED") {
        throw new TRPCError({ code: "CONFLICT", message: `Application is ${application.status} — only SUBMITTED can be decided` });
      }
      let validFrom: Date | null = null;
      let validUntil: Date | null = null;
      if (input.approve) {
        // Fail closed: a cert-bearing application must be VERIFIED.
        if (application.stcwCertificateNumber && application.verificationStatus !== "VERIFIED") {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              `Approval blocked: STCW certificate verification is ${application.verificationStatus} ` +
              `(must be VERIFIED). Run verifyCertificate first; NOT_CONFIGURED/FAILED can never be approved.`,
          });
        }
        if (!input.validUntil) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "validUntil is required when approving" });
        }
        validFrom = input.validFrom ? new Date(input.validFrom) : new Date();
        validUntil = new Date(input.validUntil);
        if (validUntil.getTime() <= validFrom.getTime()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "validUntil must be after validFrom" });
        }
      } else if (!input.reason?.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "reason is required when rejecting" });
      }
      const toStatus: ShorePassStatus = input.approve ? "APPROVED" : "REJECTED";
      await db
        .update(shorePassApplications)
        .set({
          status: toStatus,
          decidedBy: ctx.user.id,
          decisionReason: input.reason ?? null,
          validFrom,
          validUntil,
          updatedAt: new Date(),
        })
        .where(eq(shorePassApplications.id, application.id));
      await recordEvent(db, {
        applicationId: application.id,
        action: input.approve ? "approved" : "rejected",
        fromStatus: "SUBMITTED",
        toStatus,
        actorId: ctx.user.id,
        detail: input.reason ?? null,
      });
      return { status: toStatus };
    }),

  /** Officer: revoke an APPROVED pass (e.g. crew member left without signing off). */
  revoke: protectedProcedure
    .input(z.object({ applicationId: z.number().int().positive(), reason: z.string().min(3).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);
      const db = await requireDb();
      const rows = await db
        .select()
        .from(shorePassApplications)
        .where(eq(shorePassApplications.id, input.applicationId))
        .limit(1);
      const application = rows[0] ? await applyLazyExpiry(db, rows[0]) : null;
      if (!application) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Shore-pass application ${input.applicationId} not found` });
      }
      if (application.status !== "APPROVED") {
        throw new TRPCError({ code: "CONFLICT", message: `Application is ${application.status} — only APPROVED can be revoked` });
      }
      await db
        .update(shorePassApplications)
        .set({ status: "REVOKED", decisionReason: input.reason, updatedAt: new Date() })
        .where(eq(shorePassApplications.id, application.id));
      await recordEvent(db, {
        applicationId: application.id,
        action: "revoked",
        fromStatus: "APPROVED",
        toStatus: "REVOKED",
        actorId: ctx.user.id,
        detail: input.reason,
      });
      return { status: "REVOKED" };
    }),

  /** Officer: sweep APPROVED passes whose validity has lapsed into EXPIRED. */
  expireSweep: protectedProcedure.mutation(async ({ ctx }) => {
    requireOfficer(ctx.user.role);
    const db = await requireDb();
    const approved = await db
      .select()
      .from(shorePassApplications)
      .where(eq(shorePassApplications.status, "APPROVED"));
    // Phase 21 (perf): single set-based UPDATE instead of a per-row loop.
    const expired = await sweepExpiredApplications(db);
    return { scanned: approved.length, expired };
  }),

  /** Owner (or officer) reads one application with its audit trail. */
  get: protectedProcedure
    .input(z.object({ applicationId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(shorePassApplications)
        .where(eq(shorePassApplications.id, input.applicationId))
        .limit(1);
      if (!rows[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Shore-pass application ${input.applicationId} not found` });
      }
      const isOwner = rows[0].requestedBy === ctx.user.id;
      if (!isOwner) requireOfficer(ctx.user.role);
      const application = await applyLazyExpiry(db, rows[0]);
      const events = await db
        .select()
        .from(shorePassEvents)
        .where(eq(shorePassEvents.applicationId, application.id));
      return { application, events };
    }),

  listMine: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    // Phase 21 (perf): batch the expiry transition (one UPDATE) instead of a
    // serialized per-row lazy-expiry write; bound the result set.
    await sweepExpiredApplications(db);
    const rows = await db
      .select()
      .from(shorePassApplications)
      .where(eq(shorePassApplications.requestedBy, ctx.user.id))
      .orderBy(desc(shorePassApplications.createdAt))
      .limit(200);
    return { applications: rows };
  }),

  listForOfficer: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(["SUBMITTED", "APPROVED", "REJECTED", "REVOKED", "EXPIRED"]).optional(),
          vesselImoNumber: z.string().regex(IMO_NUMBER_RE).optional(),
          // Phase 21 (perf): the unfiltered read previously had NO LIMIT at
          // all. Pagination is now mandatory-bounded (default 100, max 500).
          limit: z.number().int().min(1).max(500).default(100),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);
      const db = await requireDb();
      // Batch the expiry transition before reading (one UPDATE, not N).
      await sweepExpiredApplications(db);
      const conditions = [];
      if (input?.status) conditions.push(eq(shorePassApplications.status, input.status));
      if (input?.vesselImoNumber) conditions.push(eq(shorePassApplications.vesselImoNumber, input.vesselImoNumber));
      const limit = input?.limit ?? 100;
      const offset = input?.offset ?? 0;
      const rows = await db
        .select()
        .from(shorePassApplications)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(shorePassApplications.createdAt))
        .limit(limit)
        .offset(offset);
      return { applications: rows, limit, offset };
    }),
});
