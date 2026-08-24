import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, logAuditEvent } from "../db";
import {
  declarations,
  declarationFormalities,
  ogaPermits,
  regulatoryFormalities,
  regulatoryRestrictions,
  tariffQuotaAllocations,
  tariffQuotas,
} from "../../drizzle/schema";
import { tbBridgeAvailable, tbFetch } from "./ledger";
import { acquireLock, releaseLock } from "../_core/distributedLock";
import { requireDeclarationActor } from "../_core/mandateAuthorization";

type RegulatoryDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type RegulatoryDateInput = Date | string;

const AUTHORING_ROLES = new Set(["admin", "customs_officer", "oga_officer"]);

function requireAuthoringRole(role: string): void {
  if (!AUTHORING_ROLES.has(role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only authorised officers may author regulatory registers." });
  }
}

function asDate(value: RegulatoryDateInput | undefined, fallback = new Date()): Date {
  return value ? new Date(value) : fallback;
}

function activeAt(validFrom: Date, validUntil: Date | null, at: Date): boolean {
  return validFrom <= at && (validUntil === null || validUntil >= at);
}

function matchesOptional(value: string | null, expected: string | undefined): boolean {
  return value === null || value === expected;
}

function matchesPrefix(value: string | null, prefix: string): boolean {
  return value !== null && value.startsWith(prefix);
}

async function requireRegulatoryDb(): Promise<RegulatoryDb> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Regulatory registers are unavailable.",
    });
  }
  return db;
}

async function matchingRegisters(
  db: RegulatoryDb,
  input: {
    hsCode: string;
    origin: string;
    destination?: string;
    regime: string;
    at: Date;
  },
) {
  const formalities = await db.select().from(regulatoryFormalities)
    .where(and(
      sql`${input.hsCode} LIKE ${regulatoryFormalities.hsCodePrefix} || '%'`,
      or(isNull(regulatoryFormalities.origin), eq(regulatoryFormalities.origin, input.origin)),
      or(isNull(regulatoryFormalities.destination), eq(regulatoryFormalities.destination, input.destination ?? "")),
      or(isNull(regulatoryFormalities.regime), eq(regulatoryFormalities.regime, input.regime)),
      lte(regulatoryFormalities.validFrom, input.at),
      or(isNull(regulatoryFormalities.validUntil), gte(regulatoryFormalities.validUntil, input.at)),
    ))
    .orderBy(asc(regulatoryFormalities.id));
  const restrictions = await db.select().from(regulatoryRestrictions)
    .where(and(
      sql`${input.hsCode} LIKE ${regulatoryRestrictions.hsCodePrefix} || '%'`,
      or(isNull(regulatoryRestrictions.origin), eq(regulatoryRestrictions.origin, input.origin)),
      or(isNull(regulatoryRestrictions.regime), eq(regulatoryRestrictions.regime, input.regime)),
      lte(regulatoryRestrictions.validFrom, input.at),
      or(isNull(regulatoryRestrictions.validUntil), gte(regulatoryRestrictions.validUntil, input.at)),
    ))
    .orderBy(asc(regulatoryRestrictions.id));
  const quotas = await db.select().from(tariffQuotas)
    .where(and(
      sql`${input.hsCode} LIKE ${tariffQuotas.hsCodePrefix} || '%'`,
      or(isNull(tariffQuotas.origin), eq(tariffQuotas.origin, input.origin)),
      or(isNull(tariffQuotas.regime), eq(tariffQuotas.regime, input.regime)),
      lte(tariffQuotas.periodStart, input.at),
      gte(tariffQuotas.periodEnd, input.at),
      lte(tariffQuotas.validFrom, input.at),
      or(isNull(tariffQuotas.validUntil), gte(tariffQuotas.validUntil, input.at)),
    ))
    .orderBy(asc(tariffQuotas.id));
  return { formalities, restrictions, quotas };
}

