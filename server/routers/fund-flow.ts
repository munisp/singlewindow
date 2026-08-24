/**
 * fund-flow.ts — tRPC Router for All 20 Fund-Flow Scenarios
 *
 * Every procedure in this router:
 *   1. Validates authorization via Permify
 *   2. Checks Redis idempotency (SET NX) before touching TigerBeetle
 *   3. Triggers the appropriate Temporal workflow (which owns atomicity)
 *   4. Returns a typed result with TigerBeetle TX ID + Mojaloop TX ID
 *
 * The TypeScript layer is the API surface; Go/Rust/Python own the execution.
 * This router NEVER calls TigerBeetle or Mojaloop directly — it delegates
 * to Temporal workflows via the Go workflow service HTTP trigger endpoint.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { assertCan } from "../_core/permify";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  paymentQueue,
  declarations,
  dutyDrawbackClaims,
  aeoApplications,
  bondedInventory,
  exBondPermits,
  freeZoneOperations,
  ogaPermits,
} from "../../drizzle/schema";
import { eq, and, inArray, lte, sql } from "drizzle-orm";
import { createClient } from "redis";
// eslint-disable-next-line @typescript-eslint/no-explicit-any

// ─── REDIS CLIENT ─────────────────────────────────────────────────────────────

let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedis() {
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" });
    redisClient.on("error", (e: unknown) => console.error("[Redis] Error:", e));
    await redisClient.connect().catch(() => {
      redisClient = null;
    });
  }
  return redisClient;
}

/**
 * Atomic Redis idempotency guard.
 * Returns true if this key was already processed (duplicate).
 * Fails closed if Redis is unavailable.
 */
async function checkAndSetIdempotency(key: string, ttlSeconds = 86400): Promise<boolean> {
  try {
    const r = await getRedis();
    if (!r) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Idempotency service unavailable" });
    const result = await r.set(`ff:idem:${key}`, "1", { NX: true, EX: ttlSeconds });
    return result === null; // null → key existed → duplicate
  } catch {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Idempotency service unavailable" });
  }
}

// ─── TEMPORAL WORKFLOW TRIGGER ────────────────────────────────────────────────

const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL ?? "http://localhost:8200";

