/**
 * crm/publisher.ts — Kafka publisher for crm.case.v1 (Phase 12).
 *
 * Emits signed envelope v1.0 JSON message values (consumers verify the value
 * exactly per docs/envelope-signature.md). Follows the mswPublisher.ts
 * posture:
 *   - build+sign FAILS CLOSED (CrmSigningConfigError) when the signing key is
 *     unconfigured — nothing unsigned ever reaches the topic;
 *   - Kafka unavailability degrades gracefully: emit returns
 *     { published: false }, which callers surface honestly — never a fake
 *     "published".
 */
import { randomUUID } from "node:crypto";
import { getKafkaProducer } from "../_core/kafka";
import {
  buildAndSignCrmCaseEnvelope,
  CRM_CASE_TOPIC,
  type CrmCaseEventType,
  type CrmCaseSignedEnvelope,
} from "./envelope";

export interface CrmCaseEmitOptions {
  eventType: CrmCaseEventType;
  /** Case resource payload (contract field names). */
  resource: Record<string, unknown>;
  principalId: string;
  principalRole: string;
  /** Aggregate key — the case number. */
  aggregateId: string;
  correlationId?: string;
  occurredAt?: string;
  eventId?: string;
}

export interface CrmCaseEmitResult {
  envelope: CrmCaseSignedEnvelope;
  published: boolean;
}

export async function emitCrmCaseEvent(options: CrmCaseEmitOptions): Promise<CrmCaseEmitResult> {
  const eventId = options.eventId ?? `evt-crm-${randomUUID()}`;
  const envelope = buildAndSignCrmCaseEnvelope({
    eventId,
    eventType: options.eventType,
    resource: options.resource,
    principalId: options.principalId,
    principalRole: options.principalRole,
    correlationId: options.correlationId ?? eventId,
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    bundleId: `bdl-crm-${randomUUID()}`,
    fullUrl: `urn:uuid:${randomUUID()}`,
  });

  const producer = await getKafkaProducer();
  if (!producer) return { envelope, published: false };

  await producer.send({
    topic: CRM_CASE_TOPIC,
    messages: [
      {
        key: options.aggregateId,
        value: JSON.stringify(envelope),
        headers: {
          "event-type": envelope.eventType,
          "content-type": "application/json",
          source: CRM_CASE_TOPIC,
          "correlation-id": envelope.correlationId,
        },
      },
    ],
  });
  return { envelope, published: true };
}
