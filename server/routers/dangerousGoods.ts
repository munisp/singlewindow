/**
 * dangerousGoods.ts — IMDG dangerous-goods declaration extension (Phase 19,
 * F5a / audit A5-B9).
 *
 *   - addItem            — attach a structurally-validated IMDG line item to
 *                          a customs declaration (UN number / IMO class &
 *                          division / packing group / proper shipping name /
 *                          flashpoint / EmS). A declaration is DG-flagged by
 *                          the EXISTENCE of ≥1 DG item (derived flag — never
 *                          stored, never stale). Owner-only while the
 *                          declaration is not cleared; every mutation is
 *                          audited.
 *   - removeItem         — owner removes an item while the declaration is
 *                          still editable; the DG flag is recomputed (never
 *                          left stale).
 *   - listForDeclaration — owner or officer reads the DG items.
 *   - officerBoard       — officer-only board of DG-flagged declarations
 *                          with their items (the officer view surfacing DG).
 *   - lookup             — HONEST unavailable state: there is no IMDG Code
 *                          substance database configured in this deployment.
 *                          Structural validation (server/_core/imdg.ts) is
 *                          local and real; substance-level facts (is UN 1203
 *                          "GASOLINE"?) require licensed IMDG data, so this
 *                          procedure ALWAYS fails closed with
 *                          IMDG_CODE_LOOKUP_NOT_CONFIGURED instead of
 *                          fabricating a lookup.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, logAuditEvent } from "../db";
import { declarations } from "../../drizzle/schema";
import { declarationDgItems } from "../../drizzle/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { validateImdgItem } from "../_core/imdg";
import { requireOfficer } from "./aeoFastLane";

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

const dgItemInput = z.object({
  unNumber: z.string().min(1).max(4),
  imoClass: z.string().min(1).max(8),
  packingGroup: z.string().max(8).nullish(),
  properShippingName: z.string().min(1).max(256),
  flashpointCelsius: z.number().nullish(),
  emsCodes: z.array(z.string().max(8)).max(4).nullish(),
  marinePollutant: z.boolean().nullish(),
  quantityDescription: z.string().max(256).nullish(),
});

async function loadDeclarationForWrite(db: any, declarationId: number, userId: number, role: string) {
  const rows = await db
    .select()
    .from(declarations)
    .where(eq(declarations.id, declarationId))
    .limit(1);
  const declaration = rows[0];
  if (!declaration) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Declaration ${declarationId} not found` });
  }
  const isOwner = declaration.traderId === userId;
  if (!isOwner) {
    // Officers may read but never write DG items on a trader's declaration.
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the declaration owner manages DG items" });
  }
  if (declaration.status === "cleared" || declaration.status === "cancelled") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Declaration is ${declaration.status} — DG items are frozen`,
    });
  }
  return declaration;
}

export const dangerousGoodsRouter = router({
  addItem: protectedProcedure
    .input(z.object({ declarationId: z.number().int().positive(), item: dgItemInput }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const validation = validateImdgItem(input.item);
      if (!validation.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `IMDG structural validation failed: ${validation.errors.join("; ")}`,
        });
      }
      const n = validation.normalized!;
      await loadDeclarationForWrite(db, input.declarationId, ctx.user.id, ctx.user.role);
      const inserted = await db
        .insert(declarationDgItems)
        .values({
          declarationId: input.declarationId,
          unNumber: n.unNumber,
          imoClass: n.imoClass,
          packingGroup: n.packingGroup,
          properShippingName: n.properShippingName,
          flashpointCelsius: n.flashpointCelsius == null ? null : String(n.flashpointCelsius),
          emsCodes: n.emsCodes,
          marinePollutant: n.marinePollutant,
          quantityDescription: input.item.quantityDescription ?? null,
          createdBy: ctx.user.id,
        })
        .returning();
      await logAuditEvent({
        entityType: "declaration",
        entityId: input.declarationId,
        action: "dg_item.added",
        actorId: ctx.user.id,
        actorType: ctx.user.role,
        newState: {
          dgItemId: inserted[0]?.id,
          unNumber: n.unNumber,
          imoClass: n.imoClass,
          packingGroup: n.packingGroup,
        },
      });
      return { item: inserted[0], hasDangerousGoods: true };
    }),

  removeItem: protectedProcedure
    .input(z.object({ declarationId: z.number().int().positive(), itemId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await loadDeclarationForWrite(db, input.declarationId, ctx.user.id, ctx.user.role);
      const rows = await db
        .select()
        .from(declarationDgItems)
        .where(and(eq(declarationDgItems.id, input.itemId), eq(declarationDgItems.declarationId, input.declarationId)))
        .limit(1);
      if (!rows[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: `DG item ${input.itemId} not found on declaration ${input.declarationId}` });
      }
      await db.delete(declarationDgItems).where(eq(declarationDgItems.id, input.itemId));
      const remaining = await db
        .select()
        .from(declarationDgItems)
        .where(eq(declarationDgItems.declarationId, input.declarationId));
      const stillDg = remaining.length > 0;
      await logAuditEvent({
        entityType: "declaration",
        entityId: input.declarationId,
        action: "dg_item.removed",
        actorId: ctx.user.id,
        actorType: ctx.user.role,
        newState: { dgItemId: input.itemId, hasDangerousGoods: stillDg },
      });
      return { removed: true, hasDangerousGoods: stillDg };
    }),

  listForDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const declRows = await db
        .select()
        .from(declarations)
        .where(eq(declarations.id, input.declarationId))
        .limit(1);
      const declaration = declRows[0];
      if (!declaration) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Declaration ${input.declarationId} not found` });
      }
      const isOwner = declaration.traderId === ctx.user.id;
      if (!isOwner) {
        requireOfficer(ctx.user.role);
      }
      const items = await db
        .select()
        .from(declarationDgItems)
        .where(eq(declarationDgItems.declarationId, input.declarationId));
      return { hasDangerousGoods: items.length > 0, items };
    }),

  /** Officer view: DG-flagged declarations with their line items. */
  officerBoard: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(100) }).optional())
    .query(async ({ ctx, input }) => {
      requireOfficer(ctx.user.role);
      const db = await requireDb();
      // Phase 21 (perf): previously this loaded the ENTIRE dg-items table and
      // then ran one SELECT per declaration (N+1). Now: one bounded scan of
      // the most recent dg items to pick the page's declaration ids, then ONE
      // batched declarations fetch via IN (...) — 2 round-trips total.
      const limit = input?.limit ?? 100;
      const recentItems = await db
        .select()
        .from(declarationDgItems)
        .orderBy(desc(declarationDgItems.createdAt))
        .limit(5000); // bounded scan window for the board page
      const declarationIds: number[] = [];
      const seen = new Set<number>();
      for (const item of recentItems) {
        if (seen.has(item.declarationId)) continue;
        seen.add(item.declarationId);
        declarationIds.push(item.declarationId);
        if (declarationIds.length >= limit) break;
      }
      if (declarationIds.length === 0) return { count: 0, board: [] };
      const declRows = await db
        .select()
        .from(declarations)
        .where(inArray(declarations.id, declarationIds));
      const declById = new Map<number, unknown>();
      for (const d of declRows) declById.set(d.id, d);
      const board = [] as Array<{ declaration: unknown; items: unknown[] }>;
      for (const declarationId of declarationIds) {
        const declaration = declById.get(declarationId);
        if (!declaration) continue;
        board.push({
          declaration,
          items: recentItems.filter((i: { declarationId: number }) => i.declarationId === declarationId),
        });
      }
      return { count: board.length, board };
    }),

  /**
   * Honest unavailable state: no IMDG Code substance lookup is configured.
   * Structural validation is local (validateImdgItem); substance-level truth
   * (proper shipping name ↔ UN number correspondence, segregation, special
   * provisions) requires licensed IMDG data that this deployment does not
   * have. Fail closed — never fabricate a lookup.
   */
  lookup: protectedProcedure
    .input(z.object({ unNumber: z.string().min(4).max(4) }))
    .query(async () => {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "IMDG_CODE_LOOKUP_NOT_CONFIGURED: this deployment performs local structural validation only " +
          "(UN number format/range, class & division, packing-group rules, flashpoint/EmS shape). " +
          "No IMDG Code substance database is configured, so substance-level lookup is unavailable.",
      });
    }),
});
