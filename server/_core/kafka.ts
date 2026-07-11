/**
 * kafka.ts — Production KafkaJS client for TradeGateway NGSWTP
 *
 * Provides:
 *   - getKafkaProducer()  — lazy singleton producer (auto-connects)
 *   - publishEvent()      — publish a typed domain event to a Kafka topic
 *   - kafkaHealthCheck()  — connectivity check for /api/health
 *   - closeKafka()        — graceful shutdown
 *
 * Topic naming convention: tradegateway.<domain>.<event>
 *   e.g. tradegateway.declarations.submitted
 *        tradegateway.payments.completed
 *        tradegateway.kyc.approved
 *
 * Falls back gracefully when KAFKA_BROKERS is not reachable.
 */
import { Kafka, Producer, Partitioners, logLevel } from "kafkajs";

// ── Configuration ─────────────────────────────────────────────────────────────
const BROKERS   = (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",");
const CLIENT_ID = process.env.KAFKA_CLIENT_ID ?? "tradegateway-api";

// ── Topic Registry ────────────────────────────────────────────────────────────
export const TOPICS = {
  // Declaration lifecycle
  DECLARATION_SUBMITTED:   "tradegateway.declarations.submitted",
  DECLARATION_UPDATED:     "tradegateway.declarations.updated",
  DECLARATION_CLEARED:     "tradegateway.declarations.cleared",
  DECLARATION_REJECTED:    "tradegateway.declarations.rejected",
  // Risk & compliance
  RISK_SCORE_COMPUTED:     "tradegateway.risk.score_computed",
  SANCTIONS_HIT:           "tradegateway.sanctions.hit",
  FRAUD_CASE_OPENED:       "tradegateway.fraud.case_opened",
  // Payments
  PAYMENT_INITIATED:       "tradegateway.payments.initiated",
  PAYMENT_COMPLETED:       "tradegateway.payments.completed",
  PAYMENT_FAILED:          "tradegateway.payments.failed",
  // KYC
  KYC_SUBMITTED:           "tradegateway.kyc.submitted",
  KYC_APPROVED:            "tradegateway.kyc.approved",
  KYC_REJECTED:            "tradegateway.kyc.rejected",
  // Cargo
  CARGO_DEPARTED:          "tradegateway.cargo.departed",
  CARGO_ARRIVED:           "tradegateway.cargo.arrived",
  CARGO_CUSTOMS_HOLD:      "tradegateway.cargo.customs_hold",
  // Audit
  AUDIT_EVENT:             "tradegateway.audit.event",
  // Notifications
  NOTIFICATION_CREATED:    "tradegateway.notifications.created",
  // Webhooks
  WEBHOOK_TRIGGER:         "tradegateway.webhooks.trigger",
  // OGA permits
  OGA_PERMIT_REQUESTED:    "tradegateway.oga.permit_requested",
  OGA_PERMIT_APPROVED:     "tradegateway.oga.permit_approved",
  OGA_PERMIT_REJECTED:     "tradegateway.oga.permit_rejected",
  // Security / insider threat
  SECURITY_ALERT:          "tradegateway.security.alert",
  INSIDER_THREAT_DETECTED: "tradegateway.security.insider_threat_detected",
  // TigerBeetle financial events
  BOND_DEPOSITED:          "tradegateway.ledger.bond_deposited",
  BOND_RELEASED:           "tradegateway.ledger.bond_released",
  PENALTY_ASSESSED:        "tradegateway.ledger.penalty_assessed",
  // Bonded warehouse
  WAREHOUSE_DEPOSIT:       "tradegateway.warehouse.deposit",
  WAREHOUSE_RELEASE:       "tradegateway.warehouse.release",
} as const;

export type KafkaTopic = (typeof TOPICS)[keyof typeof TOPICS];

// ── Singleton state ───────────────────────────────────────────────────────────
let _kafka: Kafka | null = null;
let _producer: Producer | null = null;
let _producerConnected = false;
let _connectionFailed = false;

function getKafka(): Kafka {
  if (!_kafka) {
    _kafka = new Kafka({
      clientId: CLIENT_ID,
      brokers: BROKERS,
      logLevel: logLevel.WARN,
      retry: {
        initialRetryTime: 300,
        retries: 5,
      },
      connectionTimeout: 5_000,
      requestTimeout: 10_000,
    });
  }
  return _kafka;
}

/**
 * Returns the singleton Kafka producer, connecting if needed.
 * Returns null if Kafka is unavailable (graceful degradation).
 */
export async function getKafkaProducer(): Promise<Producer | null> {
  if (_connectionFailed) return null;
  if (_producerConnected && _producer) return _producer;

  try {
    const kafka = getKafka();
    _producer = kafka.producer({
      createPartitioner: Partitioners.LegacyPartitioner,
      allowAutoTopicCreation: true,
      transactionTimeout: 30_000,
    });

    await _producer.connect();
    _producerConnected = true;
    console.log("[Kafka] Producer connected to", BROKERS.join(", "));
    return _producer;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[Kafka] Producer connection failed (graceful degradation):", msg);
    _connectionFailed = true;
    _producer = null;
    return null;
  }
}

// ── Domain event type ─────────────────────────────────────────────────────────
export interface DomainEvent<T = Record<string, unknown>> {
  eventId:     string;
  eventType:   string;
  aggregateId: string;
  timestamp:   string;
  version:     number;
  payload:     T;
  metadata?: {
    userId?:        string;
    correlationId?: string;
    causationId?:   string;
    source?:        string;
  };
}

/**
 * Publishes a typed domain event to a Kafka topic.
 * Silently skips if Kafka is unavailable.
 */
export async function publishEvent<T = Record<string, unknown>>(
  topic: KafkaTopic,
  event: Omit<DomainEvent<T>, "eventId" | "timestamp" | "version"> & {
    version?: number;
  }
): Promise<boolean> {
  const producer = await getKafkaProducer();
  if (!producer) return false; // graceful degradation

  const fullEvent: DomainEvent<T> = {
    eventId:     crypto.randomUUID(),
    timestamp:   new Date().toISOString(),
    version:     event.version ?? 1,
    ...event,
  };

  try {
    await producer.send({
      topic,
      messages: [
        {
          key:   fullEvent.aggregateId,
          value: JSON.stringify(fullEvent),
          headers: {
            "event-type":   fullEvent.eventType,
            "content-type": "application/json",
            "source":       CLIENT_ID,
            "correlation-id": fullEvent.metadata?.correlationId ?? fullEvent.eventId,
          },
        },
      ],
    });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Kafka] Failed to publish event:", msg, { topic, eventType: fullEvent.eventType });
    return false;
  }
}

/**
 * Health check — pings the Kafka broker list.
 * Returns true if at least one broker is reachable.
 */
export async function kafkaHealthCheck(): Promise<{ ok: boolean; latencyMs?: number }> {
  const start = Date.now();
  try {
    const kafka = getKafka();
    const admin = kafka.admin();
    await admin.connect();
    await admin.listTopics();
    await admin.disconnect();
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false };
  }
}

/**
 * Graceful shutdown — disconnect the producer.
 */
export async function closeKafka(): Promise<void> {
  if (_producer && _producerConnected) {
    try {
      await _producer.disconnect();
      console.log("[Kafka] Producer disconnected.");
    } catch (err) {
      console.error("[Kafka] Error disconnecting producer:", err);
    } finally {
      _producer = null;
      _producerConnected = false;
    }
  }
}