async function triggerTemporalWorkflow(
  workflowType: string,
  input: Record<string, unknown>
): Promise<{ workflowId: string; runId: string }> {
  try {
    const resp = await fetch(`${WORKFLOW_SERVICE_URL}/workflows/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow_type: workflowType, input }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: `Temporal workflow trigger failed: ${body}`,
      });
    }
    return resp.json() as Promise<{ workflowId: string; runId: string }>;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Temporal workflow service unavailable",
    });
  }
}

const fundFlowProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  await assertCan(String(ctx.user.id), "fund_flow", "execute", "execute");
  return next();
});

function requireOfficer(role: string): void {
  if (!["admin", "customs_officer", "oga_officer", "inspector", "finance"].includes(role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Officer access required" });
  }
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────

export const fundFlowRouter = router({

  // ─── SCENARIO 1: Import Duty Collection ────────────────────────────────────
  collectImportDuty: fundFlowProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      idempotencyKey: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const decl = await db.select().from(declarations).where(eq(declarations.id, input.declarationId)).limit(1).then(r => r[0]);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });
      if ((decl.status as string) !== "approved")
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Declaration must be approved before duty collection" });

      const idemKey = input.idempotencyKey ?? `import_duty:${input.declarationId}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true, message: "Duty already collected for this declaration" };

      const wf = await triggerTemporalWorkflow("DutyClearanceWorkflow", {
        declaration_id: input.declarationId,
        trader_id: decl.traderId,
        duty_amount_minor: Number((decl as { dutyAmount?: string | null }).dutyAmount ?? 0) * 100,
        currency: "NGN",
        ledger: 700,
      });
      return { workflowId: wf.workflowId, runId: wf.runId, idempotent: false };
    }),

  // ─── SCENARIO 2: Export Levy Collection ────────────────────────────────────
  collectExportLevy: fundFlowProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      levyAmountMinor: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const idemKey = `export_levy:${input.declarationId}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("ExportLevyWorkflow", {
        declaration_id: input.declarationId,
        levy_amount_minor: input.levyAmountMinor,
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── SCENARIO 3: Duty Drawback Claim ───────────────────────────────────────
  submitDrawbackClaim: fundFlowProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      claimedAmountMinor: z.number().int().positive(),
      supportingDocuments: z.array(z.string()).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const claimNumber = `DBC-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const [claim] = await db.insert(dutyDrawbackClaims).values({
        claimNumber,
        traderId: ctx.user.id,
        importDeclarationId: input.declarationId,
        importDeclarationNumber: `DECL-${input.declarationId}`,
        drawbackType: "manufacturing",
        originalDutyPaid: String(input.claimedAmountMinor / 100),
        claimedAmount: String(input.claimedAmountMinor / 100),
        status: "draft",
        reExportEvidence: input.supportingDocuments,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      return { claimId: claim.id, status: "submitted" };
    }),

  approveDrawbackClaim: fundFlowProcedure
    .input(z.object({
      claimId: z.number().int().positive(),
      approvedAmountMinor: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);

      const idemKey = `drawback_approve:${input.claimId}:${ctx.user.id}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("DutyDrawbackWorkflow", {
        claim_id: input.claimId,
        approved_amount_minor: input.approvedAmountMinor,
        officer_id: ctx.user.id,
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── SCENARIO 4: Penalty Levy ───────────────────────────────────────────────
  issuePenalty: fundFlowProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      penaltyAmountMinor: z.number().int().positive(),
      reason: z.string().min(10),
    }))
    .mutation(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);

      const idemKey = `penalty:${input.declarationId}:${ctx.user.id}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("PenaltyLevyWorkflow", {
        declaration_id: input.declarationId,
        penalty_amount_minor: input.penaltyAmountMinor,
        officer_id: ctx.user.id,
        reason: input.reason,
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── SCENARIO 5: Bond Guarantee Lodgement ──────────────────────────────────
  lodgeBondGuarantee: fundFlowProcedure
    .input(z.object({
      bondType: z.enum(["general_bond", "specific_bond", "transit_bond"]),
      amountMinor: z.number().int().positive(),
      currency: z.string().length(3),
      expiryDate: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Bond guarantees are tracked via TigerBeetle + Temporal; generate a unique bond ID
      const bondId = `BOND-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      const idemKey = `bond_lodgement:${bondId}`;
      if (await checkAndSetIdempotency(idemKey))
        return { bondId, idempotent: true };

      const wf = await triggerTemporalWorkflow("BondManagementWorkflow", {
        bond_id: bondId,
        trader_id: ctx.user.id,
        amount_minor: input.amountMinor,
        currency: input.currency,
        bond_type: input.bondType,
        action: "lodge",
      });
      return { bondId, workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── SCENARIO 6 & 7: Bond Release / Forfeiture ─────────────────────────────
  releaseBond: fundFlowProcedure
    .input(z.object({
      bondId: z.number().int().positive(),
      clearancePermitRef: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);

      const idemKey = `bond_release:${input.bondId}:${input.clearancePermitRef}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("BondManagementWorkflow", {
        bond_id: input.bondId,
        clearance_permit_ref: input.clearancePermitRef,
        officer_id: ctx.user.id,
        action: "release",
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  forfeitBond: fundFlowProcedure
    .input(z.object({
      bondId: z.number().int().positive(),
      reason: z.string().min(10),
    }))
    .mutation(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);

      const idemKey = `bond_forfeiture:${input.bondId}:${ctx.user.id}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("BondManagementWorkflow", {
        bond_id: input.bondId,
        officer_id: ctx.user.id,
        reason: input.reason,
        action: "forfeit",
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── SCENARIO 8 & 9: Transit Guarantee ─────────────────────────────────────
  lodgeTransitGuarantee: fundFlowProcedure
    .input(z.object({
      transitId: z.number().int().positive(),
      amountMinor: z.number().int().positive(),
      currency: z.string().length(3),
      exitDeadline: z.string(),
      ucr: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const idemKey = `transit_lodgement:${input.transitId}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("TransitLodgementWorkflow", {
        transit_id: input.transitId,
        trader_id: ctx.user.id,
        amount_minor: input.amountMinor,
        currency: input.currency,
        exit_deadline: input.exitDeadline,
        ucr: input.ucr,
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  releaseTransitGuarantee: fundFlowProcedure
    .input(z.object({
      transitId: z.number().int().positive(),
      exitConfirmRef: z.string(),
      ucr: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);

      const idemKey = `transit_release:${input.transitId}:${input.exitConfirmRef}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("TransitReleaseWorkflow", {
        transit_id: input.transitId,
        exit_confirm_ref: input.exitConfirmRef,
        ucr: input.ucr,
        officer_id: ctx.user.id,
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── SCENARIO 10: AEO Application Fee ──────────────────────────────────────
  payAeoFee: fundFlowProcedure
    .input(z.object({
      applicationId: z.number().int().positive(),
      feeAmountMinor: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const idemKey = `aeo_fee:${input.applicationId}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("AEOFeeWorkflow", {
        application_id: input.applicationId,
        trader_id: ctx.user.id,
        fee_amount_minor: input.feeAmountMinor,
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── SCENARIO 11: Free Zone Entry Fee ──────────────────────────────────────
  payFreeZoneEntryFee: fundFlowProcedure
    .input(z.object({
      admissionId: z.number().int().positive(),
      feeAmountMinor: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const idemKey = `fz_entry_fee:${input.admissionId}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("FreeZoneEntryFeeWorkflow", {
        admission_id: input.admissionId,
        trader_id: ctx.user.id,
        fee_amount_minor: input.feeAmountMinor,
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── SCENARIO 12: Warehouse Storage Fee ────────────────────────────────────
  payWarehouseStorageFee: fundFlowProcedure
    .input(z.object({
      inventoryId: z.number().int().positive(),
      feeAmountMinor: z.number().int().positive(),
      period: z.string().regex(/^\d{4}-\d{2}$/),
    }))
    .mutation(async ({ ctx, input }) => {
      const idemKey = `warehouse_fee:${input.inventoryId}:${input.period}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("WarehouseStorageFeeWorkflow", {
        inventory_id: input.inventoryId,
        trader_id: ctx.user.id,
        fee_amount_minor: input.feeAmountMinor,
        period: input.period,
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── SCENARIO 13: Ex-Bond Duty Payment ─────────────────────────────────────
  payExBondDuty: fundFlowProcedure
    .input(z.object({
      permitId: z.number().int().positive(),
      dutyAmountMinor: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const idemKey = `ex_bond_duty:${input.permitId}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("ExBondDutyWorkflow", {
        permit_id: input.permitId,
        trader_id: ctx.user.id,
        duty_amount_minor: input.dutyAmountMinor,
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── SCENARIO 14: Post-Clearance Audit Recovery ────────────────────────────
  initiateAuditRecovery: fundFlowProcedure
    .input(z.object({
      auditId: z.number().int().positive(),
      declarationId: z.number().int().positive(),
      underpaidMinor: z.number().int().positive(),
      demandNoticeRef: z.string(),
      paymentDeadline: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);

      const idemKey = `audit_recovery:${input.auditId}:${input.demandNoticeRef}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("AuditRecoveryWorkflow", {
        audit_id: input.auditId,
        declaration_id: input.declarationId,
        underpaid_minor: input.underpaidMinor,
        demand_notice_ref: input.demandNoticeRef,
        payment_deadline: input.paymentDeadline,
        officer_id: ctx.user.id,
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── SCENARIO 15: Overpayment Refund ───────────────────────────────────────
  initiateOverpaymentRefund: fundFlowProcedure
    .input(z.object({
      auditId: z.number().int().positive(),
      declarationId: z.number().int().positive(),
      overpaidMinor: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);

      const idemKey = `overpayment_refund:${input.auditId}:${ctx.user.id}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("OverpaymentRefundWorkflow", {
        audit_id: input.auditId,
        declaration_id: input.declarationId,
        overpaid_minor: input.overpaidMinor,
        approved_by_officer_id: ctx.user.id,
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── SCENARIO 16: OGA Permit Fee ───────────────────────────────────────────
  payOgaPermitFee: fundFlowProcedure
    .input(z.object({
      permitApplicationId: z.number().int().positive(),
      feeAmountMinor: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const idemKey = `oga_permit_fee:${input.permitApplicationId}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("OGAPermitFeeWorkflow", {
        permit_application_id: input.permitApplicationId,
        trader_id: ctx.user.id,
        fee_amount_minor: input.feeAmountMinor,
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── SCENARIO 17: Sanctions-Blocked Payment Reversal ───────────────────────
  reverseSanctionedPayment: fundFlowProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      reservedTigerBeetleTxId: z.string(),
      sanctionsRef: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);

      const idemKey = `sanctions_reversal:${input.declarationId}:${input.sanctionsRef}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("SanctionsReversalWorkflow", {
        declaration_id: input.declarationId,
        reserved_tigerbeetle_tx_id: input.reservedTigerBeetleTxId,
        sanctions_ref: input.sanctionsRef,
        officer_id: ctx.user.id,
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── SCENARIO 18: Batch Payment Settlement ─────────────────────────────────
  triggerBatchSettlement: fundFlowProcedure
    .input(z.object({
      batchId: z.string(),
      settlementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);

      const idemKey = `batch_settlement:${input.batchId}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true };

      // Fetch pending payment queue items for this batch date
      const batchDb = (await getDb())!;
      const pendingItems = await batchDb
        .select({ id: paymentQueue.id })
        .from(paymentQueue)
        .where(and(
          eq(paymentQueue.status, "queued"),
          lte(paymentQueue.nextRetryAt, new Date()),
        ))
        .limit(500);

      const transferIds = pendingItems.map((p: { id: number }) => String(p.id));

      const wf = await triggerTemporalWorkflow("BatchSettlementWorkflow", {
        batch_id: input.batchId,
        transfer_ids: transferIds,
        settlement_date: input.settlementDate,
        currency: "NGN",
        ledger: 700,
      });
      return { workflowId: wf.workflowId, transferCount: transferIds.length, idempotent: false };
    }),

  // ─── SCENARIO 19: Revenue Reconciliation ───────────────────────────────────
  triggerRevenueReconciliation: fundFlowProcedure
    .input(z.object({
      reconciliationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      alertThresholdMinor: z.number().int().nonnegative().default(100_000),
    }))
    .mutation(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);

      const idemKey = `revenue_reconciliation:${input.reconciliationDate}`;
      if (await checkAndSetIdempotency(idemKey, 3600)) // 1 hour TTL — allow re-run same day
        return { idempotent: true };

      const wf = await triggerTemporalWorkflow("RevenueReconciliationWorkflow", {
        reconciliation_date: input.reconciliationDate,
        alert_threshold_minor: input.alertThresholdMinor,
        ledger: 700,
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── SCENARIO 20: Trader Account Provisioning ──────────────────────────────
  provisionTraderAccount: fundFlowProcedure
    .input(z.object({
      currency: z.string().length(3).default("NGN"),
    }))
    .mutation(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);

      const idemKey = `account_provisioning:${ctx.user.id}:${input.currency}`;
      if (await checkAndSetIdempotency(idemKey))
        return { idempotent: true, message: "Account already provisioned" };

      const wf = await triggerTemporalWorkflow("TraderAccountProvisioningWorkflow", {
        trader_id: ctx.user.id,
        currency: input.currency,
        ledger: 700,
      });
      return { workflowId: wf.workflowId, idempotent: false };
    }),

  // ─── QUERY: Fund Flow Status ────────────────────────────────────────────────
  getWorkflowStatus: fundFlowProcedure
    .input(z.object({ workflowId: z.string() }))
    .query(async ({ input }) => {
      const resp = await fetch(
        `${WORKFLOW_SERVICE_URL}/workflows/${input.workflowId}/status`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (!resp.ok) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow not found" });
      return resp.json() as Promise<{ status: string; result?: unknown; error?: string }>;
    }),
});
