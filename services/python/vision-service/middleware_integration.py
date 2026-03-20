"""
Vision Service — Middleware Integration
=======================================
Wires Kafka, Dapr, Fluvio, and OpenTelemetry into the vision-service service.

Computer vision document analysis service (PaddleOCR)

Kafka topics consumed:
  declarations.submitted  → Extract document data from uploaded declaration documents

Kafka topics published:
  vision.extracted
  vision.failed

Fluvio streams:
  vision.processing.stream  → real-time feed

Usage:
    from middleware_integration import setup_middleware, mw, start_consumer_thread
"""

from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from shared.middleware import MiddlewareBundle, init_tracer

logger = logging.getLogger("vision-service.middleware")

SERVICE_NAME = "vision-service"
SERVICE_VERSION = "1.0.0"

TOPIC_DECLARATIONS_SUBMITTED = "declarations.submitted"
TOPIC_VISION_EXTRACTED = "vision.extracted"
TOPIC_VISION_FAILED = "vision.failed"
FLUVIO_VISION_PROCESSING_STREAM = "vision.processing.stream"

mw: MiddlewareBundle | None = None
tracer_provider = None
_consumer_thread: threading.Thread | None = None


def _handle_declarations_submitted(payload: dict[str, Any]) -> None:
    """
    Extract document data from uploaded declaration documents
    """
    global mw
    if mw is None:
        return

    logger.info(f"[Middleware] Vision Service handling {payload.get('declaration_id', payload.get('trader_id', 'unknown'))}")

    # Publish result event
    result_event = {
        "source": SERVICE_NAME,
        "input": payload,
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "status": "processed",
    }

    if mw:
        mw.publish_event(TOPIC_VISION_EXTRACTED, result_event)

    if mw and mw.fluvio:
        mw.fluvio.produce(FLUVIO_VISION_PROCESSING_STREAM, {
            "source": SERVICE_NAME,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": "processed",
        })


def setup_middleware() -> None:
    """Initialise all middleware clients for vision-service."""
    global mw, tracer_provider

    try:
        tracer_provider = init_tracer(SERVICE_NAME, SERVICE_VERSION)
        logger.info("[Middleware] OpenTelemetry tracer initialised")
    except Exception as exc:
        logger.warning(f"[Middleware] OTel init failed (non-fatal): {exc}")

    try:
        mw = MiddlewareBundle(
            service_name=SERVICE_NAME,
            consume_topics=["declarations.submitted"],
            handlers={
                "declarations.submitted": _handle_declarations_submitted,
            },
            enable_fluvio=True,
        )
        logger.info("[Middleware] MiddlewareBundle initialised")
    except Exception as exc:
        logger.warning(f"[Middleware] MiddlewareBundle init failed (non-fatal): {exc}")
        mw = None


def start_consumer_thread() -> threading.Thread | None:
    """Start Kafka consumer in a daemon background thread."""
    global _consumer_thread
    if mw is None:
        return None

    def _run():
        try:
            mw.start_consumers()
        except Exception as exc:
            logger.error(f"[Middleware] Consumer thread error: {exc}")

    _consumer_thread = threading.Thread(target=_run, daemon=True, name=f"{SERVICE_NAME}-consumer")
    _consumer_thread.start()
    logger.info("[Middleware] Consumer thread started")
    return _consumer_thread


def shutdown_middleware() -> None:
    """Gracefully shut down all middleware clients."""
    global mw
    if mw:
        mw.stop()
        mw = None
    if tracer_provider:
        try:
            tracer_provider.shutdown()
        except Exception:
            pass
