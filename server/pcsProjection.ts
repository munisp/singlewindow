/**
 * pcsProjection.ts — PCS read-model projection from ports.*.v1 Kafka events
 * (Phase 8; spec §3, §5, W1).
 *
 * The projection consumes the port-interoperability transactional outbox
 * topics (ports.booking.v1 / ports.gate.v1 / ports.queue.v1), verifies every
 * envelope's provenance JWS (fail closed — server/_core/pcsEnvelope.ts), and
 * projects into the pcs_* read-model tables. It is:
 *   - append-only + idempotent: replays produce no duplicate milestones
 *     (uniqueness on (consignment_id, source_event_id) / source_event_id);
 *   - ownership-anchored: booking/gate events project ONLY onto consignments
 *     reachable through a pcs_booking_links row (the trader↔booking
 *     association established server-side) — ownership is never inferred
 *     from fuzzy consignee strings;
 *   - honest: vessel-side milestones (arrived/berthed/ops_started/
 *     discharging/departed) are NEVER synthesized from truck-side booking or
 *     gate events — the UI renders the GAP-PCS-AIS / GAP-PCS-BERTH-OPS
 *     disclosures instead (spec §5.2/§5.3).
 *
 * Milestone mapping (booking domain → consignment milestone, spec §3 enum):
 *   booking.customs_validation_pending → customs_hold
 *   booking.customs_validated          → customs_released
 *   gate.scan_approved                 → gate_out (gate passage approved)
 *   booking.completed                  → gate_out (terminal visit completed)
 * Billing snapshots (read-only ledger projections, spec §5.5):
 *   booking.paid     → status PAID     (receipt ref + ledger commit hash)
 *   booking.refunded → status REFUNDED (compensating settlement)
 *
 * The core (projectPcsEvent) is a pure function over the PcsProjectionStore
 * interface so unit tests use an in-memory store; the Drizzle adapter and the
 * Kafka consumer wrapper are thin.
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import {
  pcsBillingSnapshots,
  pcsBookingLinks,
  pcsConsignments,
  pcsMilestones,
  type InsertPcsBillingSnapshot,
} from "../drizzle/schema";
import type { PcsEvent, PcsTopic } from "./_core/pcsEnvelope";
import { PCS_TOPICS, parseTrustKeys, verifyPcsEnvelope, PcsTrustConfigError } from "./_core/pcsEnvelope";
import { pcsProjectionEventsTotal, pcsProjectionLagSeconds, pcsSignatureRejectsTotal } from "./_core/metrics";

// ─── Milestone mapping (documented; truck-side events never fabricate
//     vessel-side milestones) ─────────────────────────────────────────────────

export const PCS_EVENT_MILESTONE_MAP: Readonly<Record<string, string>> = {
  "booking.customs_validation_pending": "customs_hold",
  "booking.customs_validated": "customs_released",
  "gate.scan_approved": "gate_out",
  "booking.completed": "gate_out",
};

export const PCS_BILLING_EVENT_MAP: Readonly<Record<string, string>> = {
  "booking.paid": "PAID",
  "booking.refunded": "REFUNDED",
};

// ─── Projection store interface (test seam) ──────────────────────────────────

export interface PcsBookingLinkRecord {
  id: number;
  traderUserId: number;
  bookingId: string;
  consignmentId: number | null;
}

export interface NewPcsConsignment {
  traderUserId: number;
  blNumber: string | null;
  containerNos: string[];
  consignee: string | null;
  portCode: string | null;
  portCallId: string | null;
  declarationUrn: string | null;
  lastMilestone: string | null;
  lastMilestoneAt: Date | null;
  sourceEventIds: string[];
}

export interface PcsConsignmentState {
  id: number;
  lastMilestone: string | null;
  lastMilestoneAt: Date | null;
  sourceEventIds: string[];
}

export interface PcsProjectionStore {
  findBookingLink(bookingId: string): Promise<PcsBookingLinkRecord | null>;
  createConsignment(values: NewPcsConsignment): Promise<number>;
  attachConsignmentToLink(linkId: number, consignmentId: number): Promise<void>;
  getConsignmentState(consignmentId: number): Promise<PcsConsignmentState | null>;
  /** Returns false when (consignmentId, sourceEventId) already exists. */
  insertMilestone(values: {
    consignmentId: number;
    milestone: string;
    occurredAt: Date;
    sourceTopic: string;
    sourceEventId: string;
    provenanceSignatureVerified: boolean;
  }): Promise<boolean>;
  updateConsignmentMilestone(
    consignmentId: number,
    milestone: string,
    occurredAt: Date,
    sourceEventId: string
  ): Promise<void>;
  /** Returns false when a snapshot with this sourceEventId already exists. */
  insertBillingSnapshot(values: Omit<InsertPcsBillingSnapshot, "id" | "recordedAt">): Promise<boolean>;
}

