"""
kafka_middleware.py — Confluent Kafka producer/consumer for Python AI services.

Topics published by AI services:
  - declaration.risk-scored  (risk-ai, gnn-risk)
  - sanctions.hit            (sanctions-service)
  - security.alert           (anomaly-detection)
  - cargo.vision.result      (vision-service)

Topics consumed by AI services:
  - declaration.submitted    (risk-ai, gnn-risk, rule-engine)
  - cargo.vision.request     (vision-service)
  - audit.event              (anomaly-detection)
"""

import json
import logging
import os
from typing import Any, Callable, Dict, Optional

from confluent_kafka import Consumer, KafkaError, KafkaException, Producer

logger = logging.getLogger(__name__)


def _kafka_brokers() -> str:
    return os.getenv("KAFKA_BROKERS", "kafka:9092")


class KafkaMiddleware:
    """
    Shared Kafka producer/consumer for all TradeGateway Python AI services.
    Wraps confluent_kafka with structured logging and JSON serialization.
    """

    # Topic registry — all topics used across the platform
    TOPICS = {
        # Declarations
        "declaration.submitted": "declaration.submitted",
        "declaration.risk-scored": "declaration.risk-scored",
        "declaration.cleared": "declaration.cleared",
        "declaration.rejected": "declaration.rejected",
        # Sanctions & security
        "sanctions.hit": "sanctions.hit",
        "security.alert": "security.alert",
        # Cargo
        "cargo.vision.request": "cargo.vision.request",
        "cargo.vision.result": "cargo.vision.result",
        "cargo.arrived": "cargo.arrived",
        "cargo.released": "cargo.released",
        # OGA
        "oga.permit.requested": "oga.permit.requested",
        "oga.permit.approved": "oga.permit.approved",
        # Audit
        "audit.event": "audit.event",
        # Profile
        "profile.kyc.verified": "profile.kyc.verified",
        # ASEAN
        "asean.sw.outbound": "asean.sw.outbound",
        "asean.sw.inbound": "asean.sw.inbound",
    }

    def __init__(self, service_name: str):
        self.service_name = service_name
        self._producer: Optional[Producer] = None
        self._consumer: Optional[Consumer] = None

    def _get_producer(self) -> Producer:
        if self._producer is None:
            self._producer = Producer({
                "bootstrap.servers": _kafka_brokers(),
                "acks": "all",
                "retries": 5,
                "retry.backoff.ms": 200,
                "enable.idempotence": True,
            })
        return self._producer

    def publish(self, topic: str, payload: Dict[str, Any], key: Optional[str] = None) -> bool:
        """
        Publish a JSON message to a Kafka topic.
        Returns True on success, False on failure (non-fatal).
        """
        try:
            producer = self._get_producer()
            data = json.dumps(payload, default=str).encode("utf-8")
            key_bytes = key.encode("utf-8") if key else None
            producer.produce(
                topic=topic,
                key=key_bytes,
                value=data,
                on_delivery=self._delivery_callback,
            )
            producer.poll(0)
            logger.info(
                "Kafka message published",
                extra={"service": self.service_name, "topic": topic, "key": key},
            )
            return True
        except KafkaException as e:
            logger.error(
                "Kafka publish failed",
                extra={"service": self.service_name, "topic": topic, "error": str(e)},
            )
            return False

    def flush(self, timeout: float = 5.0):
        """Flush pending messages. Call before shutdown."""
        if self._producer:
            self._producer.flush(timeout)

    def _delivery_callback(self, err, msg):
        if err:
            logger.error(
                "Kafka delivery failed",
                extra={"service": self.service_name, "topic": msg.topic(), "error": str(err)},
            )
        else:
            logger.debug(
                "Kafka delivery confirmed",
                extra={
                    "service": self.service_name,
                    "topic": msg.topic(),
                    "partition": msg.partition(),
                    "offset": msg.offset(),
                },
            )

    def create_consumer(
        self,
        topics: list[str],
        group_id: Optional[str] = None,
    ) -> "KafkaConsumerWrapper":
        """
        Creates a consumer subscribed to the given topics.
        group_id defaults to f"{service_name}-group".
        """
        gid = group_id or f"{self.service_name}-group"
        consumer = Consumer({
            "bootstrap.servers": _kafka_brokers(),
            "group.id": gid,
            "auto.offset.reset": "latest",
            "enable.auto.commit": True,
        })
        consumer.subscribe(topics)
        logger.info(
            "Kafka consumer created",
            extra={"service": self.service_name, "topics": topics, "group_id": gid},
        )
        return KafkaConsumerWrapper(consumer, self.service_name)

    def close(self):
        if self._producer:
            self._producer.flush(5.0)
        if self._consumer:
            self._consumer.close()


class KafkaConsumerWrapper:
    """Thin wrapper around confluent_kafka.Consumer with structured logging."""

    def __init__(self, consumer: Consumer, service_name: str):
        self._consumer = consumer
        self.service_name = service_name

    def poll(self, timeout: float = 1.0) -> Optional[Dict[str, Any]]:
        """
        Poll for a single message. Returns parsed JSON payload or None.
        Handles errors and deserialization internally.
        """
        msg = self._consumer.poll(timeout)
        if msg is None:
            return None
        if msg.error():
            if msg.error().code() == KafkaError._PARTITION_EOF:
                return None
            logger.error(
                "Kafka consumer error",
                extra={"service": self.service_name, "error": str(msg.error())},
            )
            return None
        try:
            payload = json.loads(msg.value().decode("utf-8"))
            logger.debug(
                "Kafka message received",
                extra={
                    "service": self.service_name,
                    "topic": msg.topic(),
                    "partition": msg.partition(),
                    "offset": msg.offset(),
                },
            )
            return payload
        except json.JSONDecodeError as e:
            logger.error(
                "Kafka message deserialization failed",
                extra={"service": self.service_name, "error": str(e)},
            )
            return None

    def consume_loop(self, handler: Callable[[Dict[str, Any]], None], poll_timeout: float = 1.0):
        """
        Blocking consume loop. Calls handler(payload) for each message.
        Exits on KeyboardInterrupt.
        """
        logger.info("Kafka consume loop started", extra={"service": self.service_name})
        try:
            while True:
                payload = self.poll(poll_timeout)
                if payload is not None:
                    try:
                        handler(payload)
                    except Exception as e:
                        logger.error(
                            "Message handler error",
                            extra={"service": self.service_name, "error": str(e)},
                        )
        except KeyboardInterrupt:
            logger.info("Kafka consume loop stopped", extra={"service": self.service_name})
        finally:
            self._consumer.close()
