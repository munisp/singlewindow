"""
TradeGateway™ NGSWTP — Shared Python Middleware
================================================
Provides Kafka, Dapr, Fluvio, and OpenTelemetry integration
for all Python microservices.

Usage:
    from shared.middleware import (
        KafkaPublisher, KafkaConsumer,
        DaprPublisher, FluvioPublisher,
        init_tracer, get_tracer
    )

Each service imports only what it needs.
"""

from __future__ import annotations

import json
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine, Optional

import httpx
from confluent_kafka import Consumer, KafkaError, Producer
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.semconv.resource import ResourceAttributes

logger = logging.getLogger(__name__)


# ─── Configuration ─────────────────────────────────────────────────────────────

def _kafka_brokers() -> str:
    return os.getenv("KAFKA_BROKERS", "kafka:9092")


def _dapr_port() -> str:
    return os.getenv("DAPR_HTTP_PORT", "3500")


def _fluvio_endpoint() -> str:
    # P0 remediation: Fluvio is NOT deployed on this platform — Kafka is the
    # real event bus. There is no default endpoint; unless FLUVIO_ENDPOINT is
    # explicitly set the publisher is honestly disabled (loud error, no I/O).
    return os.getenv("FLUVIO_ENDPOINT", "")


def _otel_endpoint() -> str:
    return os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")


DAPR_PUBSUB_NAME = "dapr-kafka-pubsub"


# ─── OpenTelemetry ─────────────────────────────────────────────────────────────

def init_tracer(service_name: str, service_version: str = "1.0.0") -> TracerProvider:
    """Initialise the global OpenTelemetry TracerProvider for a service."""
    resource = Resource.create({
        ResourceAttributes.SERVICE_NAME: service_name,
        ResourceAttributes.SERVICE_VERSION: service_version,
    })
    exporter = OTLPSpanExporter(
        endpoint=f"{_otel_endpoint()}/v1/traces",
    )
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    logger.info(f"[OTel] Tracer initialised for {service_name}")
    return provider


def get_tracer(service_name: str) -> trace.Tracer:
    """Return the OTel tracer for the given service."""
    return trace.get_tracer(service_name)


# ─── Kafka Publisher ───────────────────────────────────────────────────────────

