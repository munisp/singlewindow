import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  exciseAggregateChildren,
  exciseAggregates,
  exciseAnomalies,
  exciseFacilities,
  exciseLicenceSuspensions,
  exciseLicences,
  exciseMarkActivations,
  exciseMarkingMachines,
  exciseMovementEvents,
  exciseProducts,
  exciseProductionReports,
  exciseReconciliationReports,
  exciseRetirements,
  exciseScans,
  exciseSeizures,
  exciseStampMarks,
  exciseStampOrders,
  exciseTaxSchemes,
  declarations,
  billsOfLading,
  manifests,
  tigerBeetleLedgerEntries,
} from "../../drizzle/schema";
import { getDb, logAuditEvent, createLedgerEntry } from "../db";
import { protectedProcedure, publicRateLimitedProcedure, router } from "../_core/trpc";
import { tbBridgeAvailable, tbFetch } from "./ledger";
import { SYSTEM_ACCOUNTS } from "../_core/paymentAccountProvisioner";
import {
  EXCISE_UID_HMAC_ENV,
  EXCISE_UID_KEY_ID_ENV,
} from "../_core/webhookSecretsValidator";

const REVIEWER_ROLES = new Set(["admin", "customs_officer", "oga_officer"]);
const ID_ISSUER_ROLES = new Set(["admin", "customs_officer"]);
const ENFORCEMENT_ROLES = new Set(["admin", "customs_officer", "oga_officer", "inspector"]);
const AGGREGATE_LEVEL: Record<"carton" | "case" | "pallet", number> = { carton: 1, case: 2, pallet: 3 };

// 120 km/h is above plausible road/rail movement for a tax mark, while avoiding
// false positives from ordinary city-to-city commercial transport.
export const IMPOSSIBLE_TRAVEL_SPEED_KMH = 120;

export type ExcisePublicStatus = "authentic" | "unknown" | "suspect" | "unavailable";

export type ExciseTraversalUnavailableReason =
  | "mark_not_found"
  | "order_missing"
  | "declaration_missing"
  | "bill_of_lading_not_linked"
  | "bill_of_lading_ambiguous"
  | "bill_of_lading_not_in_manifest"
  | "manifest_missing"
  | "manifest_vessel_missing"
  | "importer_missing"
  | "acting_agent_missing";

function unavailable(message: string, cause?: unknown): never {
  if (cause instanceof TRPCError) throw cause;
  throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message, cause });
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Excise database is unavailable." });
  return db;
}

function isOfficer(role: string): boolean {
  return REVIEWER_ROLES.has(role);
}

function isIdIssuer(role: string): boolean {
  return ID_ISSUER_ROLES.has(role);
}

function isEnforcement(role: string): boolean {
  return ENFORCEMENT_ROLES.has(role);
}

async function requireLicence(
  licenceId: number,
  userId: number,
  role: string,
  requireActive = true,
) {
  const db = await requireDb();
  const [licence] = await db.select().from(exciseLicences).where(eq(exciseLicences.id, licenceId)).limit(1);
  if (!licence) throw new TRPCError({ code: "NOT_FOUND", message: "Excise licence not found." });
  if (!isOfficer(role) && licence.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  if (requireActive) {
    const now = new Date();
    if (licence.status !== "active" || licence.validFrom > now || licence.validUntil <= now) {
      throw new TRPCError({ code: "FORBIDDEN", message: "The excise licence is not currently valid." });
    }
  }
  return { db, licence };
}

function authorityIdentifier(prefix: string): string {
  return `TG-${prefix}-${randomBytes(12).toString("hex").toUpperCase()}`;
}

function parseScaled(value: string, scale = 6): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid decimal amount." });
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > scale) throw new TRPCError({ code: "BAD_REQUEST", message: "Decimal precision is too high." });
  return BigInt(whole) * (10n ** BigInt(scale)) + BigInt(fraction.padEnd(scale, "0") || "0");
}

function formatMoney(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

export function calculateExciseLiability(
  scheme: {
    schemeType: "specific" | "ad_valorem" | "hybrid";
    specificAmount: string | null;
    specificUnitOfMeasure?: string | null;
    adValoremRate: string | null;
    hybridWhicheverGreater: boolean;
  },
  product: { unitContent: string; unitOfMeasure?: string },
  quantity: number,
  declaredValue: string | undefined,
): string {
  if (scheme.specificUnitOfMeasure && product.unitOfMeasure && scheme.specificUnitOfMeasure !== product.unitOfMeasure) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The tax scheme unit does not match the product unit." });
  }
  const scale = 1_000_000n;
  const specific = scheme.specificAmount
    ? parseScaled(scheme.specificAmount) * parseScaled(product.unitContent) * BigInt(quantity) / scale
    : null;
  const adValorem = scheme.adValoremRate && declaredValue
    ? parseScaled(declaredValue) * parseScaled(scheme.adValoremRate) * BigInt(quantity) / (scale * 100n)
    : null;
  if (scheme.schemeType === "specific" && specific !== null) {
    return formatMoney((specific + 5_000n) / 10_000n);
  }
  if (scheme.schemeType === "ad_valorem" && adValorem !== null) {
    return formatMoney((adValorem + 5_000n) / 10_000n);
  }
  if (scheme.schemeType === "hybrid" && specific !== null && adValorem !== null) {
    const chosen = scheme.hybridWhicheverGreater
      ? (specific > adValorem ? specific : adValorem)
      : specific + adValorem;
    return formatMoney((chosen + 5_000n) / 10_000n);
  }
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "The tax scheme is missing the values required for this assessment.",
  });
}

export function verifyExciseUid(uid: string): {
  status: "signature_valid_pending_reconciliation" | "invalid_signature";
  keyId: string | null;
} {
  const parts = uid.split(".");
  if (parts.length !== 3) return { status: "invalid_signature", keyId: null };
  const [keyId, nonce, signature] = parts;
  const key = getExciseKey(keyId);
  if (!isStrongExciseKey(key)) return { status: "invalid_signature", keyId };
  const expected = createHmac("sha256", key).update(`${keyId}.${nonce}`).digest("hex").slice(0, 32);
  const valid = expected.length === signature.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  return {
    status: valid ? "signature_valid_pending_reconciliation" : "invalid_signature",
    keyId,
  };
}

