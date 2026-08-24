// TradeGateway NGSWTP — Kafka Consumer for Insider Threat Events
// Language: TypeScript (Node.js)
//
// Subscribes to two Kafka topics:
//   - insider.threat.detected  — Python anomaly service detected an anomaly
//   - insider.threat.blocked   — Go RBAC middleware blocked a high-risk action
//
// On each message, emits the parsed event onto the anomalyBus (server/sse.ts)
// so that all connected SSE clients receive it in real time.
//
// Also persists each event to the insider_threat_events DB table for the
// Security Monitor audit log.
//
// Note: This module uses the kafkajs library. In production, Kafka connection
// details are injected via environment variables (KAFKA_BROKERS, KAFKA_GROUP_ID).
// In development/test, the consumer gracefully no-ops if Kafka is unavailable.

import { anomalyBus, SSE_EVENT_ANOMALY, SSE_EVENT_BLOCKED, SSE_EVENT_FOUR_EYES } from "./sse";
import { getDb } from "./db";
import { insiderThreatEvents, openAppSecEvents } from "../drizzle/schema";
import { wafEventSchema } from "./wafEventSchema";

// Lazy singleton DB instance
const getDbInstance = (() => {
  let instance: Awaited<ReturnType<typeof getDb>> | null = null;
  return async () => {
    if (!instance) instance = await getDb();
    return instance;
  };
})();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnomalyDetectedMessage {
  event_type: "anomaly_detected";
  user_id: string;
  session_id?: string;
  rule_id?: string;
  rule_name?: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  anomaly_score: number;
  description: string;
  features?: Record<string, number>;
  timestamp: number;
}

export interface ThreatBlockedMessage {
  event_type: "insider.threat.blocked";
  user_id: string;
  session_id?: string;
  action: string;
  endpoint: string;
  ip_address: string;
  anomaly_score: number;
  rule_id?: string;
  description?: string;
  timestamp: number;
}

export interface FourEyesMessage {
  event_type: "four_eyes_requested" | "four_eyes_approved" | "four_eyes_denied";
  approval_ref: string;
  requester_id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  description: string;
  timestamp: number;
}

// ─── Kafka Consumer ───────────────────────────────────────────────────────────

let consumerStarted = false;
const WAF_INGESTION_FRESHNESS_MS = Number(process.env.WAF_INGESTION_FRESHNESS_MS ?? 900_000);
let wafIngestionStatus: "unconfigured" | "unavailable" | "healthy" | "stale" = process.env.KAFKA_BROKERS ? "unavailable" : "unconfigured";
let wafLastEventAt: Date | null = null;
let wafIngestionReason: string | null = process.env.KAFKA_BROKERS ? null : "kafka_not_configured";

export function getWafIngestionHealth() {
  const status = wafIngestionStatus === "healthy" &&
    wafLastEventAt !== null &&
    Date.now() - wafLastEventAt.getTime() > WAF_INGESTION_FRESHNESS_MS
    ? "stale"
    : wafIngestionStatus;
  return {
    configured: Boolean(process.env.KAFKA_BROKERS),
    status,
    lastEventAt: wafLastEventAt?.toISOString() ?? null,
    reason: wafIngestionReason,
  };
}

/**
 * Start the Kafka consumer for insider threat topics.
 * Gracefully no-ops if Kafka is unavailable (development mode).
 */
export async function startInsiderThreatKafkaConsumer(): Promise<void> {
  if (consumerStarted) return;
  consumerStarted = true;

  if (!process.env.KAFKA_BROKERS) {
    wafIngestionStatus = "unconfigured";
    wafIngestionReason = "kafka_not_configured";
    console.warn("[KafkaConsumer] Kafka is not configured");
    return;
  }

  const brokers = process.env.KAFKA_BROKERS.split(",");
  const groupId = process.env.KAFKA_GROUP_ID ?? "tradegateway-sse-consumer";

  try {
    // Dynamic import so the server starts even if kafkajs is not installed
    const { Kafka } = await import("kafkajs");

    const kafka = new Kafka({
      clientId: "tradegateway-sse",
      brokers,
      retry: { retries: 3, initialRetryTime: 300 },
    });

    const consumer = kafka.consumer({ groupId });

    await consumer.connect();
    await consumer.subscribe({
      topics: ["insider.threat.detected", "insider.threat.blocked", "insider.four_eyes", "waf-events"],
      fromBeginning: false,
    });

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        if (!message.value) return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(message.value.toString());
        } catch {
          console.error("[KafkaConsumer] Failed to parse message from topic:", topic);
          return;
        }

        if (topic === "waf-events") {
          await handleWafMessage(parsed);
        } else {
          await handleInsiderThreatMessage(topic, parsed);
        }
      },
    });

    wafIngestionStatus = "healthy";
    wafIngestionReason = null;
    console.log("[KafkaConsumer] Consumer started — topics: insider.threat.detected, insider.threat.blocked, insider.four_eyes, waf-events");
  } catch (err) {
    // Kafka unavailable in dev/test — log and continue
    wafIngestionStatus = process.env.KAFKA_BROKERS ? "unavailable" : "unconfigured";
    console.warn("[KafkaConsumer] Kafka unavailable — SSE will only receive in-process events:", (err as Error).message);
  }
}

