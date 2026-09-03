/**
 * pcs.ts — PCS Trader Portal tRPC router (Phase 8; spec §4).
 *
 * The Port Community System trader portal is a thin read/projection layer
 * over blueeconomy-port-interoperability (system of record: /v1/port-calls,
 * /v1/bookings, /v1/slots; outbox topics ports.*.v1). It adds
 * operational/logistics services to the existing UNECE Rec-33 declaration
 * surface and does NOT re-implement declarations, OGA permits, payments, or
 * the simulated AIS map (server/routers/cargoTracking.ts is a seeded
 * simulation and is NEVER a data source here — spec §5.1).
 *
 * The single write path (pcs.bookings.request, spec R3) is LIVE against the
 * port-interop eCallUp booking backend (Temporal workflow, slot capacity,
 * payment intents) with a server-side idempotency key; unconfigured upstream
 * fails closed with a typed PORT_INTEROP_UNCONFIGURED error — never a fake
 * success.
 *
 * Down-vs-empty taxonomy (ministry-portal api-state.tsx precedent): every
 * procedure returns a discriminated result — { status: "ok", data, gaps }
 * (zero rows is a truthful empty state) vs { status: "unavailable", reason,
 * detail } (upstream down / not configured — rendered as a DEGRADED banner
 * with retry). Cached data is never substituted silently; projection rows
 * always carry their provenance (source_event_id / source_topic /
 * projection_lag_ms).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import * as pcsDb from "../dbPcs";
import {
  getPortInteropClient,
  PortInteropConfigError,
  PortInteropRejectedError,
  PortInteropUnavailableError,
  type PortInteropBooking,
  type PortInteropObserverState,
  type PortInteropUnavailableReason,
} from "../_core/portInteropClient";
import { pcsGap, type PcsGapId, type PcsIntegrationGap } from "../_core/pcsGaps";
import { uploadVaultDocument } from "./documentVault";
import { orderMilestones } from "../pcsProjection";
import { pcsBookingRequestsTotal, pcsGapRenderedTotal } from "../_core/metrics";

// ─── Result taxonomy (down vs empty) ─────────────────────────────────────────

export type PcsUnavailableReason =
  | "not_configured"
  | "database_unavailable"
  | PortInteropUnavailableReason;

export type PcsResult<T> =
  | { status: "ok"; data: T; gaps: PcsIntegrationGap[] }
  | { status: "unavailable"; reason: PcsUnavailableReason; detail: string; gaps: PcsIntegrationGap[] };

function ok<T>(data: T, gapIds: readonly PcsGapId[] = []): PcsResult<T> {
  const gaps = gapIds.map((id) => {
    try {
      pcsGapRenderedTotal.inc({ gap_id: id });
    } catch { /* metrics never break the request path */ }
    return pcsGap(id);
  });
  return { status: "ok", data, gaps };
}

function unavailable<T>(reason: PcsUnavailableReason, detail: string): PcsResult<T> {
  return { status: "unavailable", reason, detail, gaps: [] };
}

/** Maps classified port-interop client errors onto the down-vs-empty taxonomy. */
function upstreamFailure<T>(err: unknown): PcsResult<T> {
  if (err instanceof PortInteropConfigError) {
    return unavailable("not_configured", err.message);
  }
  if (err instanceof PortInteropUnavailableError) {
    return unavailable(err.reason, err.message);
  }
  if (err instanceof PortInteropRejectedError) {
    throw new TRPCError({
      code: err.statusCode === 404 ? "NOT_FOUND" : err.statusCode === 403 ? "FORBIDDEN" : "BAD_REQUEST",
      message: err.message,
    });
  }
  throw err;
}

/** Authenticated-trader principal asserted to port-interop (never fabricated). */
function principalOf(userId: number): string {
  return `pcs-trader:${userId}`;
}

// ─── Static UN/LOCODE reference subset (versioned; spec §4 pcs.ports.list) ──

