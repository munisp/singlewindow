/**
 * cvContainerConsumer.ts — WP-4 consumer for signed blueeconomy-cv-service
 * container OCR reads (Kafka topic cv.container-code.v1).
 *
 * Pipeline per record (fail-closed):
 *   1. Verify the envelope v1.0 JWS-EdDSA/JCS signature against the mounted
 *      producer key directory (server/_core/cvEnvelope). Rejected records are
 *      logged with their reason code and never projected.
 *   2. Project the read into container_ocr_reads (idempotent on event_id).
 *   3. Cargo/declaration cross-check: the OCR code is matched against
 *      declaration vision analyses (vision_analyses.containerAnalysis
 *      .containerNumber, normalized ISO 6346). Risk signals are written into
 *      declaration_risk_history:
 *        - CONTAINER_CHECK_DIGIT_INVALID — matched declaration, check digit bad
 *        - CONTAINER_OCR_NEEDS_REVIEW    — matched declaration, producer
 *                                          status "needs-review" / low confidence
 *      Confirmed reads with no declaring record are projected as "unmatched"
 *      (operators reconcile; no declaration can be honestly attributed).
 *
 * Configuration: KAFKA_BROKERS, KAFKA_GROUP_ID (default
 * tradegateway-cv-container), KEY_DIRECTORY_PATH (mandatory when the consumer
 * is enabled), CV_CONTAINER_CONSUMER_ENABLED=true to start (default off so
 * dev/test without Kafka is unaffected; production sets it explicitly).
 */
import { Kafka, logLevel } from "kafkajs";
import { sql } from "drizzle-orm";

import {
  EnvelopeRejection,
  loadKeyDirectoryFromEnv,
  verifyEnvelope,
  type KeyDirectory,
  type VerifiedEnvelope,
} from "./_core/cvEnvelope";

export const CV_CONTAINER_TOPIC = "cv.container-code.v1";

// ── ISO 6346 normalization ───────────────────────────────────────────────────

/** Normalize a container code to AAAU999999C (uppercase, no separators). */
export function normalizeContainerCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

// ── Cross-check engine (DB-injectable for tests) ────────────────────────────

export interface ContainerCrossCheckDb {
  /** Declaration IDs whose vision analyses read this normalized code. */
  findDeclarationsByContainer(code: string): Promise<number[]>;
  insertOcrRead(row: {
    eventId: string; cameraId: string; containerCode: string; status: string;
    confidence: number | null; checkDigitValid: boolean; modelVersion: string | null;
    matchStatus: string; declarationId: number | null; occurredAt: Date | null;
  }): Promise<"inserted" | "duplicate">;
  insertRiskSignal(row: {
    declarationId: number; riskScore: number; riskLane: string;
    triggeredBy: string; factors: unknown;
  }): Promise<void>;
}

export interface ContainerCodeResource {
  "@type"?: string;
  cameraId?: string;
  code?: string;
  status?: string;
  confidence?: number;
  checkDigitValid?: boolean;
  modelVersion?: string;
}

export interface ProjectionResult {
  projected: boolean;
  matchStatus?: "matched" | "unmatched" | "invalid_code";
  declarationId?: number | null;
  riskSignals: number;
  duplicate?: boolean;
}

/**
 * Project one verified cv.container-code.v1 envelope. Pure given the Db
 * interface — no Kafka/network concerns.
 */
export async function projectContainerCodeRead(
  envelope: VerifiedEnvelope,
  db: ContainerCrossCheckDb
): Promise<ProjectionResult> {
  if (envelope.eventType !== CV_CONTAINER_TOPIC) {
    throw new EnvelopeRejection("unknown-event-type", envelope.eventType);
  }
  const resource = envelope.resource as ContainerCodeResource;
  const code = normalizeContainerCode(String(resource.code ?? ""));
  if (!code || code.length !== 11) {
    throw new EnvelopeRejection("invalid-payload", "container code is not ISO 6346 length");
  }
  const status = String(resource.status ?? "needs-review");
  const confidence = typeof resource.confidence === "number" ? resource.confidence : null;
  const checkDigitValid = resource.checkDigitValid === true;

  const declarationIds = await db.findDeclarationsByContainer(code);
  const declarationId = declarationIds.length > 0 ? declarationIds[0] : null;

  let matchStatus: ProjectionResult["matchStatus"];
  if (!checkDigitValid) {
    matchStatus = "invalid_code";
  } else {
    matchStatus = declarationId !== null ? "matched" : "unmatched";
  }

  const inserted = await db.insertOcrRead({
    eventId: envelope.eventId,
    cameraId: String(resource.cameraId ?? ""),
    containerCode: code,
    status,
    confidence,
    checkDigitValid,
    modelVersion: resource.modelVersion ? String(resource.modelVersion) : null,
    matchStatus,
    declarationId,
    occurredAt: envelope.occurredAt ? new Date(envelope.occurredAt) : null,
  });
  if (inserted === "duplicate") {
    return { projected: false, duplicate: true, riskSignals: 0 };
  }

  // Risk signals into declaration risk history (only attributable matches).
  let riskSignals = 0;
  if (declarationId !== null) {
    if (!checkDigitValid) {
      await db.insertRiskSignal({
        declarationId,
        riskScore: 35,
        riskLane: "yellow",
        triggeredBy: "cv-container-ocr",
        factors: [{
          code: "CONTAINER_CHECK_DIGIT_INVALID",
          description: `Gate OCR read ${code} fails ISO 6346 check digit (camera ${resource.cameraId})`,
          severity: "MEDIUM",
          source: "cv.container-code.v1",
          eventId: envelope.eventId,
        }],
      });
      riskSignals++;
    }
    if (status !== "confirmed" || (confidence !== null && confidence < 0.8)) {
      await db.insertRiskSignal({
        declarationId,
        riskScore: 15,
        riskLane: "yellow",
        triggeredBy: "cv-container-ocr",
        factors: [{
          code: "CONTAINER_OCR_NEEDS_REVIEW",
          description: `Gate OCR read ${code} requires review (status=${status}, confidence=${confidence ?? "n/a"})`,
          severity: "LOW",
          source: "cv.container-code.v1",
          eventId: envelope.eventId,
        }],
      });
      riskSignals++;
    }
  }
  return { projected: true, matchStatus, declarationId, riskSignals };
}

