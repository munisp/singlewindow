import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicRateLimitedProcedure, router } from "../_core/trpc";
import {
  createOgaPermit, getPermitsByDeclaration, updateOgaPermit,
  getPermitsByOfficer, getDeclarationById, logAuditEvent, createNotification,
  getDb, withRlsContext
} from "../db";
import { assertCan, setOwner } from "../_core/permify";
import { broadcastNotification } from "../_core/wsServer";
import { createUserNotification } from "../db";
import { ogaPermits, declarations } from "../../drizzle/schema";
import { and, gte, lte, isNotNull, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { publishEvent, TOPICS } from "../_core/kafka";

// OGA agencies list
export const OGA_AGENCIES = [
  { code: "FDA", name: "Food & Drug Authority" },
  { code: "EPA", name: "Environmental Protection Agency" },
  { code: "MOH", name: "Ministry of Health" },
  { code: "MOFA", name: "Ministry of Foreign Affairs" },
  { code: "MOTI", name: "Ministry of Trade & Industry" },
  { code: "MOAG", name: "Ministry of Agriculture" },
  { code: "MOEN", name: "Ministry of Energy" },
  { code: "NCA", name: "Nuclear & Radiation Authority" },
  { code: "CEPS", name: "Customs & Excise Preventive Service" },
  { code: "DVLA", name: "Driver & Vehicle Licensing Authority" },
  { code: "GSA", name: "Ghana Standards Authority" },
  { code: "GIPC", name: "Ghana Investment Promotion Centre" },
];

// Determine which OGAs need to be notified based on HS code
function getRequiredOGAs(hsCode: string): typeof OGA_AGENCIES {
  const code = hsCode.substring(0, 4);
  const required: typeof OGA_AGENCIES = [];
  // Food & beverages
  if (["0101","0201","0301","0401","0701","0801","0901","1001","1101","1501","1601","1701","1801","1901","2001","2101","2201"].some(c => code.startsWith(c.substring(0,2)))) {
    required.push(OGA_AGENCIES[0]); // FDA
    required.push(OGA_AGENCIES[2]); // MOH
  }
  // Chemicals
  if (code >= "2801" && code <= "3899") {
    required.push(OGA_AGENCIES[1]); // EPA
    required.push(OGA_AGENCIES[7]); // NCA
  }
  // Pharmaceuticals
  if (code >= "3001" && code <= "3099") {
    required.push(OGA_AGENCIES[0]); // FDA
    required.push(OGA_AGENCIES[2]); // MOH
  }
  // Agricultural
  if (code >= "0101" && code <= "1499") {
    required.push(OGA_AGENCIES[5]); // MOAG
  }
  // Default: standards authority for all goods
  required.push(OGA_AGENCIES[10]); // GSA
  // Deduplicate
  const seen = new Map(required.map(a => [a.code, a]));
  return Array.from(seen.values());
}

export const ogaRouter = router({
  validatePermit: publicRateLimitedProcedure
    .input(z.object({ permitNumber: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const [permit] = await db.select({
          permitNumber: ogaPermits.permitNumber,
          agencyCode: ogaPermits.agencyCode,
          agencyName: ogaPermits.agencyName,
          permitType: ogaPermits.permitType,
          status: ogaPermits.status,
          createdAt: ogaPermits.createdAt,
          expiresAt: ogaPermits.expiresAt,
        }).from(ogaPermits)
          .where(eq(ogaPermits.permitNumber, input.permitNumber))
          .limit(1);
        if (!permit) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Application not found." });
        }
        const now = new Date();
        const isExpired = permit.expiresAt !== null && permit.expiresAt <= now;
        return {
          permitNumber: permit.permitNumber,
          agencyCode: permit.agencyCode,
          agencyName: permit.agencyName,
          permitType: permit.permitType,
          status: permit.status,
          issuedAt: permit.createdAt,
          expiresAt: permit.expiresAt,
          isExpired,
          isValid: permit.status === "approved" && !isExpired,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Permit validation is unavailable.",
          cause: error,
        });
      }
    }),

  // Create permits for a declaration (called on submission)
  createForDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const decl = await getDeclarationById(input.declarationId);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND" });

      const agencies = getRequiredOGAs(decl.hsCode ?? "");
      const slaDeadline = new Date();
      slaDeadline.setHours(slaDeadline.getHours() + 48); // 48-hour SLA

      const permits = await Promise.all(agencies.map(agency =>
        createOgaPermit({
          declarationId: input.declarationId,
          agencyCode: agency.code,
          agencyName: agency.name,
          status: "pending",
          slaDeadline,
        })
      ));

      // Permify: register declaration owner as permit owner for each created permit
      const decl2 = await getDeclarationById(input.declarationId);
      if (decl2) {
        await Promise.all(permits.map(p => p && setOwner("permit", p.id, decl2.traderId)));
      }

      // Publish Kafka event for each permit requested (fire-and-forget)
      permits.forEach(p => {
        if (p) publishEvent(TOPICS.OGA_PERMIT_REQUESTED, {
          eventType: "oga.permit_requested",
          aggregateId: String(p.id),
          payload: {
            permitId: p.id,
            declarationId: input.declarationId,
            agencyCode: p.agencyCode,
            agencyName: p.agencyName,
          },
        }).catch(() => {});
      });

      return permits;
    }),

  // Get permits for a declaration — RLS-enforced for traders
  byDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const officerRoles = ["admin", "customs_officer", "oga_officer", "inspector"];
      if (officerRoles.includes(ctx.user.role)) {
        return getPermitsByDeclaration(input.declarationId);
      }
      // Trader path: verify ownership first, then RLS-enforced query
      const decl = await getDeclarationById(input.declarationId);
      if (!decl || decl.traderId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });
      }
      return withRlsContext({ id: ctx.user.id, role: ctx.user.role }, (db) =>
        db.select().from(ogaPermits)
          .where(eq(ogaPermits.declarationId, input.declarationId))
      );
    }),

  // OGA officer: get assigned permits (admin/customs_officer see all)
  myPermits: protectedProcedure.query(async ({ ctx }) => {
    return getPermitsByOfficer(ctx.user.id, ctx.user.role);
  }),

  // OGA officer: approve a permit
  approve: protectedProcedure
    .input(z.object({
      permitId: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Permify: assert OGA officer can approve this permit
      await assertCan(String(ctx.user.id), "permit", String(input.permitId), "approve");
      const updated = await updateOgaPermit(input.permitId, {
        status: "approved",
        assignedOfficerId: ctx.user.id,
        reviewNotes: input.notes,
        permitNumber: `PERMIT-${nanoid(10).toUpperCase()}`,
        respondedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });

      await logAuditEvent({
        entityType: "permit",
        entityId: input.permitId,
        action: "permit_approved",
        actorId: ctx.user.id,
        actorType: "oga_officer",
        newState: { status: "approved", permitNumber: updated.permitNumber },
      });

      // Publish Kafka event (fire-and-forget)
      publishEvent(TOPICS.OGA_PERMIT_APPROVED, {
        eventType: "oga.permit_approved",
        aggregateId: String(input.permitId),
        payload: {
          permitId: input.permitId,
          declarationId: updated.declarationId,
          agencyCode: updated.agencyCode,
          agencyName: updated.agencyName,
          permitNumber: updated.permitNumber,
          approvedBy: ctx.user.id,
        },
      }).catch(() => {});

      // Notify trader via legacy notifications + user_notifications + WebSocket push
      const decl = await getDeclarationById(updated.declarationId);
      if (decl) {
        await createNotification({
          userId: decl.traderId,
          type: "permit_approved",
          title: `${updated.agencyName} Permit Approved`,
          message: `Permit ${updated.permitNumber} from ${updated.agencyName} has been approved for declaration ${decl.declarationNumber}.`,
          entityType: "permit",
          entityId: input.permitId,
        });
        // Sprint 110: real-time push to trader
        const savedNotif = await createUserNotification({
          userId: decl.traderId,
          type: "permit_approved",
          title: `${updated.agencyName} Permit Approved`,
          body: `Permit ${updated.permitNumber} from ${updated.agencyName} has been approved for declaration ${decl.declarationNumber}. Your goods may now proceed.`,
          declarationId: updated.declarationId,
        });
        if (savedNotif) {
          broadcastNotification(decl.traderId, {
            id: savedNotif.id,
            category: "compliance",
            title: savedNotif.title,
            body: savedNotif.body ?? "",
            entityType: "permit",
            entityId: input.permitId,
            createdAt: savedNotif.createdAt?.toISOString() ?? new Date().toISOString(),
          });
        }
      }

      return updated;
    }),

  // OGA officer: reject a permit
  reject: protectedProcedure
    .input(z.object({
      permitId: z.number(),
      reason: z.string().min(10),
    }))
    .mutation(async ({ ctx, input }) => {
      // Permify: assert OGA officer can reject (approve permission covers both actions)
      await assertCan(String(ctx.user.id), "permit", String(input.permitId), "approve");
      const updated = await updateOgaPermit(input.permitId, {
        status: "rejected",
        assignedOfficerId: ctx.user.id,
        reviewNotes: input.reason,
        respondedAt: new Date(),
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });

      const decl = await getDeclarationById(updated.declarationId);
      if (decl) {
        await createNotification({
          userId: decl.traderId,
          type: "permit_rejected",
          title: `${updated.agencyName} Permit Rejected`,
          message: `Permit from ${updated.agencyName} was rejected for declaration ${decl.declarationNumber}. Reason: ${input.reason}`,
          entityType: "permit",
          entityId: input.permitId,
        });
        // Sprint 110: real-time push to trader
        const savedNotif = await createUserNotification({
          userId: decl.traderId,
          type: "permit_rejected",
          title: `${updated.agencyName} Permit Rejected`,
          body: `Your permit from ${updated.agencyName} for declaration ${decl.declarationNumber} was rejected. Reason: ${input.reason}`,
          declarationId: updated.declarationId,
        });
        if (savedNotif) {
          broadcastNotification(decl.traderId, {
            id: savedNotif.id,
            category: "compliance",
            title: savedNotif.title,
            body: savedNotif.body ?? "",
            entityType: "permit",
            entityId: input.permitId,
            createdAt: savedNotif.createdAt?.toISOString() ?? new Date().toISOString(),
          });
        }
      }
      await logAuditEvent({
        entityType: "permit",
        entityId: input.permitId,
        action: "permit_rejected",
        actorId: ctx.user.id,
        actorType: "oga_officer",
        previousState: { status: "under_review" },
        newState: { status: "rejected", reason: input.reason },
      });

      // Publish Kafka event (fire-and-forget)
      publishEvent(TOPICS.OGA_PERMIT_REJECTED, {
        eventType: "oga.permit_rejected",
        aggregateId: String(input.permitId),
        payload: {
          permitId: input.permitId,
          declarationId: updated.declarationId,
          agencyCode: updated.agencyCode,
          agencyName: updated.agencyName,
          reason: input.reason,
          rejectedBy: ctx.user.id,
        },
      }).catch(() => {});

      return updated;
    }),

  // List all agencies
  agencies: protectedProcedure.query(() => OGA_AGENCIES),

  /**
   * expiryCalendar — returns permits expiring within the next `days` days.
   * OGA officers see their assigned permits; admins/customs see all.
   * Results are sorted by expiry date ascending.
   */
  expiryCalendar: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(90) }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const horizon = new Date(now.getTime() + input.days * 24 * 60 * 60 * 1000);
      const baseWhere = and(
        isNotNull(ogaPermits.expiresAt),
        gte(ogaPermits.expiresAt, now),
        lte(ogaPermits.expiresAt, horizon),
      );
      type CalendarRow = {
        id: number; permitNumber: string | null; agencyCode: string; agencyName: string;
        permitType: string | null; status: string; expiresAt: Date | null;
        declarationId: number; declarationNumber: string; traderId: number;
      };
      const selectShape = {
        id: ogaPermits.id,
        permitNumber: ogaPermits.permitNumber,
        agencyCode: ogaPermits.agencyCode,
        agencyName: ogaPermits.agencyName,
        permitType: ogaPermits.permitType,
        status: ogaPermits.status,
        expiresAt: ogaPermits.expiresAt,
        declarationId: ogaPermits.declarationId,
        declarationNumber: declarations.declarationNumber,
        traderId: declarations.traderId,
      };
      const adminRoles = ["admin", "oga_officer", "customs_officer"];
      let rows: CalendarRow[];
      if (adminRoles.includes(ctx.user.role)) {
        const db = await getDb();
        if (!db) return [];
        rows = (await db.select(selectShape).from(ogaPermits)
          .innerJoin(declarations, eq(ogaPermits.declarationId, declarations.id))
          .where(baseWhere).orderBy(asc(ogaPermits.expiresAt)).limit(200)) as CalendarRow[];
      } else {
        // Trader: RLS enforces row-level ownership; also filter by traderId in WHERE
        rows = (await withRlsContext({ id: ctx.user.id, role: ctx.user.role }, (db) =>
          db.select(selectShape).from(ogaPermits)
            .innerJoin(declarations, eq(ogaPermits.declarationId, declarations.id))
            .where(and(baseWhere, eq(declarations.traderId, ctx.user.id)))
            .orderBy(asc(ogaPermits.expiresAt)).limit(200)
        )) as CalendarRow[];
      }
      return rows.map((r) => ({
        ...r,
        daysUntilExpiry: r.expiresAt
          ? Math.ceil((r.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          : null,
      }));
    }),
});