type ObligationInput = {
  declarationId?: number;
  importerId: number;
  hsCode: string;
  origin: string;
  destination?: string;
  regime: string;
  quantity: string;
  at: Date;
};

async function permitSatisfies(
  db: Pick<RegulatoryDb, "select" | "update">,
  input: ObligationInput,
  obligation: {
    agencyCode: string | null;
    permitType: string | null;
    requiredQuantity: string;
  },
  consume: boolean,
) {
  if (!input.declarationId || !obligation.agencyCode || !obligation.permitType) return null;
  const permits = await db.select().from(ogaPermits)
    .where(and(
      eq(ogaPermits.declarationId, input.declarationId),
      eq(ogaPermits.agencyCode, obligation.agencyCode),
      eq(ogaPermits.permitType, obligation.permitType),
      eq(ogaPermits.status, "approved"),
      eq(ogaPermits.consigneeId, input.importerId),
      lte(ogaPermits.validFrom, input.at),
      or(isNull(ogaPermits.expiresAt), gte(ogaPermits.expiresAt, input.at)),
    ))
    .orderBy(desc(ogaPermits.id));
  for (const permit of permits) {
    if (!permit.hsCode || !matchesPrefix(input.hsCode, permit.hsCode)) continue;
    if (!matchesOptional(permit.origin, input.origin)) continue;
    if (!matchesOptional(permit.destination, input.destination)) continue;
    if (!permit.permittedQuantity) continue;
    const remaining = Number(permit.permittedQuantity) - Number(permit.usedQuantity);
    if (remaining < Number(obligation.requiredQuantity)) continue;
    if (consume) {
      const [updated] = await db.update(ogaPermits).set({
        usedQuantity: sql`${ogaPermits.usedQuantity} + ${obligation.requiredQuantity}`,
        updatedAt: new Date(),
      }).where(and(
        eq(ogaPermits.id, permit.id),
        sql`${ogaPermits.usedQuantity} + ${obligation.requiredQuantity} <= ${ogaPermits.permittedQuantity}`,
      )).returning();
      if (!updated) continue;
    }
    return permit;
  }
  return null;
}

type MatchingRegisters = Awaited<ReturnType<typeof matchingRegisters>>;
type RegisterObligation = {
  formalityId: number | null;
  restrictionId: number | null;
  agencyCode: string | null;
  agencyName: string | null;
  permitType: string | null;
  legalInstrument: string;
  requiredQuantity: string;
};

function registerObligations(registers: MatchingRegisters): RegisterObligation[] {
  const requiredRestrictions = registers.restrictions.filter((entry) => entry.restrictionType === "restriction");
  return [
    ...registers.formalities.map((entry) => ({
      formalityId: entry.id,
      restrictionId: null,
      agencyCode: entry.agencyCode,
      agencyName: entry.agencyName,
      permitType: entry.permitType,
      legalInstrument: entry.legalInstrument,
      requiredQuantity: entry.requiredQuantity,
    })),
    ...requiredRestrictions.map((entry) => ({
      formalityId: null,
      restrictionId: entry.id,
      agencyCode: entry.agencyCode,
      agencyName: entry.agencyName,
      permitType: entry.permitType,
      legalInstrument: entry.legalInstrument,
      requiredQuantity: entry.requiredQuantity,
    })),
  ];
}

async function evaluateObligations(
  db: Pick<RegulatoryDb, "select" | "update">,
  input: ObligationInput,
  registers: MatchingRegisters,
  consumePermits: boolean,
) {
  const obligations = registerObligations(registers);
  const evaluated = [];
  for (const obligation of obligations) {
    const permit = await permitSatisfies(db, input, obligation, consumePermits);
    evaluated.push({ ...obligation, permit });
  }
  return { obligations: evaluated };
}

async function buildObligations(db: RegulatoryDb, input: ObligationInput) {
  const registers = await matchingRegisters(db, input);
  const evaluated = await evaluateObligations(db, input, registers, false);
  return { ...evaluated, ...registers };
}

