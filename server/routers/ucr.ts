/**
 * ucr.ts — Unique Consignment Reference (UCR) tRPC Router
 *
 * TradeGateway NGSWTP — Implements the WCO UCR standard for consignment tracking.
 * Delegates to the Go ucr-service microservice for UCR generation and management.
 *
 * UCR is the primary identifier linking all declarations and documents
 * for a specific shipment (ISO 15459 / WCO Recommendation 11).
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { ENV } from "../_core/env";
import { TRPCError } from "@trpc/server";

const UCR_SERVICE_URL = process.env.UCR_SERVICE_URL ?? "http://ucr-service:8097";

async function callUCRService(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${UCR_SERVICE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "Unknown error");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `UCR service error ${res.status}: ${err}`,
    });
  }
  return res.json();
}

export const ucrRouter = router({
  /**
   * generate — Generate a new WCO-compliant UCR for a consignment.
   * Sprint v140 — UCR System implementation.
   */
  generate: protectedProcedure
    .input(z.object({
      ucrType: z.enum(["SINGLE", "MULTIPLE"]),
      consigneeRef: z.string().min(1).max(128),
      portOfEntry: z.string().min(1).max(64),
    }))
    .mutation(async ({ input, ctx }) => {
      return callUCRService("/api/ucr/generate", "POST", {
        traderId: ctx.user.id,
        ucrType: input.ucrType,
        consigneeRef: input.consigneeRef,
        portOfEntry: input.portOfEntry,
      });
    }),

  /**
   * get — Get UCR details by UCR number.
   */
  get: protectedProcedure
    .input(z.object({ ucrNumber: z.string().min(1) }))
    .query(async ({ input }) => {
      return callUCRService(`/api/ucr/${input.ucrNumber}`);
    }),

  /**
   * validate — Public validation of a UCR number (for MDAs/OGAs).
   */
  validate: protectedProcedure
    .input(z.object({ ucrNumber: z.string().min(1) }))
    .query(async ({ input }) => {
      return callUCRService(`/api/ucr/${input.ucrNumber}/validate`);
    }),

  /**
   * linkDeclaration — Link a declaration to a UCR.
   * Once linked, the UCR cannot be linked to another declaration.
   */
  linkDeclaration: protectedProcedure
    .input(z.object({
      ucrNumber: z.string().min(1),
      declarationId: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      return callUCRService(`/api/ucr/${input.ucrNumber}/link`, "POST", {
        declarationId: input.declarationId,
      });
    }),

  /**
   * activate — Activate a UCR (pre-arrival notification).
   */
  activate: protectedProcedure
    .input(z.object({ ucrNumber: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return callUCRService(`/api/ucr/${input.ucrNumber}/activate`, "POST");
    }),

  /**
   * close — Close a UCR after clearance.
   */
  close: adminProcedure
    .input(z.object({ ucrNumber: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return callUCRService(`/api/ucr/${input.ucrNumber}/close`, "POST");
    }),

  /**
   * listByTrader — List all UCRs for the authenticated trader.
   */
  listByTrader: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
    }).optional())
    .query(async ({ ctx }) => {
      return callUCRService(`/api/ucr/trader/${ctx.user.id}`);
    }),
});
