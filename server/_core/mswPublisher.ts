/**
 * mswPublisher.ts — Kafka publisher for maritime.msw.v1 (Phase 9 WP-C).
 *
 * Emits all 11 contract event types as RAW signed envelope v1.0 JSON message
 * values (consumers verify the value exactly per docs/envelope-signature.md —
 * the envelope is NOT wrapped in the legacy DomainEvent envelope). Follows
 * the kafkaEventPublisher.ts style: one typed emit helper per event family,
 * a single topic (MSW_TOPIC), KafkaJS producer with OTel headers.
 *
 * Classification floors are applied at build time by buildMswEnvelope
 * (docs/msw.md §Classification floors): RESTRICTED for personal-data forms
 * (FAL4/5/6/MDOH) and pratique decisions, CONFIDENTIAL for boarding and
 * clearance events, INTERNAL otherwise. The signing key is env-only and the
 * build fails closed when it is unset — nothing unsigned ever reaches the
 * topic.
 *
 * Kafka unavailability mirrors the platform-wide posture (kafka.ts): the
 * producer connect fails gracefully and the emit returns false, which the
 * service layer surfaces HONESTLY in its result (eventPublished:false) —
 * never a fake "published".
 */

import { randomUUID } from "node:crypto";
import { getKafkaProducer } from "./kafka";
import { injectKafkaHeaders, withSpan } from "./telemetry";
import { SpanKind } from "@opentelemetry/api";
import {
  buildAndSignMswEnvelope,
  MSW_TOPIC,
  type MswEventType,
  type MswSignedEnvelope,
} from "./mswEnvelope";

export interface MswEmitOptions {
  eventType: MswEventType;
  /** Primary resource (contract field names; @type added by the builder). */
  resource: Record<string, unknown>;
  principalId: string;
  principalRole: string;
  /** Aggregate key — the visit id for visit-scoped events. */
  aggregateId: string;
  correlationId?: string;
  occurredAt?: string;
  eventId?: string;
}

export interface MswEmitResult {
  /** The signed envelope that was (or would have been) published. */
  envelope: MswSignedEnvelope;
  /** False when Kafka is unreachable (graceful degradation, honestly surfaced). */
  published: boolean;
}

/**
 * Builds, signs (FAIL CLOSED on missing key) and publishes one maritime.msw.v1
 * event. Throws MswSigningConfigError when the signing key is unconfigured.
 */
export async function emitMswEvent(options: MswEmitOptions): Promise<MswEmitResult> {
  const eventId = options.eventId ?? `evt-msw-${randomUUID()}`;
  const envelope = buildAndSignMswEnvelope({
    eventId,
    eventType: options.eventType,
    resource: options.resource,
    principalId: options.principalId,
    principalRole: options.principalRole,
    correlationId: options.correlationId ?? eventId,
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    bundleId: `bdl-msw-${randomUUID()}`,
    fullUrl: `urn:uuid:${randomUUID()}`,
  });

  const producer = await getKafkaProducer();
  if (!producer) return { envelope, published: false };

  const headers: Record<string, string> = {
    "event-type": envelope.eventType,
    "content-type": "application/json",
    "source": MSW_TOPIC,
    "correlation-id": envelope.correlationId,
  };
  injectKafkaHeaders(headers);
  await withSpan(
    `kafka.produce ${MSW_TOPIC}`,
    {
      kind: SpanKind.PRODUCER,
      attributes: {
        "messaging.system": "kafka",
        "messaging.destination.name": MSW_TOPIC,
        "messaging.kafka.message.key": options.aggregateId,
      },
    },
    async () => {
      await producer.send({
        topic: MSW_TOPIC,
        messages: [
          {
            key: options.aggregateId,
            value: JSON.stringify(envelope),
            headers,
          },
        ],
      });
    }
  );
  return { envelope, published: true };
}