export async function handleWafMessage(data: unknown): Promise<void> {
  const parsed = wafEventSchema.safeParse(data);
  if (!parsed.success) {
    console.error("[KafkaConsumer] Rejected invalid WAF event:", parsed.error.issues.map((issue) => issue.message).join(", "));
    return;
  }
  const event = parsed.data;
  const eventId = event.event_id ?? event.eventId;
  const attackType = event.attack_type ?? event.attackType;
  if (!eventId || !attackType) {
    console.error("[KafkaConsumer] Rejected WAF event without event_id or attack_type");
    return;
  }
  const db = await getDbInstance();
  if (!db) {
    wafIngestionStatus = "unavailable";
    wafIngestionReason = "waf_database_unavailable";
    console.error("[KafkaConsumer] WAF event dropped: database unavailable");
    return;
  }
  try {
    await db.insert(openAppSecEvents).values({
      eventId,
      severity: event.severity,
      attackType,
      sourceIp: event.source_ip ?? null,
      targetPath: event.target_path ?? null,
      httpMethod: event.http_method ?? null,
      requestHeaders: event.request_headers ?? {},
      requestBody: event.request_body ?? null,
      action: event.action ?? "block",
      confidence: event.confidence ?? null,
      waapVersion: event.waap_version ?? null,
    }).onConflictDoNothing({ target: openAppSecEvents.eventId });
    wafIngestionStatus = "healthy";
    wafIngestionReason = null;
    wafLastEventAt = new Date();
  } catch (error) {
    wafIngestionStatus = "unavailable";
    wafIngestionReason = "waf_persistence_failed";
    console.error("[KafkaConsumer] WAF event persistence failed:", error);
  }
}

/**
 * Handle a single message from a Kafka topic.
 * Emits to anomalyBus and persists to DB.
 */
async function handleInsiderThreatMessage(topic: string, data: unknown): Promise<void> {
  try {
    if (topic === "insider.threat.detected") {
      const msg = data as AnomalyDetectedMessage;

      // Emit to SSE clients
      anomalyBus.emit(SSE_EVENT_ANOMALY, {
        type: "anomaly_detected",
        userId: msg.user_id,
        sessionId: msg.session_id,
        ruleId: msg.rule_id,
        ruleName: msg.rule_name,
        severity: msg.severity,
        anomalyScore: msg.anomaly_score,
        description: msg.description,
        features: msg.features,
        ts: msg.timestamp,
      });

      // Persist to DB
      const _db = await getDbInstance(); if (!_db) return; await _db.insert(insiderThreatEvents).values({
        eventType: "anomaly_detected",
        tbEventCode: 2001,
        actorId: null,
        actorRole: null,
        targetEntityType: "session",
        targetEntityId: msg.session_id ?? null,
        action: "anomaly_detected",
        description: msg.description,
        ipAddress: null,
        sessionId: msg.session_id ?? null,
        severity: msg.severity,
        metadata: {
          userId: msg.user_id,
          ruleId: msg.rule_id,
          anomalyScore: msg.anomaly_score,
          features: msg.features,
        },
      }).catch((err: Error) => {
        console.error("[KafkaConsumer] Failed to persist anomaly_detected event:", err.message);
      });

    } else if (topic === "insider.threat.blocked") {
      const msg = data as ThreatBlockedMessage;

      // Emit to SSE clients
      anomalyBus.emit(SSE_EVENT_BLOCKED, {
        type: "threat_blocked",
        userId: msg.user_id,
        sessionId: msg.session_id,
        action: msg.action,
        endpoint: msg.endpoint,
        ipAddress: msg.ip_address,
        anomalyScore: msg.anomaly_score,
        ruleId: msg.rule_id,
        description: msg.description,
        ts: msg.timestamp,
      });

      // Persist to DB
      const _db = await getDbInstance(); if (!_db) return; await _db.insert(insiderThreatEvents).values({
        eventType: "threat_blocked",
        tbEventCode: 2002,
        actorId: null,
        actorRole: null,
        targetEntityType: "endpoint",
        targetEntityId: msg.endpoint ?? null,
        action: msg.action,
        description: msg.description ?? `Blocked: anomaly_score=${msg.anomaly_score}`,
        ipAddress: msg.ip_address ?? null,
        sessionId: msg.session_id ?? null,
        severity: msg.anomaly_score >= 0.95 ? "CRITICAL" : "HIGH",
        metadata: {
          userId: msg.user_id,
          anomalyScore: msg.anomaly_score,
          ruleId: msg.rule_id,
        },
      }).catch((err: Error) => {
        console.error("[KafkaConsumer] Failed to persist threat_blocked event:", err.message);
      });

    } else if (topic === "insider.four_eyes") {
      const msg = data as FourEyesMessage;

      // Emit to SSE clients
      anomalyBus.emit(SSE_EVENT_FOUR_EYES, {
        type: msg.event_type,
        approvalRef: msg.approval_ref,
        requesterId: msg.requester_id,
        action: msg.action,
        entityType: msg.entity_type,
        entityId: msg.entity_id,
        description: msg.description,
        ts: msg.timestamp,
      });
    }
  } catch (err) {
    console.error("[KafkaConsumer] Error handling message from topic", topic, ":", (err as Error).message);
  }
}

/**
 * Emit an insider threat event directly onto the bus (for in-process events,
 * e.g. when the tRPC router creates a 4-eyes request without going through Kafka).
 */
export function emitInsiderThreatEvent(
  eventName: typeof SSE_EVENT_ANOMALY | typeof SSE_EVENT_BLOCKED | typeof SSE_EVENT_FOUR_EYES,
  data: Record<string, unknown>
): void {
  anomalyBus.emit(eventName, data);
}
