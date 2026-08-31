/**
 * geoVesselProjection.ts — Node read-model projection for vessel_tracking_events
 * from the vessels.events Kafka topic (PRA-096, Phase 9).
 *
 * This is the REAL ingestion path behind the GAP-AIS-FEED registry entry:
 * blueeconomy-geo-service publishes envelope v1.0 (RFC 8785 JCS + Ed25519
 * JWS) geo.*.v1 events; this consumer verifies every envelope fail-closed
 * (server/_core/geoEnvelope.ts, contract-mirrored with the Go
 * cargo-tracking-service) and projects verified geo.vessel-position.v1
 * payloads into vessel_tracking_events. It is:
 *   - fail-closed: unverifiable/tampered messages are NEVER persisted — they
 *     are counted (geo_vessel_signature_rejects_total), logged and routed to
 *     the DLQ topic (vessels.events.dlq) with the rejection reason;
 *   - at-least-once + idempotent: the Kafka offset is only committed after a
 *     durable write; replays no-op on the uq_vte_source_event_id partial
 *     unique index;
 *   - honest: contract-verified non-position geo events are acknowledged
 *     without persistence (this projection owns position tracking only).
 *
 * The consumer is OFF until GEO_ENVELOPE_TRUST_KEYS is configured and Kafka
 * is reachable (see PLATFORM_GAPS.AIS_FEED). The projection core
 * (projectVesselPosition) is a pure function over the store interface; the
 * Drizzle adapter and the KafkaJS wrapper are thin.
 */

import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { vesselTrackingEvents } from "../drizzle/schema";
import {
  GEO_EVENT_VESSEL_POSITION,
  GEO_VESSEL_TOPIC,
  GEO_VESSEL_DLQ_TOPIC,
  GeoTrustConfigError,
  parseGeoTrustKeys,
  verifyGeoEnvelope,
  extractVesselPosition,
  type GeoEnvelope,
  type VesselPositionPayload,
} from "./_core/geoEnvelope";
import { geoVesselEventsTotal, geoVesselSignatureRejectsTotal } from "./_core/metrics";
import { ENV } from "./_core/env";

// ─── Unit conversion (contract milli/micro units → read-model units) ────────

export function microsToDegrees(micros: number): number {
  return micros / 1_000_000;
}
export function milliknotsToKnots(milliknots: number): number {
  return milliknots / 1_000;
}
export function millidegreesToDegrees(millidegrees: number): number {
  return millidegrees / 1_000;
}

// ─── Projection store interface (test seam) ─────────────────────────────────

export interface VesselPositionRow {
  mmsi: string;
  vesselName: string | null;
  imoNumber: string | null;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  recordedAt: Date;
  sourceEventId: string;
  positionReportId: string;
  sourceKid: string;
}

export interface GeoVesselProjectionStore {
  /** Returns false when a row with this sourceEventId already exists. */
  insertPosition(row: VesselPositionRow): Promise<boolean>;
  findBySourceEventId(sourceEventId: string): Promise<VesselPositionRow | null>;
}

export type GeoProjectionOutcome = "projected" | "duplicate";

/** Maps a verified payload to a read-model row (unit conversion lives here). */
export function toVesselPositionRow(
  envelope: GeoEnvelope,
  payload: VesselPositionPayload,
  kid: string
): VesselPositionRow {
  return {
    mmsi: payload.mmsi,
    vesselName: payload.shipName ?? null,
    imoNumber: payload.imo ?? null,
    latitude: microsToDegrees(payload.latitudeMicros),
    longitude: microsToDegrees(payload.longitudeMicros),
    speed: milliknotsToKnots(payload.speedOverGroundMilliknots),
    heading: millidegreesToDegrees(payload.headingMillidegrees ?? payload.courseOverGroundMillidegrees),
    recordedAt: new Date(payload.observedAt),
    sourceEventId: envelope.eventId,
    positionReportId: payload.positionReportId,
    sourceKid: kid,
  };
}