export const PCS_PORT_LIST_VERSION = "2026.1-unlocode-ng-subset";
const PCS_PORTS = [
  { code: "NGAPP", name: "Apapa Port, Lagos" },
  { code: "NGTIN", name: "Tin Can Island Port, Lagos" },
  { code: "NGLOS", name: "Lagos (Apapa/Tin Can complex)" },
  { code: "NGPHC", name: "Port Harcourt" },
  { code: "NGONN", name: "Onne" },
  { code: "NGCAL", name: "Calabar" },
  { code: "NGWAR", name: "Warri" },
  { code: "NGKOK", name: "Koko" },
] as const;

// PCS-only document categories (spec §1.2/R5 extension of documentVault).
const PCS_DOCUMENT_CATEGORIES = ["delivery_order", "gate_pass", "terminal_notice", "pcs_correspondence"] as const;

// PCS notification event types (spec R6; mirror the notification_type enum).
const PCS_NOTIFICATION_TYPES = [
  "pcs_booking_confirmed",
  "pcs_gate_window",
  "pcs_berth_change",
  "pcs_invoice_issued",
] as const;

const NOTIFICATION_CHANNELS = ["email", "sms", "push", "webhook", "in_app"] as const;

const MILESTONE_STATUSES = [
  "pre_arrival", "arrived", "berthed", "ops_started", "discharging",
  "customs_hold", "customs_released", "gate_out", "departed",
] as const;

