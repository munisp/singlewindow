"""
Risk Engine — Middleware Integration
=====================================
Wires Kafka, Dapr, Fluvio, and OpenTelemetry into the risk-engine service.

Kafka topics consumed:
  declarations.submitted  → score the declaration and publish result

Kafka topics published:
  risk.scored             → risk score result (lane + score + factors)
  risk.model.updated      → when the ML model is retrained

Fluvio streams:
  risk.live.stream        → real-time risk score feed for the SOC dashboard

Usage:
    from middleware_integration import setup_middleware, mw

    # In FastAPI lifespan:
    setup_middleware()
    mw.start_consumers()  # in a background thread
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from shared.middleware import MiddlewareBundle, init_tracer

logger = logging.getLogger("risk-engine.middleware")

SERVICE_NAME = "risk-engine"
SERVICE_VERSION = "1.0.0"

# Kafka topic constants
TOPIC_DECLARATIONS_SUBMITTED = "declarations.submitted"
TOPIC_RISK_SCORED = "risk.scored"
TOPIC_RISK_MODEL_UPDATED = "risk.model.updated"
FLUVIO_RISK_LIVE_STREAM = "risk.live.stream"

# Global middleware bundle (initialised by setup_middleware())
mw: MiddlewareBundle | None = None
tracer_provider = None
_consumer_thread: threading.Thread | None = None


def _handle_declaration_submitted(payload: dict[str, Any]) -> None:
    """
    Handle a declarations.submitted event.
    Triggers risk scoring and publishes the result to risk.scored.
    """
    global mw
    if mw is None:
        return

    declaration_id = payload.get("declaration_id")
    ucr = payload.get("ucr", "")
    hs_code = payload.get("hs_code", "")
    origin_country = payload.get("origin_country", "NG")
    declared_value = float(payload.get("declared_value", 0))
    trader_id = payload.get("trader_id")

    logger.info(f"[Middleware] Scoring declaration {declaration_id} (UCR={ucr})")

    # Import the scoring function from main module
    try:
        from main import score_declaration_internal
        result = score_declaration_internal(
            declaration_id=declaration_id,
            hs_code=hs_code,
            origin_country=origin_country,
            declared_value=declared_value,
            trader_id=trader_id,
        )
        risk_event = {
            "declaration_id": declaration_id,
            "ucr": ucr,
            "risk_score": result.get("risk_score", 0.5),
            "risk_lane": result.get("risk_lane", "YELLOW"),
            "risk_factors": result.get("risk_factors", []),
            "model_version": result.get("model_version", "1.0.0"),
            "scored_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        logger.warning(f"[Middleware] Scoring failed for {declaration_id}: {exc}")
        risk_event = {
            "declaration_id": declaration_id,
            "ucr": ucr,
            "risk_score": 0.5,
            "risk_lane": "YELLOW",
            "risk_factors": ["scoring_service_error"],
            "error": str(exc),
            "scored_at": datetime.now(timezone.utc).isoformat(),
        }

    # Publish to Kafka + Dapr
    mw.publish_event(TOPIC_RISK_SCORED, risk_event, key=str(declaration_id))

    # Stream to Fluvio for real-time SOC dashboard
    if mw.fluvio:
        mw.fluvio.produce(FLUVIO_RISK_LIVE_STREAM, {
            "declaration_id": declaration_id,
            "ucr": ucr,
            "risk_lane": risk_event["risk_lane"],
            "risk_score": risk_event["risk_score"],
            "timestamp": risk_event["scored_at"],
        })


def setup_middleware() -> None:
    """Initialise all middleware clients for risk-engine."""
    global mw, tracer_provider

    # OpenTelemetry
    try:
        tracer_provider = init_tracer(SERVICE_NAME, SERVICE_VERSION)
        logger.info("[Middleware] OpenTelemetry tracer initialised")
    except Exception as exc:
        logger.warning(f"[Middleware] OTel init failed (non-fatal): {exc}")

    # Kafka + Dapr + Fluvio
    try:
        mw = MiddlewareBundle(
            service_name=SERVICE_NAME,
            consume_topics=[TOPIC_DECLARATIONS_SUBMITTED],
            handlers={
                TOPIC_DECLARATIONS_SUBMITTED: _handle_declaration_submitted,
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

    _consumer_thread = threading.Thread(target=_run, daemon=True, name="risk-engine-consumer")
    _consumer_thread.start()
    logger.info("[Middleware] Consumer thread started")
    return _consumer_thread


def publish_risk_scored(risk_event: dict[str, Any]) -> None:
    """Publish a risk scored event from the HTTP handler path."""
    if mw is None:
        return
    mw.publish_event(TOPIC_RISK_SCORED, risk_event, key=str(risk_event.get("declaration_id", "")))
    if mw.fluvio:
        mw.fluvio.produce(FLUVIO_RISK_LIVE_STREAM, {
            "declaration_id": risk_event.get("declaration_id"),
            "ucr": risk_event.get("ucr", ""),
            "risk_lane": risk_event.get("risk_lane", "YELLOW"),
            "risk_score": risk_event.get("risk_score", 0.5),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })


def publish_model_updated(model_version: str, accuracy: float) -> None:
    """Publish a model update event when the ML model is retrained."""
    if mw is None:
        return
    mw.publish_event(TOPIC_RISK_MODEL_UPDATED, {
        "model_version": model_version,
        "accuracy": accuracy,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })


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
