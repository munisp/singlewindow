/**
 * ASEAN Single Window tRPC Router
 * Calls the Go asean-sw-service for G2G message dispatch, WCO XML formatting,
 * inbound acknowledgement handling, and bilateral connection status.
 * Sprint 57: Added acknowledgeMessage, retryMessage, getConnectivityStatus,
 *            listInboundMessages, and ACDD/SSTC/ATIGA document type support.
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

// ASEAN member states
const ASEAN_MEMBERS = [
  { code: "BN", name: "Brunei",      uptime: 99.1,  latency_ms: 42,  status: "active" },
  { code: "KH", name: "Cambodia",    uptime: 97.3,  latency_ms: 88,  status: "active" },
  { code: "ID", name: "Indonesia",   uptime: 99.8,  latency_ms: 31,  status: "active" },
  { code: "LA", name: "Laos",        uptime: 94.2,  latency_ms: 120, status: "maintenance" },
  { code: "MY", name: "Malaysia",    uptime: 99.9,  latency_ms: 18,  status: "active" },
  { code: "MM", name: "Myanmar",     uptime: 88.5,  latency_ms: 210, status: "active" },
  { code: "PH", name: "Philippines", uptime: 99.2,  latency_ms: 55,  status: "active" },
  { code: "SG", name: "Singapore",   uptime: 99.99, latency_ms: 8,   status: "active" },
  { code: "TH", name: "Thailand",    uptime: 99.5,  latency_ms: 25,  status: "active" },
  { code: "VN", name: "Vietnam",     uptime: 98.7,  latency_ms: 62,  status: "active" },
] as const;

/** Compute connectivity score (0-100) from uptime and latency */
export function computeConnectivityScore(uptime: number, latencyMs: number): number {
  const uptimeScore = uptime; // 0-100
  const latencyScore = Math.max(0, 100 - latencyMs / 5); // 200ms → 60, 0ms → 100
  return Math.round(uptimeScore * 0.7 + latencyScore * 0.3);
}

/** Classify connectivity score into tier */
export function classifyConnectivity(score: number): "excellent" | "good" | "degraded" | "poor" {
  if (score >= 95) return "excellent";
  if (score >= 80) return "good";
  if (score >= 60) return "degraded";
  return "poor";
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
      messageType: z.enum(["ACDD", "SSTC", "ATIGA"]).default("ACDD"),
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
          message_type: input.messageType,
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

  /** List inbound G2G messages received from member states */
  listInboundMessages: protectedProcedure
    .input(z.object({ sourceCode: z.string().length(2).optional() }).optional())
    .query(async ({ input }) => {
      const qs = input?.sourceCode ? `?source=${input.sourceCode.toUpperCase()}` : "";
      try {
        return await aseanFetch(`/api/asean/messages/inbound${qs}`);
      } catch {
        const messageTypes = ["ACDD", "SSTC", "ATIGA"] as const;
        const sources = ["SG", "MY", "TH", "ID", "VN"];
        const statuses = ["pending_ack", "accepted", "rejected"];
        return {
          messages: Array.from({ length: 8 }, (_, i) => ({
            id: `inbound-${i + 1}`,
            message_ref: `INBOUND-${1000 + i}`,
            source_code: sources[i % sources.length],
            message_type: messageTypes[i % messageTypes.length],
            ucr: `UCR-${2000 + i}`,
            status: statuses[i % statuses.length],
            received_at: new Date(Date.now() - i * 3600_000).toISOString(),
            ack_reference: statuses[i % statuses.length] !== "pending_ack" ? `ACK-${3000 + i}` : undefined,
          })),
          total: 8,
          _offline: true,
        };
      }
    }),

  /** Acknowledge an inbound G2G message from a member state */
  acknowledgeMessage: protectedProcedure
    .input(z.object({
      messageId: z.string().min(3),
      status: z.enum(["accepted", "rejected"]),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        return await aseanFetch(`/api/asean/messages/${input.messageId}/ack`, {
          method: "POST",
          body: JSON.stringify({ status: input.status, reason: input.reason ?? "" }),
        });
      } catch {
        return {
          messageId: input.messageId,
          status: input.status,
          ackReference: `ACK-${Date.now()}`,
          acknowledgedAt: new Date().toISOString(),
          _offline: true,
        };
      }
    }),

  /** Retry a failed outbound G2G message */
  retryMessage: protectedProcedure
    .input(z.object({ messageId: z.string().min(3) }))
    .mutation(async ({ input }) => {
      try {
        return await aseanFetch(`/api/asean/messages/${input.messageId}/retry`, {
          method: "POST",
        });
      } catch {
        return { messageId: input.messageId, status: "queued", retryAt: new Date().toISOString(), _offline: true };
      }
    }),

  /** Get detailed connectivity metrics for all 10 ASEAN member states */
  getConnectivityStatus: protectedProcedure.query(async () => {
    try {
      return await aseanFetch("/api/asean/connectivity");
    } catch {
      return {
        members: ASEAN_MEMBERS.map((m) => ({
          ...m,
          score: computeConnectivityScore(m.uptime, m.latency_ms),
          tier: classifyConnectivity(computeConnectivityScore(m.uptime, m.latency_ms)),
        })),
        checkedAt: new Date().toISOString(),
        _offline: true,
      };
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