class KafkaPublisher:
    """Thread-safe Kafka producer wrapper."""

    def __init__(self, service_name: str) -> None:
        self._service = service_name
        conf = {
            "bootstrap.servers": _kafka_brokers(),
            "acks": "all",
            "retries": 5,
            "retry.backoff.ms": 200,
            "enable.idempotence": True,
        }
        self._producer = Producer(conf)
        logger.info(f"[Kafka] Publisher initialised for {service_name}")

    def publish(
        self,
        topic: str,
        payload: dict[str, Any],
        key: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> None:
        """Publish a JSON payload to a Kafka topic."""
        payload.setdefault("source", self._service)
        payload.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
        if trace_id:
            payload["trace_id"] = trace_id

        value = json.dumps(payload).encode("utf-8")
        key_bytes = key.encode("utf-8") if key else None

        def delivery_report(err, msg):
            if err:
                logger.error(f"[Kafka] Delivery failed to {topic}: {err}")
            else:
                logger.debug(f"[Kafka] Delivered to {msg.topic()} [{msg.partition()}]")

        self._producer.produce(topic, value=value, key=key_bytes, callback=delivery_report)
        self._producer.poll(0)

    def flush(self, timeout: float = 5.0) -> None:
        self._producer.flush(timeout)

    def close(self) -> None:
        self.flush()


# ─── Kafka Consumer ────────────────────────────────────────────────────────────

class KafkaConsumer:
    """Consumer group wrapper with automatic offset management."""

    def __init__(
        self,
        service_name: str,
        topics: list[str],
        handlers: dict[str, Callable[[dict[str, Any]], None]],
        group_id: Optional[str] = None,
    ) -> None:
        self._service = service_name
        self._topics = topics
        self._handlers = handlers
        self._running = False

        conf = {
            "bootstrap.servers": _kafka_brokers(),
            "group.id": group_id or f"{service_name}-group",
            "auto.offset.reset": "latest",
            "enable.auto.commit": True,
            "auto.commit.interval.ms": 1000,
        }
        self._consumer = Consumer(conf)
        logger.info(f"[Kafka] Consumer initialised for {service_name}, topics={topics}")

    def start(self) -> None:
        """Subscribe and begin polling in the current thread."""
        self._consumer.subscribe(self._topics)
        self._running = True
        logger.info(f"[Kafka] Consumer started for {self._service}")
        try:
            while self._running:
                msg = self._consumer.poll(timeout=1.0)
                if msg is None:
                    continue
                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        continue
                    logger.error(f"[Kafka] Consumer error: {msg.error()}")
                    continue
                try:
                    payload = json.loads(msg.value().decode("utf-8"))
                    handler = self._handlers.get(msg.topic())
                    if handler:
                        handler(payload)
                    else:
                        logger.warning(f"[Kafka] No handler for topic {msg.topic()}")
                except Exception as exc:
                    logger.exception(f"[Kafka] Handler error for {msg.topic()}: {exc}")
        finally:
            self._consumer.close()

    def stop(self) -> None:
        self._running = False


# ─── Dapr Publisher ────────────────────────────────────────────────────────────

class DaprPublisher:
    """HTTP-based Dapr pub/sub publisher (non-fatal — degrades gracefully)."""

    def __init__(self, service_name: str) -> None:
        self._service = service_name
        self._base_url = f"http://localhost:{_dapr_port()}/v1.0/publish"
        self._client = httpx.Client(timeout=5.0)
        logger.info(f"[Dapr] Publisher initialised for {service_name}")

    def publish(self, topic: str, payload: dict[str, Any]) -> bool:
        """Publish to Dapr pub/sub. Returns True on success, False on failure."""
        url = f"{self._base_url}/{DAPR_PUBSUB_NAME}/{topic}"
        try:
            resp = self._client.post(url, json=payload)
            resp.raise_for_status()
            return True
        except Exception as exc:
            logger.warning(f"[Dapr] Publish failed (non-fatal) to {topic}: {exc}")
            return False

    def close(self) -> None:
        self._client.close()


# ─── Fluvio Publisher ──────────────────────────────────────────────────────────

class FluvioPublisher:
    """HTTP-based Fluvio stream publisher.

    P0 remediation: Fluvio is NOT deployed — Kafka is the real event bus.
    Unless FLUVIO_ENDPOINT is explicitly configured this publisher is honestly
    DISABLED: it logs a loud error and refuses to produce (no phantom HTTP
    calls to a non-existent endpoint, no silent swallowing)."""

    def __init__(self, service_name: str) -> None:
        self._service = service_name
        self._endpoint = _fluvio_endpoint()
        self._enabled = bool(self._endpoint)
        self._client = httpx.Client(timeout=3.0) if self._enabled else None
        if not self._enabled:
            logger.error(
                "[Fluvio] FLUVIO_ENDPOINT is not set — Fluvio publisher DISABLED "
                f"for {service_name}. Fluvio is not deployed; use the Kafka publisher instead."
            )

    def produce(self, stream_topic: str, payload: dict[str, Any]) -> bool:
        """Produce a record to a Fluvio stream topic. Returns True on success."""
        if not self._enabled:
            logger.error(f"[Fluvio] produce to {stream_topic} refused: publisher disabled (Fluvio not deployed)")
            return False
        url = f"{self._endpoint}/api/v1/produce/{stream_topic}"
        try:
            resp = self._client.post(url, json=payload)
            resp.raise_for_status()
            return True
        except Exception as exc:
            logger.warning(f"[Fluvio] Produce failed (non-fatal) to {stream_topic}: {exc}")
            return False

    def close(self) -> None:
        self._client.close()


# ─── Async Variants ────────────────────────────────────────────────────────────

class AsyncDaprPublisher:
    """Async HTTP-based Dapr pub/sub publisher."""

    def __init__(self, service_name: str) -> None:
        self._service = service_name
        self._base_url = f"http://localhost:{_dapr_port()}/v1.0/publish"

    async def publish(self, topic: str, payload: dict[str, Any]) -> bool:
        url = f"{self._base_url}/{DAPR_PUBSUB_NAME}/{topic}"
        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                return True
            except Exception as exc:
                logger.warning(f"[Dapr] Async publish failed (non-fatal) to {topic}: {exc}")
                return False


class AsyncFluvioPublisher:
    """Async HTTP-based Fluvio stream publisher.

    P0 remediation: honestly disabled unless FLUVIO_ENDPOINT is explicitly
    configured (Fluvio is not deployed; Kafka is the real event bus)."""

    def __init__(self, service_name: str) -> None:
        self._service = service_name
        self._endpoint = _fluvio_endpoint()
        self._enabled = bool(self._endpoint)
        if not self._enabled:
            logger.error(
                "[Fluvio] FLUVIO_ENDPOINT is not set — async Fluvio publisher "
                f"DISABLED for {service_name}. Use the Kafka publisher instead."
            )

    async def produce(self, stream_topic: str, payload: dict[str, Any]) -> bool:
        if not self._enabled:
            logger.error(f"[Fluvio] async produce to {stream_topic} refused: publisher disabled (Fluvio not deployed)")
            return False
        url = f"{self._endpoint}/api/v1/produce/{stream_topic}"
        async with httpx.AsyncClient(timeout=3.0) as client:
            try:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                return True
            except Exception as exc:
                logger.warning(f"[Fluvio] Async produce failed (non-fatal) to {stream_topic}: {exc}")
                return False


# ─── Middleware Bundle ─────────────────────────────────────────────────────────

class MiddlewareBundle:
    """
    Convenience wrapper that initialises all middleware clients for a service.

    Usage:
        mw = MiddlewareBundle(
            service_name="risk-engine",
            consume_topics=["declarations.submitted"],
            handlers={"declarations.submitted": handle_declaration},
        )
        mw.start_consumers()  # in a background thread
    """

    def __init__(
        self,
        service_name: str,
        consume_topics: Optional[list[str]] = None,
        handlers: Optional[dict[str, Callable]] = None,
        enable_fluvio: bool = True,
    ) -> None:
        self.service_name = service_name
        self.kafka_publisher = KafkaPublisher(service_name)
        self.dapr = DaprPublisher(service_name)
        self.fluvio = FluvioPublisher(service_name) if enable_fluvio else None
        self._consumer: Optional[KafkaConsumer] = None

        if consume_topics and handlers:
            self._consumer = KafkaConsumer(
                service_name=service_name,
                topics=consume_topics,
                handlers=handlers,
            )

    def start_consumers(self) -> None:
        """Start consuming in the current thread (blocking)."""
        if self._consumer:
            self._consumer.start()

    def stop(self) -> None:
        if self._consumer:
            self._consumer.stop()
        self.kafka_publisher.close()
        self.dapr.close()
        if self.fluvio and self.fluvio._client:
            self.fluvio.close()

    def publish_event(
        self,
        topic: str,
        payload: dict[str, Any],
        key: Optional[str] = None,
    ) -> None:
        """Publish to both Kafka and Dapr (dual-publish pattern)."""
        self.kafka_publisher.publish(topic, payload, key=key)
        self.dapr.publish(topic, payload)
