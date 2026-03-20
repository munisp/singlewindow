"""
Ray Risk Svc — Middleware Integration
=====================================
Wires Kafka, Dapr, Fluvio, and OpenTelemetry into the ray-risk-svc service.

Ray risk service orchestrator

Kafka topics consumed:
  declarations.submitted  → Orchestrate ensemble risk scoring across Ray actors
  risk.scored  → Orchestrate ensemble risk scoring across Ray actors

Kafka topics published:
  ray.ensemble.scored

Fluvio streams:
  ray.ensemble.stream  → real-time feed

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

logger = logging.getLogger("ray-risk-svc.middleware")

SERVICE_NAME = "ray-risk-svc"
SERVICE_VERSION = "1.0.0"

TOPIC_DECLARATIONS_SUBMITTED = "declarations.submitted"
TOPIC_RISK_SCORED = "risk.scored"
TOPIC_RAY_ENSEMBLE_SCORED = "ray.ensemble.scored"
FLUVIO_RAY_ENSEMBLE_STREAM = "ray.ensemble.stream"

mw: MiddlewareBundle | None = None
tracer_provider = None
_consumer_thread: threading.Thread | None = None


def _handle_declarations_submitted(payload: dict[str, Any]) -> None:
    """
    Orchestrate ensemble risk scoring across Ray actors
    """
    global mw
    if mw is None:
        return

    logger.info(f"[Middleware] Ray Risk Svc handling {payload.get('declaration_id', payload.get('trader_id', 'unknown'))}")

    # Publish result event
    result_event = {
        "source": SERVICE_NAME,
        "input": payload,
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "status": "processed",
    }

    if mw:
        mw.publish_event(TOPIC_RAY_ENSEMBLE_SCORED, result_event)

    if mw and mw.fluvio:
        mw.fluvio.produce(FLUVIO_RAY_ENSEMBLE_STREAM, {
            "source": SERVICE_NAME,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": "processed",
        })




def _handle_risk_scored(payload: dict[str, Any]) -> None:
    """Handle risk.scored event."""
    global mw
    if mw is None:
        return
    logger.info(f"[Middleware] Handling risk.scored: {payload}")

def setup_middleware() -> None:
    """Initialise all middleware clients for ray-risk-svc."""
    global mw, tracer_provider

    try:
        tracer_provider = init_tracer(SERVICE_NAME, SERVICE_VERSION)
        logger.info("[Middleware] OpenTelemetry tracer initialised")
    except Exception as exc:
        logger.warning(f"[Middleware] OTel init failed (non-fatal): {exc}")

    try:
        mw = MiddlewareBundle(
            service_name=SERVICE_NAME,
            consume_topics=["declarations.submitted", "risk.scored"],
            handlers={
                "declarations.submitted": _handle_declarations_submitted,
                "risk.scored": _handle_risk_scored,
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
