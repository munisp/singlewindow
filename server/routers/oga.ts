import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createOgaPermit, getPermitsByDeclaration, updateOgaPermit,
  getPermitsByOfficer, getDeclarationById, logAuditEvent, createNotification
} from "../db";
import { nanoid } from "nanoid";

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

      return permits;
    }),

  // Get permits for a declaration
  byDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getPermitsByDeclaration(input.declarationId);
    }),

  // OGA officer: get assigned permits
  myPermits: protectedProcedure.query(async ({ ctx }) => {
    return getPermitsByOfficer(ctx.user.id);
  }),

  // OGA officer: approve a permit
  approve: protectedProcedure
    .input(z.object({
      permitId: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
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

      // Notify trader
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
      }

      return updated;
    }),

  // List all agencies
  agencies: protectedProcedure.query(() => OGA_AGENCIES),
});