// ─── Projection core ─────────────────────────────────────────────────────────

export type PcsProjectionOutcome =
  | "projected" // milestone written
  | "billing_projected" // billing snapshot written
  | "duplicate" // replay — no-op (idempotent)
  | "unanchored" // no trader-owned booking link — never projected
  | "unmapped" // event type carries no consignment/billing projection
  | "invalid_payload"; // mapped event with unusable payload fields

export interface PcsProjectionResult {
  outcome: PcsProjectionOutcome;
  milestone?: string;
  consignmentId?: number;
  detail?: string;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asAmountKobo(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Projects one VERIFIED event into the read model. Verification happens
 * before this function is called (verifyPcsEnvelope); unverified input never
 * reaches the store.
 */
export async function projectPcsEvent(
  event: PcsEvent,
  topic: PcsTopic,
  store: PcsProjectionStore,
  nowMs: number = Date.now()
): Promise<PcsProjectionResult> {
  const billingStatus = PCS_BILLING_EVENT_MAP[event.eventType];
  if (billingStatus) {
    const amountKobo =
      asAmountKobo(event.extensions["amount-kobo"]) ?? asAmountKobo(event.payload.amount_kobo);
    if (amountKobo === null) {
      // A billing event without a parseable amount is never projected with a
      // guessed figure (spec §5.3 GAP-PCS-TARIFF: invoiced amounts only).
      return { outcome: "invalid_payload", detail: "billing event has no positive integer amount-kobo" };
    }
    const inserted = await store.insertBillingSnapshot({
      bookingId: event.subjectId,
      invoiceId: null, // port-interop events carry no invoice id — null, never invented
      amountKobo,
      currency: asString(event.payload.currency) ?? "NGN",
      status: billingStatus,
      receiptId: asString(event.extensions["payment-receipt-ref"]) ?? asString(event.payload.payment_receipt_ref),
      ledgerCommitHash: event.ledgerCommitHash,
      projectionLagMs: Math.max(0, Math.round(nowMs - event.occurredAtMs)),
      sourceEventId: event.eventId,
      occurredAt: new Date(event.occurredAtMs),
    });
    return { outcome: inserted ? "billing_projected" : "duplicate" };
  }

  const milestone = PCS_EVENT_MILESTONE_MAP[event.eventType];
  if (!milestone) return { outcome: "unmapped" };

  // Ownership anchor: the booking must be linked to a portal trader.
  const link = await store.findBookingLink(event.subjectId);
  if (!link) return { outcome: "unanchored" };

  let consignmentId = link.consignmentId;
  if (consignmentId === null) {
    // First milestone for this booking: create the consignment read-model row
    // owned by the linking trader, carrying only authority-sourced fields.
    consignmentId = await store.createConsignment({
      traderUserId: link.traderUserId,
      blNumber: null, // booking events carry no B/L — populated on manifest association
      containerNos: [],
      consignee: asString(event.payload.consignee_id),
      portCode: asString(event.extensions["port-code"]),
      portCallId: null,
      declarationUrn:
        asString(event.payload.cargo_declaration_ref) ?? asString(event.extensions["cargo-declaration-ref"]),
      lastMilestone: null,
      lastMilestoneAt: null,
      sourceEventIds: [event.eventId],
    });
    await store.attachConsignmentToLink(link.id, consignmentId);
  }

  const inserted = await store.insertMilestone({
    consignmentId,
    milestone,
    occurredAt: new Date(event.occurredAtMs),
    sourceTopic: topic,
    sourceEventId: event.eventId,
    provenanceSignatureVerified: true,
  });
  if (!inserted) return { outcome: "duplicate", milestone, consignmentId };

  // Roll the consignment's last-milestone pointer forward (never backward).
  const state = await store.getConsignmentState(consignmentId);
  const occurredAt = new Date(event.occurredAtMs);
  if (!state?.lastMilestoneAt || occurredAt.getTime() > state.lastMilestoneAt.getTime()) {
    await store.updateConsignmentMilestone(consignmentId, milestone, occurredAt, event.eventId);
  }
  return { outcome: "projected", milestone, consignmentId };
}

/** Orders a consignment's milestones for display: occurred_at ASC, ties by id. */
export function orderMilestones<T extends { occurredAt: Date; id: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byTime = a.occurredAt.getTime() - b.occurredAt.getTime();
    return byTime !== 0 ? byTime : a.id - b.id;
  });
}