/** Projection core: idempotent insert of one verified position event. */
export async function projectVesselPosition(
  envelope: GeoEnvelope,
  payload: VesselPositionPayload,
  kid: string,
  store: GeoVesselProjectionStore
): Promise<GeoProjectionOutcome> {
  const inserted = await store.insertPosition(toVesselPositionRow(envelope, payload, kid));
  return inserted ? "projected" : "duplicate";
}

// ─── Drizzle adapter ─────────────────────────────────────────────────────────

export function createDrizzleGeoVesselStore(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): GeoVesselProjectionStore {
  return {
    async insertPosition(row) {
      const rows = await db
        .insert(vesselTrackingEvents)
        .values(row)
        // The partial unique index (uq_vte_source_event_id) requires the
        // matching predicate on the ON CONFLICT clause.
        .onConflictDoNothing({
          target: vesselTrackingEvents.sourceEventId,
          where: sql`"source_event_id" IS NOT NULL`,
        })
        .returning({ id: vesselTrackingEvents.id });
      return rows.length === 1;
    },
    async findBySourceEventId(sourceEventId) {
      const [row] = await db
        .select()
        .from(vesselTrackingEvents)
        .where(eq(vesselTrackingEvents.sourceEventId, sourceEventId))
        .limit(1);
      return (row as VesselPositionRow | undefined) ?? null;
    },
  };
}

// ─── Kafka consumer (mirrors server/pcsProjection.ts posture) ────────────────

function countProjection(topic: string, outcome: string): void {
  try {
    geoVesselEventsTotal.inc({ topic, outcome });
  } catch { /* metrics never break the pipeline */ }
}

function countReject(reason: string): void {
  try {
    geoVesselSignatureRejectsTotal.inc({ reason });
  } catch { /* metrics never break the pipeline */ }
}

export interface GeoVesselConsumerOptions {
  brokers?: string[];
  groupId?: string;
  topic?: string;
  dlqTopic?: string;
  /** Raw GEO_ENVELOPE_TRUST_KEYS value; defaults to ENV.geoEnvelopeTrustKeys. */
  trustKeysRaw?: string;
  fromBeginning?: boolean;
}

export interface GeoVesselConsumerHandle {
  stop(): Promise<void>;
}

let consumerStarted = false;

/**
 * Starts the geo vessel projection consumer for vessels.events. No-ops
 * (with a logged reason) when Kafka is unavailable; events that fail
 * verification are REJECTED to the DLQ and never persisted (fail closed).
 * Returns a handle so tests can stop the consumer.
 */
