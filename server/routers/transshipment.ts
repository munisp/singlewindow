/**
 * transshipment.ts — transshipment declaration lane (Phase 16 Wave P1;
 * migration 0069).
 *
 *   - create      — files a declaration of declaration_type 'transshipment'
 *                   coupled to ONE inbound and ONE outbound manifest.
 *                   Coupling invariant: inbound.portOfDischarge ===
 *                   outbound.portOfLoading === transshipmentPort. Both
 *                   manifests must exist; the declaration, the link and the
 *                   first bonded-transfer audit row are written atomically.
 *   - transition  — bonded transfer status transitions (append-only audit
 *                   trail in bonded_transfers; invalid transitions rejected).
 *   - list / get  — trader-scoped reads (officer roles may read all).
 *
 * Fail-closed: no status is ever mutated in place; every transition appends
 * a bonded_transfers row with the acting user.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  bondedTransfers,
  bondedTransferStatusEnum,
  declarations,
  manifests,
  transshipmentLinks,
} from "../../drizzle/schema";

const OFFICER_ROLES = [
  "admin", "superadmin", "platform_admin", "customs_commissioner", "customs_officer",
];

/** Valid bonded transfer transitions (terminal states: completed, cancelled). */
export const BONDED_TRANSFER_TRANSITIONS: Record<string, string[]> = {
  initiated: ["in_transit", "cancelled"],
  in_transit: ["arrived_bond", "cancelled"],
  arrived_bond: ["under_supervision", "released"],
  under_supervision: ["released"],
  released: ["completed"],
  completed: [],
  cancelled: [],
};

const STATUS_VALUES = bondedTransferStatusEnum.enumValues;

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database is not available in this environment" });
  }
  return db;
}

function canReadAll(role: string): boolean {
  return OFFICER_ROLES.includes(role);
}

