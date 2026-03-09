/**
 * ASEAN Single Window tRPC Router
 * Calls the Go asean-sw-service for G2G message dispatch, WCO XML formatting,
 * inbound acknowledgement handling, and bilateral connection status.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";

const ASEAN_SVC = process.env.ASEAN_SW_SERVICE_URL ?? "http://localhost:8096";

async function aseanFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${ASEAN_SVC}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `asean-sw-service error: ${body}` });
  }
  return res.json();
}

export const aseanSwRouter = router({
  /** Get all ASEAN member state bilateral connections and their status */
  getConnections: protectedProcedure.query(async () => {
    try {
      return await aseanFetch("/api/asean/connections");
    } catch {
      return { connections: [], total: 0, active: 0, _offline: true };
    }
  }),

  /** Ping a specific ASEAN member state gateway to test connectivity */
  testConnection: protectedProcedure
    .input(z.object({ countryCode: z.string().length(2) }))
    .mutation(async ({ input }) => {
      return aseanFetch(`/api/asean/connections/${input.countryCode.toUpperCase()}/test`);
    }),

  /** Send a WCO XML declaration message to an ASEAN member state */
  sendMessage: protectedProcedure
    .input(z.object({
      destinationCode: z.string().length(2),
      ucr: z.string().min(3).max(50),
      traderName: z.string().max(200).optional(),
      traderId: z.string().max(50).optional(),
      hsCode: z.string().max(20).optional(),
      description: z.string().max(500).optional(),
      grossWeightKg: z.number().nonnegative().optional(),
      invoiceValue: z.number().nonnegative().optional(),
      currency: z.string().length(3).optional(),
      dutyAmount: z.number().nonnegative().optional(),
      typeCode: z.enum(["IM", "EX", "TR"]).optional(),
    }))
    .mutation(async ({ input }) => {
      return aseanFetch("/api/asean/messages/send", {
        method: "POST",
        body: JSON.stringify({
          destination_code: input.destinationCode,
          ucr: input.ucr,
          sender_id: "GH-NGSWTP",
          trader_name: input.traderName ?? "",
          trader_id: input.traderId ?? "",
          hs_code: input.hsCode ?? "",
          description: input.description ?? "",
          gross_weight_kg: input.grossWeightKg ?? 0,
          invoice_value: input.invoiceValue ?? 0,
          currency: input.currency ?? "USD",
          duty_amount: input.dutyAmount ?? 0,
          type_code: input.typeCode ?? "IM",
        }),
      });
    }),

  /** Get status of a specific outbound message */
  getMessageStatus: protectedProcedure
    .input(z.object({ messageId: z.string().uuid() }))
    .query(async ({ input }) => {
      return aseanFetch(`/api/asean/messages/${input.messageId}`);
    }),

  /** List all outbound messages, optionally filtered by destination */
  listMessages: protectedProcedure
    .input(z.object({ destinationCode: z.string().length(2).optional() }).optional())
    .query(async ({ input }) => {
      const qs = input?.destinationCode ? `?destination=${input.destinationCode.toUpperCase()}` : "";
      try {
        return await aseanFetch(`/api/asean/messages${qs}`);
      } catch {
        return { messages: [], total: 0, _offline: true };
      }
    }),

  /** Handle inbound acknowledgement from a member state gateway */
  receiveAck: protectedProcedure
    .input(z.object({
      messageRef: z.string().min(3),
      ackReference: z.string().min(3),
      status: z.enum(["accepted", "rejected"]),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      return aseanFetch("/api/asean/messages/ack", {
        method: "POST",
        body: JSON.stringify({
          message_ref: input.messageRef,
          ack_reference: input.ackReference,
          status: input.status,
          reason: input.reason ?? "",
        }),
      });
    }),

  /** Get message statistics for the admin dashboard */
  getStats: protectedProcedure.query(async () => {
    try {
      return await aseanFetch("/api/asean/stats");
    } catch {
      return { total: 0, by_status: {}, _offline: true };
    }
  }),
});