// ─── Drizzle-backed store ────────────────────────────────────────────────────

type AppDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export function createDrizzlePcsProjectionStore(db: AppDb): PcsProjectionStore {
  return {
    async findBookingLink(bookingId) {
      const [row] = await db
        .select({
          id: pcsBookingLinks.id,
          traderUserId: pcsBookingLinks.traderUserId,
          bookingId: pcsBookingLinks.bookingId,
          consignmentId: pcsBookingLinks.consignmentId,
        })
        .from(pcsBookingLinks)
        .where(eq(pcsBookingLinks.bookingId, bookingId))
        .limit(1);
      return row ?? null;
    },
    async createConsignment(values) {
      const [row] = await db
        .insert(pcsConsignments)
        .values({
          traderUserId: values.traderUserId,
          blNumber: values.blNumber,
          containerNos: values.containerNos,
          consignee: values.consignee,
          portCode: values.portCode,
          portCallId: values.portCallId,
          declarationUrn: values.declarationUrn,
          lastMilestone: values.lastMilestone as never,
          lastMilestoneAt: values.lastMilestoneAt,
          sourceEventIds: values.sourceEventIds,
        })
        .returning({ id: pcsConsignments.id });
      return row.id;
    },
    async attachConsignmentToLink(linkId, consignmentId) {
      await db
        .update(pcsBookingLinks)
        .set({ consignmentId })
        .where(eq(pcsBookingLinks.id, linkId));
    },
    async getConsignmentState(consignmentId) {
      const [row] = await db
        .select({
          id: pcsConsignments.id,
          lastMilestone: pcsConsignments.lastMilestone,
          lastMilestoneAt: pcsConsignments.lastMilestoneAt,
          sourceEventIds: pcsConsignments.sourceEventIds,
        })
        .from(pcsConsignments)
        .where(eq(pcsConsignments.id, consignmentId))
        .limit(1);
      return row ?? null;
    },
    async insertMilestone(values) {
      const rows = await db
        .insert(pcsMilestones)
        .values({
          consignmentId: values.consignmentId,
          milestone: values.milestone as never,
          occurredAt: values.occurredAt,
          sourceTopic: values.sourceTopic,
          sourceEventId: values.sourceEventId,
          provenanceSignatureVerified: values.provenanceSignatureVerified,
        })
        .onConflictDoNothing()
        .returning({ id: pcsMilestones.id });
      return rows.length === 1;
    },
    async updateConsignmentMilestone(consignmentId, milestone, occurredAt, sourceEventId) {
      const state = await this.getConsignmentState(consignmentId);
      const sourceEventIds = [...(state?.sourceEventIds ?? []), sourceEventId];
      await db
        .update(pcsConsignments)
        .set({
          lastMilestone: milestone as never,
          lastMilestoneAt: occurredAt,
          sourceEventIds,
          updatedAt: new Date(),
        })
        .where(eq(pcsConsignments.id, consignmentId));
    },
    async insertBillingSnapshot(values) {
      const rows = await db
        .insert(pcsBillingSnapshots)
        .values(values)
        .onConflictDoNothing()
        .returning({ id: pcsBillingSnapshots.id });
      return rows.length === 1;
    },
  };
}

// ─── Kafka consumer (mirrors server/kafkaConsumer.ts posture) ────────────────

