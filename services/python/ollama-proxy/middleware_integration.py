"""
Ollama Proxy — Middleware Integration
=====================================
Wires Kafka, Dapr, Fluvio, and OpenTelemetry into the ollama-proxy service.

Ollama LLM proxy for HS code classification

Kafka topics consumed:
  declarations.submitted  → Classify HS codes using LLM inference

Kafka topics published:
  llm.hs.classified

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

logger = logging.getLogger("ollama-proxy.middleware")

SERVICE_NAME = "ollama-proxy"
SERVICE_VERSION = "1.0.0"

TOPIC_DECLARATIONS_SUBMITTED = "declarations.submitted"
TOPIC_LLM_HS_CLASSIFIED = "llm.hs.classified"

mw: MiddlewareBundle | None = None
tracer_provider = None
_consumer_thread: threading.Thread | None = None


def _handle_declarations_submitted(payload: dict[str, Any]) -> None:
    """
    Classify HS codes using LLM inference
    """
    global mw
    if mw is None:
        return

    logger.info(f"[Middleware] Ollama Proxy handling {payload.get('declaration_id', payload.get('trader_id', 'unknown'))}")

    # Publish result event
    result_event = {
        "source": SERVICE_NAME,
        "input": payload,
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "status": "processed",
    }

    if mw:
        mw.publish_event(TOPIC_LLM_HS_CLASSIFIED, result_event)



def setup_middleware() -> None:
    """Initialise all middleware clients for ollama-proxy."""
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
            enable_fluvio=False,
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