export const pcsRouter = router({
  // ─── Reference data ─────────────────────────────────────────────────────────

  ports: router({
    list: protectedProcedure.query(() => {
      return ok(
        { version: PCS_PORT_LIST_VERSION, source: "UN/LOCODE (Nigeria subset)", ports: [...PCS_PORTS] },
        []
      );
    }),
  }),

  // ─── R1/R2: consignments + milestone timelines (read model) ────────────────

  myConsignments: router({
    list: protectedProcedure
      .input(
        z.object({
          status: z.enum(MILESTONE_STATUSES).optional(),
          limit: z.number().int().min(1).max(100).default(20),
          cursor: z.number().int().min(0).default(0),
        }).optional()
      )
      .query(async ({ ctx, input }): Promise<PcsResult<{ consignments: unknown[]; total: number; nextCursor: number | null }>> => {
        const res = await pcsDb.listPcsConsignmentsForTrader(ctx.user.id, {
          status: input?.status,
          limit: input?.limit ?? 20,
          offset: input?.cursor ?? 0,
        });
        if (res.down) return unavailable("database_unavailable", "PostgreSQL read model is not available in this environment");
        // Truthful empty: a trader with no projected consignments gets an
        // empty list + the AIS gap disclosure, never synthetic rows.
        return ok(
          { consignments: res.value.rows, total: res.value.rows.length, nextCursor: res.value.nextCursor },
          ["AIS"]
        );
      }),

    timeline: protectedProcedure
      .input(z.object({ consignmentId: z.number().int().positive() }))
      .query(async ({ ctx, input }): Promise<PcsResult<{ consignment: unknown; milestones: unknown[] }>> => {
        const consignmentRes = await pcsDb.getPcsConsignmentForTrader(ctx.user.id, input.consignmentId);
        if (consignmentRes.down) return unavailable("database_unavailable", "PostgreSQL read model is not available in this environment");
        if (!consignmentRes.value) {
          // NOT_FOUND (not FORBIDDEN): never leak another trader's consignment ids.
          throw new TRPCError({ code: "NOT_FOUND", message: "Consignment not found" });
        }
        const milestonesRes = await pcsDb.listPcsMilestones(input.consignmentId);
        if (milestonesRes.down) return unavailable("database_unavailable", "PostgreSQL read model is not available in this environment");
        // Every milestone row carries source_event_id + source_topic by
        // construction (append-only verified projection, spec §5.2).
        return ok(
          { consignment: consignmentRes.value, milestones: orderMilestones(milestonesRes.value) },
          ["AIS", "BERTH_OPS"]
        );
      }),

    linkDeclaration: protectedProcedure
      .input(z.object({
        consignmentId: z.number().int().positive(),
        urn: z.string().min(4).max(128),
      }))
      .mutation(async ({ ctx, input }) => {
        const consignmentRes = await pcsDb.getPcsConsignmentForTrader(ctx.user.id, input.consignmentId);
        if (consignmentRes.down) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        if (!consignmentRes.value) throw new TRPCError({ code: "NOT_FOUND", message: "Consignment not found" });
        // The URN must name an EXISTING declaration owned by this trader — a
        // cross-link is an authority reference, never a free-text claim.
        const declarationRes = await pcsDb.findOwnedDeclaration(ctx.user.id, input.urn);
        if (declarationRes.down) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        if (!declarationRes.value) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No declaration with this reference exists for your account — only your own declarations can be linked.",
          });
        }
        const updated = await pcsDb.linkPcsConsignmentDeclaration(input.consignmentId, input.urn);
        if (updated.down) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        return updated.value;
      }),
  }),

  // ─── R1: vessel visits carrying the trader's cargo (read-through) ──────────

  vesselVisits: router({
    forMyCargo: protectedProcedure
      .input(
        z.object({
          portCode: z.string().regex(/^[A-Z]{2,8}$/).optional(),
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
        }).optional()
      )
      .query(async ({ ctx, input }): Promise<PcsResult<{ visits: unknown[]; unlinkedConsignments: number }>> => {
        const listRes = await pcsDb.listPcsConsignmentsForTrader(ctx.user.id, { limit: 100, offset: 0 });
        if (listRes.down) return unavailable("database_unavailable", "PostgreSQL read model is not available in this environment");
        const myConsignments = listRes.value.rows;
        const linked = myConsignments.filter((c) => c.portCallId && (!input?.portCode || c.portCode === input.portCode));
        const unlinkedConsignments = myConsignments.length - linked.length;
        if (linked.length === 0) {
          // Empty (not down): no authority-linked port calls for this trader.
          return ok({ visits: [], unlinkedConsignments }, ["AIS", "BERTH_OPS", "PORTCALL_LINKAGE"]);
        }
        let client;
        try {
          client = getPortInteropClient();
        } catch (err) {
          return upstreamFailure(err);
        }
        const uniqueCallIds = [...new Set(linked.map((c) => c.portCallId as string))];
        const visits: unknown[] = [];
        let lastFailure: PcsResult<never> | null = null;
        for (const callId of uniqueCallIds) {
          try {
            const portCall = await client.getPortCall(callId, { principal: principalOf(ctx.user.id) });
            if (input?.from && portCall.updated_at < input.from) continue;
            if (input?.to && portCall.updated_at > input.to) continue;
            visits.push({
              // Authority-sourced fields only; provenance is the port-call
              // record version/timestamps. Vessel positions and arrival/berth/
              // departure ETAs are GAP-PCS-AIS — never synthesized.
              portCall,
              consignmentIds: linked.filter((c) => c.portCallId === callId).map((c) => c.id),
              provenance: {
                source: "port-interop /v1/port-calls",
                callId,
                recordVersion: portCall.version,
                recordUpdatedAt: portCall.updated_at,
              },
            });
          } catch (err) {
            if (err instanceof PortInteropRejectedError && err.statusCode === 404) continue; // dangling link — skip
            lastFailure = upstreamFailure(err);
            if (err instanceof PortInteropRejectedError) throw err;
          }
        }
        if (lastFailure && visits.length === 0) return lastFailure as PcsResult<{ visits: unknown[]; unlinkedConsignments: number }>;
        return ok({ visits, unlinkedConsignments }, ["AIS", "BERTH_OPS"]);
      }),
  }),

  // ─── R3: terminal bookings (read-through + product-gated initiation) ────────

  bookings: router({
    list: protectedProcedure.query(async ({ ctx }): Promise<PcsResult<{ bookings: unknown[] }>> => {
      const linksRes = await pcsDb.listPcsBookingLinksForTrader(ctx.user.id);
      if (linksRes.down) return unavailable("database_unavailable", "PostgreSQL read model is not available in this environment");
      if (linksRes.value.length === 0) {
        // Truthful empty: the trader has no associated bookings.
        return ok({ bookings: [] }, []);
      }
      let client;
      try {
        client = getPortInteropClient();
      } catch (err) {
        return upstreamFailure(err);
      }
      const bookings: unknown[] = [];
      let failures = 0;
      let lastFailure: PcsResult<never> | null = null;
      for (const link of linksRes.value) {
        try {
          const booking = await client.getBooking(link.bookingId, { principal: principalOf(ctx.user.id) });
          bookings.push({ link, booking });
        } catch (err) {
          if (err instanceof PortInteropRejectedError) {
            // A 404/403 on one booking does not poison the list.
            bookings.push({ link, booking: null, itemError: { code: err.statusCode, message: err.message } });
            continue;
          }
          failures++;
          lastFailure = upstreamFailure(err);
        }
      }
      if (failures === linksRes.value.length && lastFailure) {
        // Everything failed for an availability reason → DOWN, not empty.
        return lastFailure as PcsResult<{ bookings: unknown[] }>;
      }
      return ok({ bookings }, []);
    }),

    detail: protectedProcedure
      .input(z.object({ bookingId: z.string().min(1).max(128) }))
      .query(async ({ ctx, input }): Promise<PcsResult<{
        booking: PortInteropBooking;
        observer: PortInteropObserverState | null;
        observerUnavailable: string | null;
      }>> => {
        // Ownership: the trader must hold the booking link. NOT_FOUND, never
        // a leak of another trader's booking id (ownership-regression pattern).
        const linkRes = await pcsDb.findPcsBookingLinkForTrader(ctx.user.id, input.bookingId);
        if (linkRes.down) return unavailable("database_unavailable", "PostgreSQL read model is not available in this environment");
        if (!linkRes.value) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
        let client;
        try {
          client = getPortInteropClient();
        } catch (err) {
          return upstreamFailure(err);
        }
        let booking: PortInteropBooking;
        try {
          booking = await client.getBooking(input.bookingId, { principal: principalOf(ctx.user.id) });
        } catch (err) {
          return upstreamFailure(err);
        }
        // Observer state comes from the Temporal workflow query; its absence
        // is a labelled partial state, never a fabricated stage.
        let observer: PortInteropObserverState | null = null;
        let observerUnavailable: string | null = null;
        try {
          observer = await client.getBookingObserver(input.bookingId, { principal: principalOf(ctx.user.id) });
        } catch (err) {
          observerUnavailable =
            err instanceof PortInteropUnavailableError || err instanceof PortInteropRejectedError
              ? err.message
              : "observer state unavailable";
        }
        return ok({ booking, observer, observerUnavailable }, []);
      }),

    /**
     * Booking INITIATION (spec R3 write path) — LIVE. Routed to port-interop
     * (the eCallUp system of record: Temporal booking workflow, slot capacity,
     * payment intents) with a server-generated idempotency key (request_id);
     * the trader↔booking link is recorded on success. Fail-closed: an
     * unconfigured upstream is a typed PORT_INTEROP_UNCONFIGURED error, an
     * unreachable upstream is 503, an upstream 4xx is surfaced verbatim.
     */
    request: protectedProcedure
      .input(z.object({
        terminalId: z.string().regex(/^[A-Z][A-Z0-9-]{1,31}$/),
        slotWindow: z.object({
          startsAt: z.string().datetime(),
          endsAt: z.string().datetime(),
        }),
        containerNo: z.string().min(4).max(16).optional(),
        truckPlate: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,15}$/),
        truckerMsisdn: z.string().regex(/^\+[0-9]{8,15}$/),
        amountKobo: z.number().int().positive(),
        consignmentId: z.number().int().positive().optional(),
        cargoDeclarationRef: z.string().regex(/^[A-Z0-9][A-Z0-9/-]{3,63}$/).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          pcsBookingRequestsTotal.inc({ outcome: "attempted" });
        } catch { /* metrics never break the request path */ }
        // When a consignment is named, it must belong to this trader.
        if (input.consignmentId !== undefined) {
          const consignmentRes = await pcsDb.getPcsConsignmentForTrader(ctx.user.id, input.consignmentId);
          if (consignmentRes.down) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
          if (!consignmentRes.value) throw new TRPCError({ code: "NOT_FOUND", message: "Consignment not found" });
        }
        // Server-side idempotency key: stable per trader + terminal + truck +
        // window so an exact UI retry replays to the same booking
        // (port-interop replays on request_id), never creating a duplicate.
        const requestId = `pcs-${ctx.user.id}-${input.terminalId}-${input.truckPlate}-${input.slotWindow.startsAt}`;
        let client;
        try {
          client = getPortInteropClient();
        } catch (err) {
          if (err instanceof PortInteropConfigError) {
            // Typed UNCONFIGURED (never a gap code): the capability exists —
            // this deployment is missing PORT_INTEROP_URL / service credential
            // (env-only secrets policy). Fail closed; no booking is created.
            try {
              pcsBookingRequestsTotal.inc({ outcome: "unconfigured" });
            } catch { /* ignore */ }
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `PORT_INTEROP_UNCONFIGURED: ${err.message}`,
            });
          }
          const failure = upstreamFailure<never>(err);
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: failure.status === "unavailable" ? failure.detail : "port-interop is not configured",
          });
        }
        let booking: PortInteropBooking;
        try {
          booking = await client.createBooking(
            {
              request_id: requestId,
              truck_plate: input.truckPlate,
              trucker_msisdn: input.truckerMsisdn,
              terminal_id: input.terminalId,
              channel: "WEB",
              amount_kobo: input.amountKobo,
              expires_at: input.slotWindow.endsAt,
              ...(input.cargoDeclarationRef ? { cargo_declaration_ref: input.cargoDeclarationRef } : {}),
            },
            { principal: principalOf(ctx.user.id) }
          );
        } catch (err) {
          try {
            pcsBookingRequestsTotal.inc({ outcome: err instanceof PortInteropRejectedError ? "rejected" : "unavailable" });
          } catch { /* ignore */ }
          if (err instanceof PortInteropRejectedError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
          }
          const failure = upstreamFailure<never>(err);
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: failure.status === "unavailable" ? failure.detail : "port-interop unavailable",
          });
        }
        // Record the trader↔booking association (idempotent on booking_id).
        const linkRes = await pcsDb.insertPcsBookingLink({
          traderUserId: ctx.user.id,
          bookingId: booking.booking_id,
          consignmentId: input.consignmentId ?? null,
          createdVia: "pcs",
        });
        if (linkRes.down) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        try {
          pcsBookingRequestsTotal.inc({ outcome: "created" });
        } catch { /* ignore */ }
        return { booking, requestId };
      }),
  }),

  // ─── R4: billing visibility (read-only ledger projection) ──────────────────

  billing: router({
    list: protectedProcedure
      .input(
        z.object({
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
          limit: z.number().int().min(1).max(100).default(50),
        }).optional()
      )
      .query(async ({ ctx, input }): Promise<PcsResult<{ snapshots: unknown[] }>> => {
        const linksRes = await pcsDb.listPcsBookingLinksForTrader(ctx.user.id);
        if (linksRes.down) return unavailable("database_unavailable", "PostgreSQL read model is not available in this environment");
        if (linksRes.value.length === 0) return ok({ snapshots: [] }, ["TARIFF"]);
        const snapshotsRes = await pcsDb.listPcsBillingSnapshotsForBookings(
          linksRes.value.map((l) => l.bookingId),
          {
            from: input?.from ? new Date(input.from) : undefined,
            to: input?.to ? new Date(input.to) : undefined,
            limit: input?.limit ?? 50,
          }
        );
        if (snapshotsRes.down) return unavailable("database_unavailable", "PostgreSQL read model is not available in this environment");
        // Every row is a projection labelled with projectionLagMs and its
        // ledger commit hash (spec §5.5) — never double-entry truth.
        return ok({ snapshots: snapshotsRes.value }, ["TARIFF"]);
      }),

    receipt: protectedProcedure
      .input(z.object({ invoiceId: z.string().min(1).max(128) }))
      .query(async ({ ctx, input }): Promise<PcsResult<{ snapshot: unknown }>> => {
        const linksRes = await pcsDb.listPcsBookingLinksForTrader(ctx.user.id);
        if (linksRes.down) return unavailable("database_unavailable", "PostgreSQL read model is not available in this environment");
        if (linksRes.value.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found" });
        const snapshotRes = await pcsDb.findPcsBillingSnapshotForBookings(
          linksRes.value.map((l) => l.bookingId),
          input.invoiceId
        );
        if (snapshotRes.down) return unavailable("database_unavailable", "PostgreSQL read model is not available in this environment");
        if (!snapshotRes.value) throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found" });
        // GAP-PCS-RECEIPT-READTHROUGH: projection-sourced, lag-labelled
        // (port-interop exposes no receipt GET endpoint).
        return ok({ snapshot: snapshotRes.value }, ["TARIFF", "RECEIPT_READTHROUGH"]);
      }),
  }),

  // ─── R5: document exchange (wraps documentVault with PCS categories) ────────

  documents: router({
    inbox: protectedProcedure
      .input(
        z.object({
          category: z.enum(PCS_DOCUMENT_CATEGORIES).optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        }).optional()
      )
      .query(async ({ ctx, input }): Promise<PcsResult<{ documents: unknown[] }>> => {
        const res = await pcsDb.listPcsDocuments(ctx.user.id, PCS_DOCUMENT_CATEGORIES, {
          category: input?.category,
          limit: input?.limit ?? 50,
          offset: input?.offset ?? 0,
        });
        if (res.down) return unavailable("database_unavailable", "PostgreSQL read model is not available in this environment");
        return ok({ documents: res.value }, []);
      }),

    // Routes through the SHARED vault write path (AV scan + quarantine
    // semantics identical to documentVault.upload) — no PCS bypass.
    share: protectedProcedure
      .input(z.object({
        filename: z.string().min(1).max(255),
        contentType: z.string().min(1),
        fileData: z.string().describe("Base64-encoded file content"),
        sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
        category: z.enum(PCS_DOCUMENT_CATEGORIES),
        description: z.string().max(1000).optional(),
        declarationId: z.number().int().positive().optional(),
      }))
      .mutation(async ({ ctx, input }) =>
        uploadVaultDocument(ctx.user.id, { ...input, accessLevel: "shared_with_customs" })),
  }),

  // ─── R6: notifications (wraps notificationChannelPreferences) ───────────────

  notifications: router({
    preferences: protectedProcedure.query(async ({ ctx }): Promise<PcsResult<{ preferences: unknown[] }>> => {
      const res = await pcsDb.listPcsNotificationPreferences(ctx.user.id, PCS_NOTIFICATION_TYPES);
      if (res.down) return unavailable("database_unavailable", "PostgreSQL read model is not available in this environment");
      const map = new Map(res.value.map((r) => [`${r.notificationType}:${r.channel}`, r.enabled]));
      const preferences = PCS_NOTIFICATION_TYPES.map((eventType) => ({
        eventType,
        channels: NOTIFICATION_CHANNELS.map((channel) => ({
          channel,
          enabled: map.get(`${eventType}:${channel}`) ?? (channel === "in_app" || channel === "email"),
        })),
      }));
      return ok({ preferences }, []);
    }),

    subscribe: protectedProcedure
      .input(z.object({
        channels: z.array(z.enum(NOTIFICATION_CHANNELS)).min(1),
        eventTypes: z.array(z.enum(PCS_NOTIFICATION_TYPES)).min(1),
        enabled: z.boolean().default(true),
      }))
      .mutation(async ({ ctx, input }) => {
        for (const eventType of input.eventTypes) {
          for (const channel of input.channels) {
            const res = await pcsDb.upsertPcsNotificationPreference(ctx.user.id, eventType, channel, input.enabled);
            if (res.down) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
          }
        }
        return { success: true, updated: input.eventTypes.length * input.channels.length };
      }),
  }),
});