function countProjection(topic: string, outcome: string): void {
  try {
    pcsProjectionEventsTotal.inc({ topic, outcome });
  } catch { /* metrics never break the pipeline */ }
}

function countReject(reason: string): void {
  try {
    pcsSignatureRejectsTotal.inc({ reason });
  } catch { /* metrics never break the pipeline */ }
}

let consumerStarted = false;
let trustKeysCache: ReturnType<typeof parseTrustKeys> | null = null;
let trustKeysFailed = false;

/**
 * Starts the PCS projection consumer for ports.booking.v1 / ports.gate.v1 /
 * ports.queue.v1. Gracefully no-ops when Kafka is unavailable (development);
 * events that fail verification are REJECTED (counted, never projected).
 */
export async function startPcsProjectionConsumer(): Promise<void> {
  if (consumerStarted) return;
  consumerStarted = true;

  const brokers = (process.env.KAFKA_BROKERS ?? "kafka:9092").split(",");
  const groupId = process.env.PCS_KAFKA_GROUP_ID ?? "tradegateway-pcs-projection";

  try {
    const { Kafka } = await import("kafkajs");
    const kafka = new Kafka({
      clientId: "tradegateway-pcs",
      brokers,
      retry: { retries: 3, initialRetryTime: 300 },
    });
    const consumer = kafka.consumer({ groupId });
    await consumer.connect();
    await consumer.subscribe({ topics: [...PCS_TOPICS], fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        if (!message.value) return;
        const { SpanKind, context: otelContext } = await import("@opentelemetry/api");
        const { withSpan, extractKafkaContext } = await import("./_core/telemetry");
        const parentCtx = extractKafkaContext(message.headers as Record<string, unknown> | undefined);
        await otelContext.with(parentCtx, () =>
          withSpan(
            `kafka.consume ${topic} (pcs-projection)`,
            {
              kind: SpanKind.CONSUMER,
              attributes: {
                "messaging.system": "kafka",
                "messaging.destination.name": topic,
              },
            },
            async () => {
              // Trust keys are parsed once; a parse failure fails CLOSED —
              // every event is rejected until the keyring is fixed.
              if (!trustKeysCache && !trustKeysFailed) {
                try {
                  const { ENV } = await import("./_core/env");
                  trustKeysCache = parseTrustKeys(ENV.pcsEnvelopeTrustKeys);
                } catch (err) {
                  trustKeysFailed = true;
                  console.error(
                    "[PcsProjection] PCS_ENVELOPE_TRUST_KEYS unusable — all events rejected (fail closed):",
                    err instanceof PcsTrustConfigError ? err.message : err
                  );
                }
              }
              if (!trustKeysCache) {
                countReject("missing_trust_keys");
                countProjection(topic, "rejected");
                return;
              }
              const verdict = verifyPcsEnvelope(message.value!, trustKeysCache);
              if (!verdict.ok) {
                countReject(verdict.reason);
                countProjection(topic, "rejected");
                console.warn(`[PcsProjection] rejected ${topic} event: ${verdict.reason} — ${verdict.detail}`);
                return;
              }
              const db = await getDb();
              if (!db) {
                console.warn("[PcsProjection] database unavailable — event skipped (dev mode)");
                return;
              }
              const result = await projectPcsEvent(
                verdict.event,
                topic as PcsTopic,
                createDrizzlePcsProjectionStore(db)
              );
              countProjection(topic, result.outcome);
              try {
                pcsProjectionLagSeconds
                  .labels({ topic })
                  .observe(Math.max(0, (Date.now() - verdict.event.occurredAtMs) / 1000));
              } catch { /* metrics never break the pipeline */ }
            }
          )
        );
      },
    });
    console.log(`[PcsProjection] consumer started — topics: ${PCS_TOPICS.join(", ")}`);
  } catch (err) {
    // Kafka unavailable in dev/test — log and continue (repo convention).
    console.warn("[PcsProjection] Kafka unavailable — PCS read model will only receive in-process writes:", (err as Error).message);
  }
}

/** Test hook: resets the lazy trust-key cache. */
export function __resetPcsProjectionTrustCache(): void {
  trustKeysCache = null;
  trustKeysFailed = false;
}