function getExciseKey(keyId: string): string | undefined {
  const configuredKeyId = process.env[EXCISE_UID_KEY_ID_ENV] ?? "v1";
  if (keyId === configuredKeyId) return process.env[EXCISE_UID_HMAC_ENV];
  const rotatedKey = process.env[`${EXCISE_UID_HMAC_ENV}_${keyId}`];
  if (rotatedKey) return rotatedKey;
  const configuredKeys = process.env.EXCISE_UID_HMAC_KEYS;
  if (!configuredKeys) return undefined;
  try {
    const keys: unknown = JSON.parse(configuredKeys);
    if (typeof keys !== "object" || keys === null || Array.isArray(keys)) return undefined;
    const candidate = (keys as Record<string, unknown>)[keyId];
    return typeof candidate === "string" ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function isStrongExciseKey(value: string | undefined): value is string {
  if (!value || value.length < 32) return false;
  return !value.toLowerCase().includes("dev") && !value.toLowerCase().includes("secret");
}

export function mintExciseUid(): { uid: string; payload: string; signature: string; keyId: string } {
  const key = process.env[EXCISE_UID_HMAC_ENV];
  const keyId = process.env[EXCISE_UID_KEY_ID_ENV] ?? "v1";
  if (!isStrongExciseKey(key)) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Excise UID signing is unavailable." });
  }
  const payload = `${keyId}.${randomBytes(24).toString("hex")}`;
  const signature = createHmac("sha256", key).update(payload).digest("hex").slice(0, 32);
  return { uid: `${payload}.${signature}`, payload, signature, keyId };
}

function distanceKm(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(second.latitude - first.latitude);
  const dLon = radians(second.longitude - first.longitude);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function recordScan(
  db: Awaited<ReturnType<typeof requireDb>>,
  uid: string,
  markId: number | null,
  source: "public" | "enforcement",
  scannedBy: number | null,
  latitude: number | undefined,
  longitude: number | undefined,
) {
  const [previous] = await db.select().from(exciseScans)
    .where(eq(exciseScans.uid, uid))
    .orderBy(desc(exciseScans.scannedAt))
    .limit(1);
  let impossibleTravel = false;
  let impliedSpeedKmh: string | undefined;
  if (previous && previous.latitude !== null && previous.longitude !== null &&
      latitude !== undefined && longitude !== undefined) {
    const elapsedHours = (Date.now() - previous.scannedAt.getTime()) / 3_600_000;
    if (elapsedHours > 0) {
      const speed = distanceKm(
        { latitude: previous.latitude, longitude: previous.longitude },
        { latitude, longitude },
      ) / elapsedHours;
      impliedSpeedKmh = speed.toFixed(2);
      impossibleTravel = speed > IMPOSSIBLE_TRAVEL_SPEED_KMH;
    }
  }
  const [scan] = await db.insert(exciseScans).values({
    uid,
    markId,
    source,
    scannedBy,
    localityHash: latitude !== undefined && longitude !== undefined
      ? createHash("sha256").update(`${latitude.toFixed(2)}:${longitude.toFixed(2)}`).digest("hex")
      : null,
    latitude: latitude === undefined ? undefined : Number(latitude.toFixed(2)),
    longitude: longitude === undefined ? undefined : Number(longitude.toFixed(2)),
    previousScanId: previous?.id,
    impliedSpeedKmh,
    impossibleTravel,
  }).returning();
  if (impossibleTravel) {
    await db.insert(exciseAnomalies).values({
      markId,
      anomalyType: "impossible_travel",
      details: { previousScanId: previous?.id, scanId: scan.id, impliedSpeedKmh },
    });
  }
  return scan;
}

const transitionOrder = {
  ordered: "assessed",
  assessed: "payment",
  payment: "fulfilment",
  fulfilment: "delivery",
} as const;

function requireTransition(status: string, expected: string): void {
  if (!(status in transitionOrder) || transitionOrder[status as keyof typeof transitionOrder] !== expected) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Order must transition from ${status} to ${expected}.` });
  }
}

export const exciseRouter = router({
  registerLicence: protectedProcedure
    .input(z.object({
      licenseNumber: z.string().min(2).max(128),
      licenseeType: z.enum(["manufacturer", "importer", "distributor", "retailer"]),
      productCategories: z.array(z.string().min(1).max(64)).min(1).max(30),
      validFrom: z.string().datetime(),
      validUntil: z.string().datetime(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        if (new Date(input.validUntil) <= new Date(input.validFrom)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Licence validity window is invalid." });
        }
        const db = await requireDb();
        const [licence] = await db.insert(exciseLicences).values({
          licenseNumber: input.licenseNumber,
          userId: ctx.user.id,
          licenseeType: input.licenseeType,
          economicOperatorId: authorityIdentifier("EO"),
          productCategories: input.productCategories,
          validFrom: new Date(input.validFrom),
          validUntil: new Date(input.validUntil),
          status: "pending",
        }).returning();
        await logAuditEvent({
          entityType: "user",
          entityId: ctx.user.id,
          action: "excise_licence_registered",
          actorId: ctx.user.id,
          actorType: input.licenseeType,
          newState: { licenceId: licence.id, status: licence.status },
        });
        return licence;
      } catch (error) {
        return unavailable("Excise licence registration is unavailable.", error);
      }
    }),

  listLicences: protectedProcedure.query(async ({ ctx }) => {
    try {
      const db = await requireDb();
      if (isOfficer(ctx.user.role)) return db.select().from(exciseLicences).orderBy(desc(exciseLicences.createdAt));
      return db.select().from(exciseLicences).where(eq(exciseLicences.userId, ctx.user.id)).orderBy(desc(exciseLicences.createdAt));
    } catch (error) {
      return unavailable("Excise licences are unavailable.", error);
    }
  }),

  approveLicence: protectedProcedure
    .input(z.object({ licenceId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (!isOfficer(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const db = await requireDb();
        const [licence] = await db.update(exciseLicences).set({
          status: "active",
          approvedBy: ctx.user.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(exciseLicences.id, input.licenceId)).returning();
        if (!licence) throw new TRPCError({ code: "NOT_FOUND" });
        await logAuditEvent({ entityType: "user", entityId: licence.userId, action: "excise_licence_approved", actorId: ctx.user.id, actorType: ctx.user.role, newState: { licenceId: licence.id, status: licence.status } });
        return licence;
      } catch (error) {
        return unavailable("Excise licence approval is unavailable.", error);
      }
    }),

  suspendLicence: protectedProcedure
    .input(z.object({ licenceId: z.number().int().positive(), reason: z.string().min(10).max(1024) }))
    .mutation(async ({ ctx, input }) => {
      if (!isOfficer(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const db = await requireDb();
        const now = new Date();
        const [licence] = await db.update(exciseLicences).set({
          status: "suspended", suspendedBy: ctx.user.id, suspendedAt: now, suspensionReason: input.reason, updatedAt: now,
        }).where(eq(exciseLicences.id, input.licenceId)).returning();
        if (!licence) throw new TRPCError({ code: "NOT_FOUND" });
        await db.insert(exciseLicenceSuspensions).values({ licenceId: licence.id, suspendedBy: ctx.user.id, suspendedAt: now, reason: input.reason });
        await logAuditEvent({ entityType: "user", entityId: licence.userId, action: "excise_licence_suspended", actorId: ctx.user.id, actorType: ctx.user.role, newState: { licenceId: licence.id, status: licence.status, reason: input.reason } });
        return licence;
      } catch (error) {
        return unavailable("Excise licence suspension is unavailable.", error);
      }
    }),

  liftSuspension: protectedProcedure
    .input(z.object({ licenceId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (!isOfficer(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const db = await requireDb();
        const [licence] = await db.select().from(exciseLicences).where(eq(exciseLicences.id, input.licenceId)).limit(1);
        if (!licence) throw new TRPCError({ code: "NOT_FOUND" });
        if (licence.status !== "suspended") throw new TRPCError({ code: "BAD_REQUEST", message: "Only suspended licences can be reinstated." });
        const now = new Date();
        const status = licence.validUntil > now ? "active" : "expired";
        const [updated] = await db.update(exciseLicences).set({
          status, suspendedBy: null, suspendedAt: null, suspensionReason: null, updatedAt: now,
        }).where(eq(exciseLicences.id, licence.id)).returning();
        await db.update(exciseLicenceSuspensions).set({ liftedAt: now, liftedBy: ctx.user.id })
          .where(and(eq(exciseLicenceSuspensions.licenceId, licence.id), isNull(exciseLicenceSuspensions.liftedAt)));
        await logAuditEvent({ entityType: "user", entityId: licence.userId, action: "excise_licence_suspension_lifted", actorId: ctx.user.id, actorType: ctx.user.role, newState: { licenceId: licence.id, status } });
        return updated;
      } catch (error) {
        return unavailable("Excise licence suspension update is unavailable.", error);
      }
    }),

  revokeLicence: protectedProcedure
    .input(z.object({ licenceId: z.number().int().positive(), reason: z.string().min(10).max(1024) }))
    .mutation(async ({ ctx, input }) => {
      if (!isOfficer(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const db = await requireDb();
        const [licence] = await db.update(exciseLicences).set({
          status: "revoked", revokedBy: ctx.user.id, revokedAt: new Date(), revocationReason: input.reason, updatedAt: new Date(),
        }).where(eq(exciseLicences.id, input.licenceId)).returning();
        if (!licence) throw new TRPCError({ code: "NOT_FOUND" });
        await logAuditEvent({ entityType: "user", entityId: licence.userId, action: "excise_licence_revoked", actorId: ctx.user.id, actorType: ctx.user.role, newState: { licenceId: licence.id, status: licence.status, reason: input.reason } });
        return licence;
      } catch (error) {
        return unavailable("Excise licence revocation is unavailable.", error);
      }
    }),

  suspensionHistory: protectedProcedure
    .input(z.object({ licenceId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        const { db } = await requireLicence(input.licenceId, ctx.user.id, ctx.user.role, false);
        return db.select().from(exciseLicenceSuspensions).where(eq(exciseLicenceSuspensions.licenceId, input.licenceId)).orderBy(desc(exciseLicenceSuspensions.suspendedAt));
      } catch (error) {
        return unavailable("Excise suspension history is unavailable.", error);
      }
    }),

  createFacility: protectedProcedure
    .input(z.object({ licenceId: z.number().int().positive(), name: z.string().min(2).max(255), address: z.string().max(1024).optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { db, licence } = await requireLicence(input.licenceId, ctx.user.id, ctx.user.role);
        if (!isIdIssuer(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "An ID issuer must create facility identifiers." });
        const [facility] = await db.insert(exciseFacilities).values({
          licenceId: licence.id, facilityIdentifier: authorityIdentifier("FI"), name: input.name, address: input.address, createdBy: ctx.user.id,
        }).returning();
        await logAuditEvent({ entityType: "user", entityId: licence.userId, action: "excise_facility_created", actorId: ctx.user.id, actorType: ctx.user.role, newState: { facilityId: facility.id } });
        return facility;
      } catch (error) {
        return unavailable("Excise facility registration is unavailable.", error);
      }
    }),

  createMachine: protectedProcedure
    .input(z.object({ facilityId: z.number().int().positive(), name: z.string().min(2).max(255) }))
    .mutation(async ({ ctx, input }) => {
      try {
        if (!isIdIssuer(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
        const db = await requireDb();
        const [facility] = await db.select().from(exciseFacilities).where(eq(exciseFacilities.id, input.facilityId)).limit(1);
        if (!facility) throw new TRPCError({ code: "NOT_FOUND" });
        await requireLicence(facility.licenceId, ctx.user.id, ctx.user.role);
        const [machine] = await db.insert(exciseMarkingMachines).values({
          facilityId: facility.id, machineIdentifier: authorityIdentifier("MI"), name: input.name, createdBy: ctx.user.id,
        }).returning();
        await logAuditEvent({ entityType: "user", entityId: ctx.user.id, action: "excise_machine_created", actorId: ctx.user.id, actorType: ctx.user.role, newState: { machineId: machine.id } });
        return machine;
      } catch (error) {
        return unavailable("Excise machine registration is unavailable.", error);
      }
    }),

  createTaxScheme: protectedProcedure
    .input(z.object({
      code: z.string().min(2).max(64),
      schemeType: z.enum(["specific", "ad_valorem", "hybrid"]),
      specificAmount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
      specificUnitOfMeasure: z.string().max(32).optional(),
      adValoremRate: z.string().regex(/^\d+(\.\d+)?$/).optional(),
      hybridWhicheverGreater: z.boolean().default(false),
      currency: z.string().length(3).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!isOfficer(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const db = await requireDb();
        const [scheme] = await db.insert(exciseTaxSchemes).values({ ...input, createdBy: ctx.user.id }).returning();
        return scheme;
      } catch (error) {
        return unavailable("Excise tax scheme registration is unavailable.", error);
      }
    }),

  registerProduct: protectedProcedure
    .input(z.object({
      licenceId: z.number().int().positive(),
      sku: z.string().min(2).max(128),
      brand: z.string().min(1).max(255),
      packSize: z.number().int().positive(),
      unitContent: z.string().regex(/^\d+(\.\d+)?$/),
      unitOfMeasure: z.string().min(1).max(32),
      strength: z.string().regex(/^\d+(\.\d+)?$/).optional(),
      schemeId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { db, licence } = await requireLicence(input.licenceId, ctx.user.id, ctx.user.role);
        const [product] = await db.insert(exciseProducts).values({
          ...input, licenceId: licence.id, createdBy: ctx.user.id, approvalStatus: "pending",
        }).returning();
        await logAuditEvent({ entityType: "user", entityId: licence.userId, action: "excise_product_registered", actorId: ctx.user.id, actorType: "licensee", newState: { productId: product.id, approvalStatus: product.approvalStatus } });
        return product;
      } catch (error) {
        return unavailable("Excise product registration is unavailable.", error);
      }
    }),

  approveProduct: protectedProcedure
    .input(z.object({ productId: z.number().int().positive(), approved: z.boolean(), reason: z.string().max(1024).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!isOfficer(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const db = await requireDb();
        const [product] = await db.update(exciseProducts).set({
          approvalStatus: input.approved ? "approved" : "rejected",
          approvedBy: input.approved ? ctx.user.id : null,
          approvedAt: input.approved ? new Date() : null,
          rejectionReason: input.approved ? null : input.reason,
          updatedAt: new Date(),
        }).where(eq(exciseProducts.id, input.productId)).returning();
        if (!product) throw new TRPCError({ code: "NOT_FOUND" });
        return product;
      } catch (error) {
        return unavailable("Excise product approval is unavailable.", error);
      }
    }),

  createOrder: protectedProcedure
    .input(z.object({
      licenceId: z.number().int().positive(),
      productId: z.number().int().positive(),
      facilityId: z.number().int().positive(),
      declarationId: z.number().int().positive().optional(),
      quantity: z.number().int().positive(),
      declaredValue: z.string().regex(/^\d+(\.\d+)?$/).optional(),
      currency: z.string().length(3),
      liability: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { db, licence } = await requireLicence(input.licenceId, ctx.user.id, ctx.user.role);
        const [product] = await db.select().from(exciseProducts).where(and(eq(exciseProducts.id, input.productId), eq(exciseProducts.licenceId, licence.id))).limit(1);
        if (!product || product.approvalStatus !== "approved") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "An approved SKU is required." });
        const [facility] = await db.select().from(exciseFacilities).where(and(eq(exciseFacilities.id, input.facilityId), eq(exciseFacilities.licenceId, licence.id))).limit(1);
        if (!facility) throw new TRPCError({ code: "FORBIDDEN", message: "Facility does not belong to the licence." });
        const [scheme] = await db.select().from(exciseTaxSchemes).where(eq(exciseTaxSchemes.id, product.schemeId)).limit(1);
        if (!scheme || !scheme.active) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The tax scheme is unavailable." });
        if (input.declarationId) {
          const [declaration] = await db.select().from(declarations).where(eq(declarations.id, input.declarationId)).limit(1);
          if (!declaration) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found." });
          if (!isOfficer(ctx.user.role) && (declaration.principalId ?? declaration.traderId) !== licence.userId) {
            throw new TRPCError({ code: "FORBIDDEN" });
          }
        }
        const liability = calculateExciseLiability(scheme, product, input.quantity, input.declaredValue);
        const [order] = await db.insert(exciseStampOrders).values({
          orderNumber: `EXO-${randomBytes(10).toString("hex").toUpperCase()}`,
          licenceId: licence.id, productId: product.id, facilityId: facility.id,
          declarationId: input.declarationId, quantity: input.quantity, declaredValue: input.declaredValue, liability, currency: input.currency,
          status: "ordered", createdBy: ctx.user.id,
        }).returning();
        await logAuditEvent({ entityType: "user", entityId: ctx.user.id, action: "excise_order_created", actorId: ctx.user.id, actorType: "licensee", newState: { orderId: order.id, status: order.status, liability } });
        return order;
      } catch (error) {
        return unavailable("Excise stamp ordering is unavailable.", error);
      }
    }),

  assessOrder: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive(), declaredValue: z.string().regex(/^\d+(\.\d+)?$/).optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await requireDb();
        const [order] = await db.select().from(exciseStampOrders).where(eq(exciseStampOrders.id, input.orderId)).limit(1);
        if (!order) throw new TRPCError({ code: "NOT_FOUND" });
        await requireLicence(order.licenceId, ctx.user.id, ctx.user.role);
        requireTransition(order.status, "assessed");
        const [product] = await db.select().from(exciseProducts).where(eq(exciseProducts.id, order.productId)).limit(1);
        if (!product) throw new TRPCError({ code: "NOT_FOUND" });
        const [scheme] = await db.select().from(exciseTaxSchemes).where(eq(exciseTaxSchemes.id, product.schemeId)).limit(1);
        if (!scheme) throw new TRPCError({ code: "PRECONDITION_FAILED" });
        const liability = calculateExciseLiability(scheme, product, order.quantity, input.declaredValue ?? order.declaredValue ?? undefined);
        const [updated] = await db.update(exciseStampOrders).set({ status: "assessed", liability, assessedAt: new Date(), updatedAt: new Date() }).where(eq(exciseStampOrders.id, order.id)).returning();
        await logAuditEvent({ entityType: "user", entityId: ctx.user.id, action: "excise_order_assessed", actorId: ctx.user.id, actorType: "licensee", newState: { orderId: order.id, liability, status: updated.status } });
        return updated;
      } catch (error) {
        return unavailable("Excise stamp assessment is unavailable.", error);
      }
    }),

  payOrder: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await requireDb();
        const [order] = await db.select().from(exciseStampOrders).where(eq(exciseStampOrders.id, input.orderId)).limit(1);
        if (!order) throw new TRPCError({ code: "NOT_FOUND" });
        const { licence } = await requireLicence(order.licenceId, ctx.user.id, ctx.user.role);
        requireTransition(order.status, "payment");
        if (!order.liability) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Order must be assessed before payment." });
        if (!(await tbBridgeAvailable())) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "TigerBeetle bridge is unavailable." });
        const transfer = await tbFetch<{ id: string }>("/api/ledger/transfers", {
          method: "POST",
          body: JSON.stringify({
            debitAccountId: `trader-${licence.userId}`,
            creditAccountId: SYSTEM_ACCOUNTS.NCS_REVENUE,
            amount: order.liability,
            currency: order.currency,
            reference: order.orderNumber,
            description: `Excise stamp liability for ${order.orderNumber}`,
          }),
        });
        await createLedgerEntry({
          tbTransferId: transfer.id,
          debitAccountId: `trader-${licence.userId}`,
          creditAccountId: SYSTEM_ACCOUNTS.NCS_REVENUE,
          amountMinorUnits: Number(parseScaled(order.liability, 2)),
          currency: order.currency,
          ledger: 1,
          entryType: "excise_stamp_liability",
          status: "posted",
          reference: order.orderNumber,
          description: `Excise stamp liability for ${order.orderNumber}`,
          postedAt: new Date(),
        });
        const [updated] = await db.update(exciseStampOrders).set({ status: "payment", ledgerTransferId: transfer.id, paidAt: new Date(), updatedAt: new Date() }).where(eq(exciseStampOrders.id, order.id)).returning();
        await logAuditEvent({ entityType: "user", entityId: ctx.user.id, action: "excise_order_paid", actorId: ctx.user.id, actorType: "licensee", newState: { orderId: order.id, status: updated.status, transferId: transfer.id } });
        return updated;
      } catch (error) {
        return unavailable("Excise stamp payment is unavailable.", error);
      }
    }),

  fulfilOrder: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive(), machineId: z.number().int().positive().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await requireDb();
        const [order] = await db.select().from(exciseStampOrders).where(eq(exciseStampOrders.id, input.orderId)).limit(1);
        if (!order) throw new TRPCError({ code: "NOT_FOUND" });
        await requireLicence(order.licenceId, ctx.user.id, ctx.user.role);
        requireTransition(order.status, "fulfilment");
        if (order.declarationId) {
          if (!(await tbBridgeAvailable())) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Settlement ledger is unavailable." });
          const [declaration] = await db.select().from(declarations).where(eq(declarations.id, order.declarationId)).limit(1);
          if (!declaration || declaration.declarationType !== "import" || !declaration.totalDue) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Customs duty liability is unavailable." });
          const entries = await db.select().from(tigerBeetleLedgerEntries).where(and(
            eq(tigerBeetleLedgerEntries.declarationId, order.declarationId),
            eq(tigerBeetleLedgerEntries.entryType, "duty_payment"),
            eq(tigerBeetleLedgerEntries.status, "posted"),
          ));
          const settled = entries.reduce((sum, entry) => sum + BigInt(entry.amountMinorUnits), 0n);
          const due = parseScaled(declaration.totalDue, 2);
          if (settled < due) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Customs duty is not fully settled." });
        }
        if (!(await tbBridgeAvailable())) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Settlement ledger is unavailable." });
        const [updated] = await db.update(exciseStampOrders).set({ status: "fulfilment", fulfilledAt: new Date(), updatedAt: new Date() }).where(eq(exciseStampOrders.id, order.id)).returning();
        await logAuditEvent({ entityType: "user", entityId: ctx.user.id, action: "excise_order_fulfilled", actorId: ctx.user.id, actorType: "licensee", newState: { orderId: order.id, status: updated.status } });
        return updated;
      } catch (error) {
        return unavailable("Excise stamp fulfilment is unavailable.", error);
      }
    }),

  deliverOrder: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await requireDb();
        const [order] = await db.select().from(exciseStampOrders).where(eq(exciseStampOrders.id, input.orderId)).limit(1);
        if (!order) throw new TRPCError({ code: "NOT_FOUND" });
        await requireLicence(order.licenceId, ctx.user.id, ctx.user.role);
        requireTransition(order.status, "delivery");
        const [updated] = await db.update(exciseStampOrders).set({ status: "delivery", deliveredAt: new Date(), updatedAt: new Date() }).where(eq(exciseStampOrders.id, order.id)).returning();
        await logAuditEvent({ entityType: "user", entityId: ctx.user.id, action: "excise_order_delivered", actorId: ctx.user.id, actorType: "licensee", newState: { orderId: order.id, status: updated.status } });
        return updated;
      } catch (error) {
        return unavailable("Excise stamp delivery is unavailable.", error);
      }
    }),

  mintMarks: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive(), machineId: z.number().int().positive().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await requireDb();
        const [order] = await db.select().from(exciseStampOrders).where(eq(exciseStampOrders.id, input.orderId)).limit(1);
        if (!order) throw new TRPCError({ code: "NOT_FOUND" });
        await requireLicence(order.licenceId, ctx.user.id, ctx.user.role);
        if (order.status !== "fulfilment") throw new TRPCError({ code: "BAD_REQUEST", message: "Only fulfilment orders can mint marks." });
        const [existing] = await db.select({ id: exciseStampMarks.id }).from(exciseStampMarks).where(eq(exciseStampMarks.orderId, order.id)).limit(1);
        if (existing) return db.select().from(exciseStampMarks).where(eq(exciseStampMarks.orderId, order.id)).orderBy(asc(exciseStampMarks.id));
        const [product] = await db.select().from(exciseProducts).where(eq(exciseProducts.id, order.productId)).limit(1);
        if (!product) throw new TRPCError({ code: "NOT_FOUND" });
        const [machine] = input.machineId ? await db.select().from(exciseMarkingMachines).where(eq(exciseMarkingMachines.id, input.machineId)).limit(1) : [undefined];
        if (machine) {
          const [facility] = await db.select().from(exciseFacilities).where(eq(exciseFacilities.id, machine.facilityId)).limit(1);
          if (!facility || facility.id !== order.facilityId) throw new TRPCError({ code: "FORBIDDEN" });
        }
        const marks = await db.transaction(async (tx) => {
          const created: typeof exciseStampMarks.$inferSelect[] = [];
          for (let index = 0; index < order.quantity; index += 1) {
            const signed = mintExciseUid();
            const [mark] = await tx.insert(exciseStampMarks).values({
              uid: signed.uid, payload: signed.payload, signature: signed.signature, keyId: signed.keyId,
              orderId: order.id, productId: product.id, facilityId: order.facilityId, machineId: machine?.id,
              status: "issued",
            }).returning();
            created.push(mark);
          }
          return created;
        });
        await logAuditEvent({ entityType: "user", entityId: ctx.user.id, action: "excise_marks_minted", actorId: ctx.user.id, actorType: "licensee", newState: { orderId: order.id, quantity: marks.length } });
        return marks;
      } catch (error) {
        return unavailable("Excise UID minting is unavailable.", error);
      }
    }),

  offlineVerify: publicRateLimitedProcedure
    .input(z.object({ uid: z.string().min(8).max(192) }))
    .query(({ input }) => verifyExciseUid(input.uid)),

  activateMark: protectedProcedure
    .input(z.object({ uid: z.string().min(8).max(192) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await requireDb();
        const [mark] = await db.select().from(exciseStampMarks).where(eq(exciseStampMarks.uid, input.uid)).limit(1);
        if (!mark) throw new TRPCError({ code: "NOT_FOUND" });
        const [order] = await db.select().from(exciseStampOrders).where(eq(exciseStampOrders.id, mark.orderId)).limit(1);
        if (!order) throw new TRPCError({ code: "NOT_FOUND" });
        await requireLicence(order.licenceId, ctx.user.id, ctx.user.role);
        if (mark.status === "active") return mark;
        if (mark.status !== "issued") throw new TRPCError({ code: "BAD_REQUEST", message: "Retired marks cannot be activated." });
        const [activation] = await db.insert(exciseMarkActivations).values({ markId: mark.id, activatedBy: ctx.user.id }).onConflictDoNothing().returning();
        if (!activation) {
          const [current] = await db.select().from(exciseStampMarks).where(eq(exciseStampMarks.id, mark.id)).limit(1);
          return current ?? mark;
        }
        const [updated] = await db.update(exciseStampMarks).set({ status: "active", activatedAt: activation.activatedAt }).where(eq(exciseStampMarks.id, mark.id)).returning();
        await logAuditEvent({ entityType: "user", entityId: ctx.user.id, action: "excise_mark_activated", actorId: ctx.user.id, actorType: "licensee", newState: { markId: mark.id, status: updated.status } });
        return updated;
      } catch (error) {
        return unavailable("Excise mark activation is unavailable.", error);
      }
    }),

  retireMark: protectedProcedure
    .input(z.object({ uid: z.string().min(8).max(192), reason: z.enum(["wastage", "spoilage", "destruction", "seizure", "other"]), details: z.string().min(2).max(1024) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await requireDb();
        const [mark] = await db.select().from(exciseStampMarks).where(eq(exciseStampMarks.uid, input.uid)).limit(1);
        if (!mark) throw new TRPCError({ code: "NOT_FOUND" });
        const [order] = await db.select().from(exciseStampOrders).where(eq(exciseStampOrders.id, mark.orderId)).limit(1);
        if (!order) throw new TRPCError({ code: "NOT_FOUND" });
        await requireLicence(order.licenceId, ctx.user.id, ctx.user.role);
        if (mark.status === "retired") return mark;
        const now = new Date();
        await db.insert(exciseRetirements).values({ markId: mark.id, reason: input.reason, details: input.details, retiredBy: ctx.user.id, retiredAt: now });
        const [updated] = await db.update(exciseStampMarks).set({ status: "retired", retiredAt: now, retirementReason: input.reason, retirementDetails: input.details }).where(eq(exciseStampMarks.id, mark.id)).returning();
        await logAuditEvent({ entityType: "user", entityId: ctx.user.id, action: "excise_mark_retired", actorId: ctx.user.id, actorType: "licensee", newState: { markId: mark.id, status: updated.status, reason: input.reason } });
        return updated;
      } catch (error) {
        return unavailable("Excise mark retirement is unavailable.", error);
      }
    }),

  reportProduction: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive(), quantity: z.number().int().nonnegative() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await requireDb();
        const [order] = await db.select().from(exciseStampOrders).where(eq(exciseStampOrders.id, input.orderId)).limit(1);
        if (!order) throw new TRPCError({ code: "NOT_FOUND" });
        await requireLicence(order.licenceId, ctx.user.id, ctx.user.role);
        const [report] = await db.insert(exciseProductionReports).values({ orderId: order.id, productId: order.productId, facilityId: order.facilityId, quantity: input.quantity, reportedBy: ctx.user.id }).returning();
        return report;
      } catch (error) {
        return unavailable("Excise production reporting is unavailable.", error);
      }
    }),

  reconcileOrder: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        const db = await requireDb();
        const [order] = await db.select().from(exciseStampOrders).where(eq(exciseStampOrders.id, input.orderId)).limit(1);
        if (!order) throw new TRPCError({ code: "NOT_FOUND" });
        await requireLicence(order.licenceId, ctx.user.id, ctx.user.role, false);
        const [issuedRow] = await db.select().from(exciseStampMarks).where(eq(exciseStampMarks.orderId, order.id)).limit(1);
        const marks = await db.select().from(exciseStampMarks).where(eq(exciseStampMarks.orderId, order.id));
        const reports = await db.select().from(exciseProductionReports).where(eq(exciseProductionReports.orderId, order.id));
        const issuedQuantity = issuedRow ? marks.length : 0;
        const activatedQuantity = marks.filter((mark) => mark.status === "active" || mark.activatedAt !== null).length;
        const retiredQuantity = marks.filter((mark) => mark.status === "retired").length;
        const reportedProductionQuantity = reports.reduce((sum, report) => sum + report.quantity, 0);
        const variance = issuedQuantity - activatedQuantity - retiredQuantity - reportedProductionQuantity;
        const [report] = await db.insert(exciseReconciliationReports).values({
          orderId: order.id, issuedQuantity, activatedQuantity, retiredQuantity, reportedProductionQuantity, variance, computedBy: ctx.user.id,
        }).returning();
        return report;
      } catch (error) {
        return unavailable("Excise reconciliation is unavailable.", error);
      }
    }),

  createAggregate: protectedProcedure
    .input(z.object({ aggregateType: z.enum(["carton", "case", "pallet"]) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await requireDb();
        if (!isEnforcement(ctx.user.role) && ctx.user.role !== "user") throw new TRPCError({ code: "FORBIDDEN" });
        const [aggregate] = await db.insert(exciseAggregates).values({
          aggregateUid: `EXA-${randomBytes(18).toString("hex").toUpperCase()}`,
          aggregateType: input.aggregateType,
          createdBy: ctx.user.id,
        }).returning();
        return aggregate;
      } catch (error) {
        return unavailable("Excise aggregation is unavailable.", error);
      }
    }),

  addToAggregate: protectedProcedure
    .input(z.object({ aggregateId: z.number().int().positive(), markId: z.number().int().positive().optional(), childAggregateId: z.number().int().positive().optional() }).refine((input) => Boolean(input.markId) !== Boolean(input.childAggregateId), "Exactly one child is required."))
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await requireDb();
        const [parent] = await db.select().from(exciseAggregates).where(eq(exciseAggregates.id, input.aggregateId)).limit(1);
        if (!parent) throw new TRPCError({ code: "NOT_FOUND" });
        if (!isEnforcement(ctx.user.role) && parent.createdBy !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        if (input.markId) {
          const [mark] = await db.select().from(exciseStampMarks).where(eq(exciseStampMarks.id, input.markId)).limit(1);
          if (!mark) throw new TRPCError({ code: "NOT_FOUND" });
        } else if (input.childAggregateId === parent.id) {
          throw new TRPCError({ code: "BAD_REQUEST" });
        } else {
          const [childAggregate] = await db.select().from(exciseAggregates).where(eq(exciseAggregates.id, input.childAggregateId!)).limit(1);
          if (!childAggregate) throw new TRPCError({ code: "NOT_FOUND" });
          if (AGGREGATE_LEVEL[childAggregate.aggregateType] >= AGGREGATE_LEVEL[parent.aggregateType]) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Aggregate hierarchy cannot skip levels." });
          }
        }
        const [existing] = await db.select().from(exciseAggregateChildren).where(
          input.markId ? eq(exciseAggregateChildren.childMarkId, input.markId) : eq(exciseAggregateChildren.childAggregateId, input.childAggregateId!),
        ).limit(1);
        if (existing && existing.removedAt === null) throw new TRPCError({ code: "CONFLICT", message: "The child already belongs to an aggregate." });
        const [child] = await db.insert(exciseAggregateChildren).values({ aggregateId: parent.id, childMarkId: input.markId, childAggregateId: input.childAggregateId, addedBy: ctx.user.id }).returning();
        if (input.childAggregateId) {
          await db.update(exciseAggregates).set({ parentAggregateId: parent.id }).where(eq(exciseAggregates.id, input.childAggregateId));
        }
        return child;
      } catch (error) {
        return unavailable("Excise aggregation is unavailable.", error);
      }
    }),

  disaggregate: protectedProcedure
    .input(z.object({ childId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await requireDb();
        const [child] = await db.select().from(exciseAggregateChildren).where(and(eq(exciseAggregateChildren.id, input.childId), isNull(exciseAggregateChildren.removedAt))).limit(1);
        if (!child) throw new TRPCError({ code: "NOT_FOUND" });
        const now = new Date();
        await db.update(exciseAggregateChildren).set({ removedAt: now, removedBy: ctx.user.id }).where(eq(exciseAggregateChildren.id, child.id));
        await db.insert(exciseMovementEvents).values({ aggregateId: child.aggregateId, eventType: "disaggregation", actorId: ctx.user.id, metadata: { childId: child.id } });
        if (child.childAggregateId) await db.update(exciseAggregates).set({ parentAggregateId: null }).where(eq(exciseAggregates.id, child.childAggregateId));
        return { ...child, removedAt: now, removedBy: ctx.user.id };
      } catch (error) {
        return unavailable("Excise disaggregation is unavailable.", error);
      }
    }),

  aggregateContents: protectedProcedure
    .input(z.object({ aggregateUid: z.string().min(8).max(192) }))
    .query(async ({ ctx, input }) => {
      if (!isEnforcement(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const db = await requireDb();
        const [aggregate] = await db.select().from(exciseAggregates).where(eq(exciseAggregates.aggregateUid, input.aggregateUid)).limit(1);
        if (!aggregate) throw new TRPCError({ code: "NOT_FOUND" });
        const children = await db.select().from(exciseAggregateChildren).where(and(eq(exciseAggregateChildren.aggregateId, aggregate.id), isNull(exciseAggregateChildren.removedAt)));
        return { aggregate, children };
      } catch (error) {
        return unavailable("Excise aggregate contents are unavailable.", error);
      }
    }),

  markAggregate: protectedProcedure
    .input(z.object({ uid: z.string().min(8).max(192) }))
    .query(async ({ ctx, input }) => {
      if (!isEnforcement(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const db = await requireDb();
        const [mark] = await db.select().from(exciseStampMarks).where(eq(exciseStampMarks.uid, input.uid)).limit(1);
        if (!mark) throw new TRPCError({ code: "NOT_FOUND" });
        const [child] = await db.select().from(exciseAggregateChildren).where(and(eq(exciseAggregateChildren.childMarkId, mark.id), isNull(exciseAggregateChildren.removedAt))).limit(1);
        if (!child) return { aggregate: null };
        const [aggregate] = await db.select().from(exciseAggregates).where(eq(exciseAggregates.id, child.aggregateId)).limit(1);
        return { aggregate: aggregate ?? null };
      } catch (error) {
        return unavailable("Excise mark aggregation is unavailable.", error);
      }
    }),

  recordMovement: protectedProcedure
    .input(z.object({
      markId: z.number().int().positive().optional(),
      aggregateId: z.number().int().positive().optional(),
      eventType: z.enum(["dispatch", "receipt", "export", "re_entry", "seizure", "destruction"]),
      location: z.string().max(255).optional(),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
    }).refine((input) => Boolean(input.markId) !== Boolean(input.aggregateId), "Exactly one movement subject is required."))
    .mutation(async ({ ctx, input }) => {
      try {
        const db = await requireDb();
        if (input.markId) {
          const [mark] = await db.select().from(exciseStampMarks).where(eq(exciseStampMarks.id, input.markId)).limit(1);
          if (!mark) throw new TRPCError({ code: "NOT_FOUND" });
          const [order] = await db.select().from(exciseStampOrders).where(eq(exciseStampOrders.id, mark.orderId)).limit(1);
          if (!order) throw new TRPCError({ code: "NOT_FOUND" });
          await requireLicence(order.licenceId, ctx.user.id, ctx.user.role);
        } else if (!isEnforcement(ctx.user.role)) {
          const [aggregate] = await db.select().from(exciseAggregates).where(eq(exciseAggregates.id, input.aggregateId!)).limit(1);
          if (!aggregate || aggregate.createdBy !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        }
        const [event] = await db.insert(exciseMovementEvents).values({ ...input, actorId: ctx.user.id }).returning();
        return event;
      } catch (error) {
        return unavailable("Excise movement recording is unavailable.", error);
      }
    }),

  enforcementScan: protectedProcedure
    .input(z.object({ uid: z.string().min(8).max(192), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }))
    .query(async ({ ctx, input }) => {
      if (!isEnforcement(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const db = await requireDb();
        const [mark] = await db.select().from(exciseStampMarks).where(eq(exciseStampMarks.uid, input.uid)).limit(1);
        const scan = await recordScan(db, input.uid, mark?.id ?? null, "enforcement", ctx.user.id, input.latitude, input.longitude);
        if (!mark) return { status: "unknown" as const, scan, history: [] };
        if (!isStrongExciseKey(getExciseKey(mark.keyId))) {
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Excise UID verification is unavailable." });
        }
        const [activation] = await db.select().from(exciseMarkActivations).where(eq(exciseMarkActivations.markId, mark.id)).limit(1);
        const movements = await db.select().from(exciseMovementEvents).where(eq(exciseMovementEvents.markId, mark.id)).orderBy(asc(exciseMovementEvents.occurredAt));
        const scans = await db.select().from(exciseScans).where(eq(exciseScans.uid, input.uid)).orderBy(asc(exciseScans.scannedAt));
        const signature = verifyExciseUid(mark.uid);
        return {
          status: signature.status === "invalid_signature" || mark.status === "retired" ? "suspect" as const : "authentic" as const,
          mark, activation: activation ?? null, movements, scans, scan,
        };
      } catch (error) {
        return unavailable("Excise enforcement scan is unavailable.", error);
      }
    }),

  seize: protectedProcedure
    .input(z.object({ uid: z.string().min(8).max(192), location: z.string().max(255).optional(), reason: z.string().min(5).max(1024) }))
    .mutation(async ({ ctx, input }) => {
      if (!isEnforcement(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const db = await requireDb();
        const [mark] = await db.select().from(exciseStampMarks).where(eq(exciseStampMarks.uid, input.uid)).limit(1);
        if (!mark) throw new TRPCError({ code: "NOT_FOUND" });
        const [seizure] = await db.insert(exciseSeizures).values({ markId: mark.id, seizedBy: ctx.user.id, location: input.location, reason: input.reason }).returning();
        await db.insert(exciseMovementEvents).values({ markId: mark.id, eventType: "seizure", actorId: ctx.user.id, location: input.location, metadata: { seizureId: seizure.id } });
        return seizure;
      } catch (error) {
        return unavailable("Excise seizure recording is unavailable.", error);
      }
    }),

  publicVerify: publicRateLimitedProcedure
    .input(z.object({ uid: z.string().min(8).max(192), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }))
    .query(async ({ input }) => {
      if (!isStrongExciseKey(process.env[EXCISE_UID_HMAC_ENV])) return { status: "unavailable" as const };
      const signature = verifyExciseUid(input.uid);
      try {
        const db = await requireDb();
        const [mark] = await db.select().from(exciseStampMarks).where(eq(exciseStampMarks.uid, input.uid)).limit(1);
        if (mark && !isStrongExciseKey(getExciseKey(mark.keyId))) return { status: "unavailable" as const };
        await recordScan(db, input.uid, mark?.id ?? null, "public", null, input.latitude, input.longitude);
        if (!mark) return { status: signature.status === "invalid_signature" ? "suspect" as const : "unknown" as const };
        if (signature.status === "invalid_signature" || mark.status === "retired") return { status: "suspect" as const };
        return { status: "authentic" as const };
      } catch {
        return { status: "unavailable" as const };
      }
    }),

  traverseSource: protectedProcedure
    .input(z.object({ uid: z.string().min(8).max(192) }))
    .query(async ({ ctx, input }) => {
      if (!isEnforcement(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const db = await requireDb();
        const [mark] = await db.select().from(exciseStampMarks).where(eq(exciseStampMarks.uid, input.uid)).limit(1);
        if (!mark) return { available: false as const, reason: "mark_not_found" as const };
        const [order] = await db.select().from(exciseStampOrders).where(eq(exciseStampOrders.id, mark.orderId)).limit(1);
        if (!order) return { available: false as const, reason: "order_missing" as const };
        if (!order.declarationId) return { available: false as const, reason: "declaration_missing" as const };
        const [declaration] = await db.select().from(declarations).where(eq(declarations.id, order.declarationId)).limit(1);
        if (!declaration) return { available: false as const, reason: "declaration_missing" as const };
        if (!declaration.billOfLadingId && !declaration.billOfLadingNumber) return { available: false as const, reason: "bill_of_lading_not_linked" as const };
        const bills = declaration.billOfLadingId
          ? await db.select().from(billsOfLading).where(eq(billsOfLading.id, declaration.billOfLadingId)).limit(1)
          : await db.select().from(billsOfLading).where(eq(billsOfLading.blNumber, declaration.billOfLadingNumber!));
        if (!declaration.billOfLadingId && bills.length > 1) {
          return { available: false as const, reason: "bill_of_lading_ambiguous" as const };
        }
        const [bl] = bills;
        if (!bl) return { available: false as const, reason: "bill_of_lading_not_in_manifest" as const };
        const [manifest] = await db.select().from(manifests).where(eq(manifests.id, bl.manifestId)).limit(1);
        if (!manifest) return { available: false as const, reason: "manifest_missing" as const };
        if (!declaration.principalId && !declaration.traderId) {
          return { available: false as const, reason: "importer_missing" as const };
        }
        if (!declaration.actingAgentId) {
          return { available: false as const, reason: "acting_agent_missing" as const };
        }
        const siblingMarks = await db.select().from(exciseStampMarks).where(eq(exciseStampMarks.orderId, order.id));
        return {
          available: true as const,
          mark,
          order,
          declaration: { id: declaration.id, declarationNumber: declaration.declarationNumber, ucr: declaration.ucr },
          billOfLading: { id: bl.id, blNumber: bl.blNumber },
          manifest: { id: manifest.id, manifestNumber: manifest.manifestNumber, vesselName: manifest.vesselName, mmsi: manifest.mmsi, imo: manifest.imo },
          importerUserId: declaration.principalId ?? declaration.traderId,
          actingAgentUserId: declaration.actingAgentId,
          siblingMarks,
        };
      } catch (error) {
        return unavailable("Excise source traversal is unavailable.", error);
      }
    }),

  analytics: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (!isOfficer(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const db = await requireDb();
        const orders = input?.orderId
          ? await db.select().from(exciseStampOrders).where(eq(exciseStampOrders.id, input.orderId))
          : await db.select().from(exciseStampOrders);
        const orderIds = orders.map((order) => order.id);
        const marks = orderIds.length ? await db.select().from(exciseStampMarks).where(inArray(exciseStampMarks.orderId, orderIds)) : [];
        const reports = orderIds.length ? await db.select().from(exciseProductionReports).where(inArray(exciseProductionReports.orderId, orderIds)) : [];
        const anomalies = marks.length ? await db.select().from(exciseAnomalies).where(inArray(exciseAnomalies.markId, marks.map((mark) => mark.id))) : [];
        const reportedByOrder = new Map<number, number>();
        for (const report of reports) {
          reportedByOrder.set(report.orderId, (reportedByOrder.get(report.orderId) ?? 0) + report.quantity);
        }
        const issuedByOrder = new Map<number, number>();
        const activatedByOrder = new Map<number, number>();
        const retiredByOrder = new Map<number, number>();
        for (const mark of marks) {
          issuedByOrder.set(mark.orderId, (issuedByOrder.get(mark.orderId) ?? 0) + 1);
          if (mark.status === "active") activatedByOrder.set(mark.orderId, (activatedByOrder.get(mark.orderId) ?? 0) + 1);
          if (mark.status === "retired") retiredByOrder.set(mark.orderId, (retiredByOrder.get(mark.orderId) ?? 0) + 1);
        }
        const variance = orders.reduce((sum, order) => sum +
          (issuedByOrder.get(order.id) ?? 0) -
          (activatedByOrder.get(order.id) ?? 0) -
          (retiredByOrder.get(order.id) ?? 0) -
          (reportedByOrder.get(order.id) ?? 0), 0);
        return {
          orders: orders.length,
          issued: marks.length,
          activated: marks.filter((mark) => mark.status === "active").length,
          retired: marks.filter((mark) => mark.status === "retired").length,
          paid: orders.filter((order) => order.paidAt !== null).length,
          reportedProduction: reports.reduce((sum, report) => sum + report.quantity, 0),
          variance,
          anomalies: anomalies.length,
        };
      } catch (error) {
        return unavailable("Excise analytics are unavailable.", error);
      }
    }),
});