export async function evaluateDeclarationRegulations(input: ObligationInput): Promise<void> {
  const db = await requireRegulatoryDb();
  const registers = await matchingRegisters(db, input);
  const prohibition = registers.restrictions.find((entry) => entry.restrictionType === "prohibition");
  if (prohibition) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Declaration refused under ${prohibition.legalInstrument}: ${prohibition.description}`,
    });
  }
  if (!input.declarationId || registerObligations(registers).length === 0) return;
  await db.transaction(async (tx) => {
    const result = await evaluateObligations(tx, input, registers, true);
    await tx.insert(declarationFormalities).values(result.obligations.map((obligation) => ({
      declarationId: input.declarationId!,
      formalityId: obligation.formalityId,
      restrictionId: obligation.restrictionId,
      agencyCode: obligation.agencyCode,
      agencyName: obligation.agencyName,
      permitType: obligation.permitType,
      legalInstrument: obligation.legalInstrument,
      requiredQuantity: obligation.requiredQuantity,
      satisfiedQuantity: obligation.permit ? obligation.requiredQuantity : "0",
      satisfiedByPermitId: obligation.permit?.id ?? null,
      status: obligation.permit ? "satisfied" as const : "required" as const,
      evaluatedAt: input.at,
    })));
  });
}

export async function assertDeclarationFormalitiesSatisfied(declarationId: number): Promise<void> {
  const db = await requireRegulatoryDb();
  const [declaration] = await db.select().from(declarations).where(eq(declarations.id, declarationId)).limit(1);
  if (!declaration) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found." });
  }
  const input: ObligationInput = {
    declarationId,
    importerId: declaration.principalId ?? declaration.traderId,
    hsCode: declaration.hsCode ?? "",
    origin: declaration.countryOfOrigin ?? "",
    destination: declaration.countryOfDestination ?? undefined,
    regime: declaration.declarationType,
    quantity: String(declaration.numberOfPackages ?? 1),
    at: declaration.submittedAt ?? declaration.createdAt,
  };
  const registers = await matchingRegisters(db, input);
  const prohibition = registers.restrictions.find((entry) => entry.restrictionType === "prohibition");
  if (prohibition) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Declaration refused under ${prohibition.legalInstrument}: ${prohibition.description}`,
    });
  }
  const rows = await db.select().from(declarationFormalities)
    .where(eq(declarationFormalities.declarationId, declarationId));
  const obligations = registerObligations(registers);
  for (const obligation of obligations) {
    const persisted = rows.find((row) =>
      (obligation.formalityId !== null && row.formalityId === obligation.formalityId) ||
      (obligation.restrictionId !== null && row.restrictionId === obligation.restrictionId),
    );
    const satisfied = persisted?.status === "satisfied" ||
      (await permitSatisfies(db, input, obligation, false)) !== null;
    if (!satisfied) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Required regulatory formality is unsatisfied under ${obligation.legalInstrument}.`,
      });
    }
  }
}

async function clearanceGraph(input: ObligationInput) {
  const db = await requireRegulatoryDb();
  const result = await buildObligations(db, input);
  const graph = result.obligations.map((obligation) => ({
    required: true as const,
    satisfied: obligation.permit !== null,
    blocking: obligation.permit === null,
    agencyCode: obligation.agencyCode,
    agencyName: obligation.agencyName,
    permitType: obligation.permitType,
    legalInstrument: obligation.legalInstrument,
    requiredQuantity: obligation.requiredQuantity,
    satisfiedByPermitId: obligation.permit?.id ?? null,
  }));
  const quotaGraph = [];
  for (const quota of result.quotas) {
    const allocations = input.declarationId
      ? await db.select({ quantity: tariffQuotaAllocations.quantity })
        .from(tariffQuotaAllocations)
        .where(and(
          eq(tariffQuotaAllocations.quotaId, quota.id),
          eq(tariffQuotaAllocations.declarationId, input.declarationId),
          isNull(tariffQuotaAllocations.reversedAt),
        ))
      : [];
    const allocated = allocations.reduce((sum, row) => sum + Number(row.quantity), 0);
    const required = Number(input.quantity);
    quotaGraph.push({
      required: true as const,
      satisfied: allocated >= required,
      blocking: allocated < required,
      quotaCode: quota.quotaCode,
      legalInstrument: quota.legalInstrument,
      requiredQuantity: input.quantity,
      allocatedQuantity: String(allocated),
    });
  }
  return {
    registersAvailable: true as const,
    prohibited: result.restrictions
      .filter((entry) => entry.restrictionType === "prohibition")
      .map((entry) => ({
        description: entry.description,
        legalInstrument: entry.legalInstrument,
      })),
    obligations: [...graph, ...quotaGraph],
    blocking: result.restrictions.some((entry) => entry.restrictionType === "prohibition") ||
      graph.some((entry) => entry.blocking) || quotaGraph.some((entry) => entry.blocking),
  };
}

export const regulatoryRouter = router({
  listFormalities: protectedProcedure
    .input(z.object({ asAt: z.coerce.date().optional() }).optional())
    .query(async ({ input }) => {
      const db = await requireRegulatoryDb();
      const at = input?.asAt;
      return db.select().from(regulatoryFormalities)
        .where(at ? and(lte(regulatoryFormalities.validFrom, at), or(isNull(regulatoryFormalities.validUntil), gte(regulatoryFormalities.validUntil, at))) : undefined)
        .orderBy(asc(regulatoryFormalities.hsCodePrefix));
    }),

  listRestrictions: protectedProcedure
    .input(z.object({ asAt: z.coerce.date().optional() }).optional())
    .query(async ({ input }) => {
      const db = await requireRegulatoryDb();
      const at = input?.asAt;
      return db.select().from(regulatoryRestrictions)
        .where(at ? and(lte(regulatoryRestrictions.validFrom, at), or(isNull(regulatoryRestrictions.validUntil), gte(regulatoryRestrictions.validUntil, at))) : undefined)
        .orderBy(asc(regulatoryRestrictions.hsCodePrefix));
    }),

  listQuotas: protectedProcedure
    .input(z.object({ asAt: z.coerce.date().optional() }).optional())
    .query(async ({ input }) => {
      const db = await requireRegulatoryDb();
      const at = input?.asAt;
      return db.select().from(tariffQuotas)
        .where(at ? and(lte(tariffQuotas.validFrom, at), or(isNull(tariffQuotas.validUntil), gte(tariffQuotas.validUntil, at))) : undefined)
        .orderBy(asc(tariffQuotas.quotaCode));
    }),

  createFormality: protectedProcedure
    .input(z.object({
      hsCodePrefix: z.string().min(2).max(12),
      origin: z.string().max(3).optional(),
      destination: z.string().max(3).optional(),
      regime: z.string().max(32).optional(),
      agencyCode: z.string().min(1).max(32),
      agencyName: z.string().min(1).max(128),
      permitType: z.string().min(1).max(128),
      requiredQuantity: z.string().regex(/^\d+(\.\d{1,3})?$/).default("1"),
      quantityUnit: z.string().max(32).optional(),
      legalInstrument: z.string().min(1),
      validFrom: z.coerce.date(),
      validUntil: z.coerce.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAuthoringRole(ctx.user.role);
      const db = await requireRegulatoryDb();
      const [entry] = await db.insert(regulatoryFormalities).values({ ...input, createdBy: ctx.user.id }).returning();
      await logAuditEvent({ entityType: "declaration", entityId: entry.id, action: "regulatory_formality_created", actorId: ctx.user.id, actorType: ctx.user.role, newState: entry });
      return entry;
    }),

  createRestriction: protectedProcedure
    .input(z.object({
      hsCodePrefix: z.string().min(2).max(12),
      origin: z.string().max(3).optional(),
      regime: z.string().max(32).optional(),
      restrictionType: z.enum(["prohibition", "restriction"]),
      description: z.string().min(1),
      legalInstrument: z.string().min(1),
      agencyCode: z.string().max(32).optional(),
      agencyName: z.string().max(128).optional(),
      permitType: z.string().max(128).optional(),
      requiredQuantity: z.string().regex(/^\d+(\.\d{1,3})?$/).default("1"),
      quantityUnit: z.string().max(32).optional(),
      validFrom: z.coerce.date(),
      validUntil: z.coerce.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAuthoringRole(ctx.user.role);
      const db = await requireRegulatoryDb();
      const [entry] = await db.insert(regulatoryRestrictions).values({ ...input, createdBy: ctx.user.id }).returning();
      await logAuditEvent({ entityType: "declaration", entityId: entry.id, action: "regulatory_restriction_created", actorId: ctx.user.id, actorType: ctx.user.role, newState: entry });
      return entry;
    }),

  createQuota: protectedProcedure
    .input(z.object({
      quotaCode: z.string().min(1).max(64),
      hsCodePrefix: z.string().min(2).max(12),
      origin: z.string().max(3).optional(),
      regime: z.string().max(32).optional(),
      periodStart: z.coerce.date(),
      periodEnd: z.coerce.date(),
      totalQuantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
      quantityUnit: z.string().min(1).max(32),
      ledgerAccountId: z.string().min(1).max(128),
      legalInstrument: z.string().min(1),
      validFrom: z.coerce.date(),
      validUntil: z.coerce.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAuthoringRole(ctx.user.role);
      const db = await requireRegulatoryDb();
      const [entry] = await db.insert(tariffQuotas).values({ ...input, createdBy: ctx.user.id }).returning();
      await logAuditEvent({ entityType: "declaration", entityId: entry.id, action: "tariff_quota_created", actorId: ctx.user.id, actorType: ctx.user.role, newState: entry });
      return entry;
    }),

  clearanceGraph: protectedProcedure
    .input(z.object({
      hsCode: z.string().min(1).max(12),
      origin: z.string().min(1).max(3),
      destination: z.string().max(3).optional(),
      regime: z.string().min(1).max(32),
      quantity: z.string().regex(/^\d+(\.\d{1,3})?$/).default("1"),
      asAt: z.coerce.date().optional(),
      declarationId: z.number().int().positive().optional(),
    }))
    .query(async ({ ctx, input }) => clearanceGraph({
      hsCode: input.hsCode,
      origin: input.origin,
      destination: input.destination,
      regime: input.regime,
      quantity: input.quantity,
      importerId: ctx.user.id,
      declarationId: input.declarationId,
      at: asDate(input.asAt),
    })),

  allocateQuota: protectedProcedure
    .input(z.object({ quotaId: z.number().int().positive(), declarationId: z.number().int().positive(), quantity: z.string().regex(/^\d+(\.\d{1,3})?$/) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireRegulatoryDb();
      const [quota] = await db.select().from(tariffQuotas).where(eq(tariffQuotas.id, input.quotaId)).limit(1);
      if (!quota) throw new TRPCError({ code: "NOT_FOUND", message: "Tariff quota not found." });
      const [declaration] = await db.select().from(declarations).where(eq(declarations.id, input.declarationId)).limit(1);
      if (!declaration) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found." });
      if (ctx.user.role !== "admin" && ctx.user.role !== "customs_officer") {
        await requireDeclarationActor(declaration, ctx.user);
      }
      const at = declaration.submittedAt ?? declaration.createdAt;
      if (!activeAt(quota.validFrom, quota.validUntil, at) || at < quota.periodStart || at > quota.periodEnd) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Tariff quota is not active for this declaration date." });
      }
      if (!declaration.hsCode?.startsWith(quota.hsCodePrefix) ||
        (quota.origin !== null && quota.origin !== declaration.countryOfOrigin) ||
        (quota.regime !== null && quota.regime !== declaration.declarationType)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Tariff quota does not apply to this declaration." });
      }
      const lock = await acquireLock(`regulatory:quota:${quota.id}`, 30_000);
      if (lock.token === "no-redis") {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Quota coordination is unavailable." });
      }
      try {
        const [existing] = await db.select().from(tariffQuotaAllocations).where(and(
          eq(tariffQuotaAllocations.quotaId, quota.id),
          eq(tariffQuotaAllocations.declarationId, input.declarationId),
          isNull(tariffQuotaAllocations.reversedAt),
        )).limit(1);
        if (existing) return existing;
        if (!(await tbBridgeAvailable())) {
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Ledger is unavailable; quota was not allocated." });
        }
        const [drawn] = await db.select({
          quantity: sql<string>`coalesce(sum(${tariffQuotaAllocations.quantity}) filter (where ${tariffQuotaAllocations.reversedAt} is null), 0)`,
        }).from(tariffQuotaAllocations).where(eq(tariffQuotaAllocations.quotaId, quota.id));
        if (Number(drawn?.quantity ?? 0) + Number(input.quantity) > Number(quota.totalQuantity)) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Tariff quota is exhausted." });
        }
        const transfer = await tbFetch<{ id: string }>("/api/ledger/transfers", {
          method: "POST",
          body: JSON.stringify({
            debitAccountId: quota.ledgerAccountId,
            creditAccountId: `quota-allocation:${quota.id}:${input.declarationId}`,
            amount: input.quantity,
            currency: "QTY",
            reference: quota.quotaCode,
            description: `Tariff quota allocation for declaration ${input.declarationId}`,
            idempotencyKey: `regulatory:quota:${quota.id}:${input.declarationId}`,
          }),
        });
        const [allocation] = await db.insert(tariffQuotaAllocations).values({
          quotaId: quota.id,
          declarationId: input.declarationId,
          quantity: input.quantity,
          transferId: transfer.id,
          allocatedBy: ctx.user.id,
        }).returning();
        return allocation;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Quota allocation could not be committed." });
      } finally {
        await releaseLock(lock);
      }
    }),

  reverseQuotaAllocation: protectedProcedure
    .input(z.object({ allocationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      requireAuthoringRole(ctx.user.role);
      const db = await requireRegulatoryDb();
      const [allocation] = await db.select().from(tariffQuotaAllocations).where(eq(tariffQuotaAllocations.id, input.allocationId)).limit(1);
      if (!allocation) throw new TRPCError({ code: "NOT_FOUND" });
      if (allocation.reversedAt) return allocation;
      if (!(await tbBridgeAvailable())) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Ledger is unavailable; quota was not restored." });
      const [quota] = await db.select().from(tariffQuotas).where(eq(tariffQuotas.id, allocation.quotaId)).limit(1);
      if (!quota) throw new TRPCError({ code: "NOT_FOUND" });
      const transfer = await tbFetch<{ id: string }>("/api/ledger/transfers", {
        method: "POST",
        body: JSON.stringify({
          debitAccountId: `quota-allocation:${allocation.quotaId}:${allocation.declarationId}`,
          creditAccountId: quota.ledgerAccountId,
          amount: allocation.quantity,
          currency: "QTY",
          reference: `reversal:${allocation.id}`,
          description: `Restore tariff quota allocation ${allocation.id}`,
          idempotencyKey: `regulatory:quota-reversal:${allocation.id}`,
        }),
      });
      const [updated] = await db.update(tariffQuotaAllocations).set({ reversedAt: new Date(), reversalTransferId: transfer.id }).where(eq(tariffQuotaAllocations.id, allocation.id)).returning();
      return updated;
    }),
});