export const transshipmentRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        inboundManifestNumber: z.string().min(3).max(64),
        outboundManifestNumber: z.string().min(3).max(64),
        goodsDescription: z.string().min(5),
        hsCode: z.string().min(4).max(12).optional(),
        grossWeight: z.string().optional(),
        numberOfPackages: z.number().int().positive().optional(),
        ucr: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      if (input.inboundManifestNumber === input.outboundManifestNumber) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Inbound and outbound manifests must be different manifests." });
      }
      const [inbound] = await db.select().from(manifests).where(eq(manifests.manifestNumber, input.inboundManifestNumber)).limit(1);
      const [outbound] = await db.select().from(manifests).where(eq(manifests.manifestNumber, input.outboundManifestNumber)).limit(1);
      if (!inbound) throw new TRPCError({ code: "NOT_FOUND", message: `Inbound manifest ${input.inboundManifestNumber} not found.` });
      if (!outbound) throw new TRPCError({ code: "NOT_FOUND", message: `Outbound manifest ${input.outboundManifestNumber} not found.` });
      // Coupling invariant: the transshipment port is where the inbound
      // discharge and outbound loading meet.
      if (inbound.portOfDischarge !== outbound.portOfLoading) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `Manifest coupling invalid: inbound discharges at ${inbound.portOfDischarge} but the outbound loads at ${outbound.portOfLoading}. ` +
            "A transshipment requires both to be the same port.",
        });
      }
      const transshipmentPort = inbound.portOfDischarge;

      return await db.transaction(async (tx) => {
        const [declaration] = await tx
          .insert(declarations)
          .values({
            declarationNumber: `TG-${new Date().getFullYear()}-${nanoid(8).toUpperCase()}`,
            ucr: input.ucr ?? null,
            traderId: ctx.user.id,
            declarationType: "transshipment",
            status: "draft",
            hsCode: input.hsCode ?? null,
            goodsDescription: input.goodsDescription,
            portOfEntry: transshipmentPort,
            grossWeight: input.grossWeight ?? null,
            numberOfPackages: input.numberOfPackages ?? null,
          })
          .returning();
        const [link] = await tx
          .insert(transshipmentLinks)
          .values({
            declarationId: declaration.id,
            inboundManifestId: inbound.id,
            outboundManifestId: outbound.id,
            transshipmentPort,
            createdBy: ctx.user.id,
          })
          .returning();
        await tx.insert(bondedTransfers).values({
          transshipmentLinkId: link.id,
          fromStatus: null,
          toStatus: "initiated",
          actorId: ctx.user.id,
          note: "Transshipment declaration filed — bonded transfer initiated.",
        });
        return { declaration, link };
      });
    }),

  transition: protectedProcedure
    .input(
      z.object({
        linkId: z.number().int().positive(),
        toStatus: z.enum(STATUS_VALUES),
        note: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const [link] = await db.select().from(transshipmentLinks).where(eq(transshipmentLinks.id, input.linkId)).limit(1);
      if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "Transshipment link not found" });
      const [declaration] = await db.select().from(declarations).where(eq(declarations.id, link.declarationId)).limit(1);
      if (!declaration) throw new TRPCError({ code: "NOT_FOUND", message: "Linked declaration not found" });
      if (declaration.traderId !== ctx.user.id && !canReadAll(ctx.user.role)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Transshipment link not found" });
      }
      // Current status = latest audit row (append-only trail).
      const [latest] = await db
        .select()
        .from(bondedTransfers)
        .where(eq(bondedTransfers.transshipmentLinkId, link.id))
        .orderBy(desc(bondedTransfers.id))
        .limit(1);
      const current = (latest?.toStatus ?? "initiated") as string;
      const allowed = BONDED_TRANSFER_TRANSITIONS[current] ?? [];
      if (!allowed.includes(input.toStatus)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid bonded transfer transition ${current} → ${input.toStatus}. Allowed: ${allowed.length ? allowed.join(", ") : "none (terminal state)"}.`,
        });
      }
      const [row] = await db
        .insert(bondedTransfers)
        .values({
          transshipmentLinkId: link.id,
          fromStatus: current as never,
          toStatus: input.toStatus,
          actorId: ctx.user.id,
          note: input.note ?? null,
        })
        .returning();
      return row;
    }),

  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const conditions = canReadAll(ctx.user.role) ? [] : [eq(declarations.traderId, ctx.user.id)];
      return await db
        .select({
          linkId: transshipmentLinks.id,
          declarationId: transshipmentLinks.declarationId,
          declarationNumber: declarations.declarationNumber,
          declarationStatus: declarations.status,
          traderId: declarations.traderId,
          transshipmentPort: transshipmentLinks.transshipmentPort,
          inboundManifestId: transshipmentLinks.inboundManifestId,
          outboundManifestId: transshipmentLinks.outboundManifestId,
          createdAt: transshipmentLinks.createdAt,
        })
        .from(transshipmentLinks)
        .innerJoin(declarations, eq(transshipmentLinks.declarationId, declarations.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(transshipmentLinks.id))
        .limit(input?.limit ?? 20);
    }),

  get: protectedProcedure
    .input(z.object({ linkId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const [link] = await db.select().from(transshipmentLinks).where(eq(transshipmentLinks.id, input.linkId)).limit(1);
      if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "Transshipment link not found" });
      const [declaration] = await db.select().from(declarations).where(eq(declarations.id, link.declarationId)).limit(1);
      if (!declaration) throw new TRPCError({ code: "NOT_FOUND", message: "Linked declaration not found" });
      if (declaration.traderId !== ctx.user.id && !canReadAll(ctx.user.role)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Transshipment link not found" });
      }
      const [inbound] = await db.select().from(manifests).where(eq(manifests.id, link.inboundManifestId)).limit(1);
      const [outbound] = await db.select().from(manifests).where(eq(manifests.id, link.outboundManifestId)).limit(1);
      const history = await db
        .select()
        .from(bondedTransfers)
        .where(eq(bondedTransfers.transshipmentLinkId, link.id))
        .orderBy(bondedTransfers.id);
      const currentStatus = history.length > 0 ? history[history.length - 1].toStatus : "initiated";
      return {
        link,
        declaration,
        inboundManifest: inbound ?? null,
        outboundManifest: outbound ?? null,
        currentStatus,
        allowedTransitions: BONDED_TRANSFER_TRANSITIONS[currentStatus] ?? [],
        history,
      };
    }),
});