// ── Drizzle-backed Db implementation ─────────────────────────────────────────

async function buildDrizzleDb(): Promise<ContainerCrossCheckDb> {
  const { getDb } = await import("./db");
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  return {
    async findDeclarationsByContainer(code) {
      // vision_analyses.containerAnalysis->>'containerNumber' normalized match
      const result = await db.execute(sql`
        SELECT DISTINCT declaration_id AS id FROM vision_analyses
        WHERE declaration_id IS NOT NULL
          AND upper(regexp_replace(container_analysis->>'containerNumber', '[^A-Za-z0-9]', '', 'g')) = ${code}
      `);
      const rows = (result as any).rows ?? result;
      return (rows as any[]).map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
    },
    async insertOcrRead(row) {
      const result = await db.execute(sql`
        INSERT INTO container_ocr_reads
          (event_id, camera_id, container_code, status, confidence, check_digit_valid,
           model_version, match_status, declaration_id, occurred_at)
        VALUES (${row.eventId}, ${row.cameraId}, ${row.containerCode}, ${row.status},
                ${row.confidence}, ${row.checkDigitValid}, ${row.modelVersion},
                ${row.matchStatus}, ${row.declarationId}, ${row.occurredAt})
        ON CONFLICT (event_id) DO NOTHING
        RETURNING id
      `);
      const rows = (result as any).rows ?? result;
      return (rows as any[]).length > 0 ? "inserted" : "duplicate";
    },
    async insertRiskSignal(row) {
      await db.execute(sql`
        INSERT INTO declaration_risk_history (declaration_id, risk_score, risk_lane, triggered_by, factors)
        VALUES (${row.declarationId}, ${row.riskScore}, ${row.riskLane}, ${row.triggeredBy},
                ${JSON.stringify(row.factors)})
      `);
    },
  };
}

// ── Kafka consumer ───────────────────────────────────────────────────────────

let consumerStarted = false;

/**
 * Start the cv.container-code.v1 consumer. Enabled only when
 * CV_CONTAINER_CONSUMER_ENABLED=true; then KEY_DIRECTORY_PATH is mandatory
 * (fail closed) and every record must verify.
 */
export async function startCvContainerConsumer(): Promise<void> {
  if (consumerStarted) return;
  if ((process.env.CV_CONTAINER_CONSUMER_ENABLED ?? "false").toLowerCase() !== "true") {
    return;
  }
  consumerStarted = true;

  const directory: KeyDirectory = loadKeyDirectoryFromEnv(); // throws fail-closed
  const db = await buildDrizzleDb();

  const brokers = (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",");
  const kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID ?? "tradegateway-api",
    brokers,
    logLevel: logLevel.WARN,
  });
  const consumer = kafka.consumer({
    groupId: process.env.KAFKA_GROUP_ID ?? "tradegateway-cv-container",
  });
  await consumer.connect();
  await consumer.subscribe({ topic: CV_CONTAINER_TOPIC, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      try {
        const envelope = verifyEnvelope(message.value, directory);
        const result = await projectContainerCodeRead(envelope, db);
        console.log(
          `[cv-container] projected ${envelope.eventId}: match=${result.matchStatus} signals=${result.riskSignals}`
        );
      } catch (err) {
        // Fail-closed: rejected records are logged with the reason code and
        // never projected. KafkaJS redelivers on throw for transient DB
        // errors; signature rejections are terminal (log + skip).
        if (err instanceof EnvelopeRejection) {
          console.error(`[cv-container] rejected: ${err.reason} — ${err.message}`);
          return;
        }
        throw err;
      }
    },
  });
  console.log(`[cv-container] consuming ${CV_CONTAINER_TOPIC}`);
}