export async function startGeoVesselProjectionConsumer(
  options: GeoVesselConsumerOptions = {}
): Promise<GeoVesselConsumerHandle> {
  const brokers = options.brokers ?? ENV.kafkaBrokers;
  const groupId = options.groupId ?? ENV.geoVesselKafkaGroupId;
  const topic = options.topic ?? ENV.geoVesselEventsTopic ?? GEO_VESSEL_TOPIC;
  const dlqTopic = options.dlqTopic ?? ENV.geoVesselEventsDlqTopic ?? GEO_VESSEL_DLQ_TOPIC;
  const trustKeysRaw = options.trustKeysRaw ?? ENV.geoEnvelopeTrustKeys;
  const singleton = !options.groupId && !options.brokers && !options.trustKeysRaw;
  if (singleton && consumerStarted) return { stop: async () => {} };
  if (singleton) consumerStarted = true;

  const { Kafka } = await import("kafkajs");
  const kafka = new Kafka({
    clientId: "tradegateway-geo-vessel",
    brokers,
    retry: { retries: 3, initialRetryTime: 300 },
  });
  const consumer = kafka.consumer({ groupId, allowAutoTopicCreation: false });
  const producer = kafka.producer();
  let trustKeys: Map<string, import("node:crypto").KeyObject> | null = null;
  let trustKeysFailed = false;

  try {
    await consumer.connect();
    await producer.connect();
    await consumer.subscribe({ topics: [topic], fromBeginning: options.fromBeginning ?? false });
  } catch (err) {
    await consumer.disconnect().catch(() => {});
    await producer.disconnect().catch(() => {});
    throw err;
  }

  const toDlq = async (rawValue: Buffer, reason: string, detail: string, partition: number, offset: string) => {
    const dlqEnvelope = {
      original_topic: topic,
      partition,
      offset: Number(offset),
      payload: rawValue.toString("utf8"),
      error: `envelope verification failed: ${reason} — ${detail}`,
      failed_at: new Date().toISOString(),
      service_name: "singlewindow-gateway",
    };
    await producer.send({ topic: dlqTopic, messages: [{ value: JSON.stringify(dlqEnvelope) }] });
  };

  await consumer.run({
    autoCommit: false, // offsets are committed only after a durable outcome
    eachMessage: async ({ topic: msgTopic, partition, message }) => {
      if (!message.value) return;
      const offset = message.offset;
      const commit = async () =>
        consumer.commitOffsets([{ topic: msgTopic, partition, offset: (Number(offset) + 1).toString() }]);

      // Trust keys are parsed once; a parse failure fails CLOSED — every
      // event is rejected (NOT committed) until the keyring is fixed.
      if (!trustKeys && !trustKeysFailed) {
        try {
          trustKeys = parseGeoTrustKeys(trustKeysRaw);
        } catch (err) {
          trustKeysFailed = true;
          console.error(
            "[GeoVesselProjection] GEO_ENVELOPE_TRUST_KEYS unusable — all events rejected (fail closed):",
            err instanceof GeoTrustConfigError ? err.message : err
          );
        }
      }
      if (!trustKeys) {
        countReject("missing_trust_keys");
        countProjection(msgTopic, "rejected");
        return; // not committed — retried after restart once keys are fixed
      }

      const verdict = verifyGeoEnvelope(message.value, trustKeys);
      if (!verdict.ok) {
        countReject(verdict.reason);
        countProjection(msgTopic, "rejected");
        console.warn(`[GeoVesselProjection] rejected ${msgTopic} event: ${verdict.reason} — ${verdict.detail}`);
        try {
          await toDlq(message.value, verdict.reason, verdict.detail, partition, offset);
        } catch (err) {
          // DLQ failure: offset is NOT committed — the tampered message is
          // reprocessed after restart, never silently dropped.
          console.error(`[GeoVesselProjection] DLQ publish failed — offset not committed: ${(err as Error).message}`);
          return;
        }
        await commit();
        return;
      }

      if (verdict.envelope.eventType !== GEO_EVENT_VESSEL_POSITION) {
        // Contract-verified but not a position event: acknowledge without
        // persisting (this projection owns position tracking only).
        countProjection(msgTopic, "acknowledged_non_position");
        await commit();
        return;
      }

      const extracted = extractVesselPosition(verdict.envelope);
      if (!extracted.ok) {
        countReject(extracted.reason);
        countProjection(msgTopic, "rejected");
        console.warn(`[GeoVesselProjection] rejected ${msgTopic} payload: ${extracted.reason} — ${extracted.detail}`);
        try {
          await toDlq(message.value, extracted.reason, extracted.detail, partition, offset);
        } catch (err) {
          console.error(`[GeoVesselProjection] DLQ publish failed — offset not committed: ${(err as Error).message}`);
          return;
        }
        await commit();
        return;
      }

      const db = await getDb();
      if (!db) {
        // Durable write impossible: do NOT commit — the message is replayed.
        console.error("[GeoVesselProjection] database unavailable — offset not committed (event will be replayed)");
        return;
      }
      try {
        const outcome = await projectVesselPosition(
          verdict.envelope,
          extracted.payload,
          verdict.kid,
          createDrizzleGeoVesselStore(db)
        );
        countProjection(msgTopic, outcome);
        await commit();
      } catch (err) {
        console.error(`[GeoVesselProjection] persist failed — offset not committed: ${(err as Error).message}`);
      }
    },
  });
  console.log(`[GeoVesselProjection] consumer started — topic: ${topic}, group: ${groupId}, dlq: ${dlqTopic}`);

  return {
    async stop() {
      await consumer.stop().catch(() => {});
      await consumer.disconnect().catch(() => {});
      await producer.disconnect().catch(() => {});
      if (singleton) consumerStarted = false;
    },
  };
}
