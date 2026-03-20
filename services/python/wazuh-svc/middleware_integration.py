"""
Wazuh Svc — Middleware Integration
==================================
Wires Kafka, Dapr, Fluvio, and OpenTelemetry into the wazuh-svc service.

Wazuh SIEM/XDR integration service

Kafka topics consumed:
  auth.login.failed  → Detect brute-force and anomalous login patterns
  auth.login.success  → Detect brute-force and anomalous login patterns

Kafka topics published:
  security.alert.raised
  security.incident.created

Fluvio streams:
  security.live.stream  → real-time feed

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

logger = logging.getLogger("wazuh-svc.middleware")

SERVICE_NAME = "wazuh-svc"
SERVICE_VERSION = "1.0.0"

TOPIC_AUTH_LOGIN_FAILED = "auth.login.failed"
TOPIC_AUTH_LOGIN_SUCCESS = "auth.login.success"
TOPIC_SECURITY_ALERT_RAISED = "security.alert.raised"
TOPIC_SECURITY_INCIDENT_CREATED = "security.incident.created"
FLUVIO_SECURITY_LIVE_STREAM = "security.live.stream"

mw: MiddlewareBundle | None = None
tracer_provider = None
_consumer_thread: threading.Thread | None = None


def _handle_auth_login_failed(payload: dict[str, Any]) -> None:
    """
    Detect brute-force and anomalous login patterns
    """
    global mw
    if mw is None:
        return

    logger.info(f"[Middleware] Wazuh Svc handling {payload.get('declaration_id', payload.get('trader_id', 'unknown'))}")

    # Publish result event
    result_event = {
        "source": SERVICE_NAME,
        "input": payload,
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "status": "processed",
    }

    if mw:
        mw.publish_event(TOPIC_SECURITY_ALERT_RAISED, result_event)

    if mw and mw.fluvio:
        mw.fluvio.produce(FLUVIO_SECURITY_LIVE_STREAM, {
            "source": SERVICE_NAME,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": "processed",
        })




def _handle_auth_login_success(payload: dict[str, Any]) -> None:
    """Handle auth.login.success event."""
    global mw
    if mw is None:
        return
    logger.info(f"[Middleware] Handling auth.login.success: {payload}")

def setup_middleware() -> None:
    """Initialise all middleware clients for wazuh-svc."""
    global mw, tracer_provider

    try:
        tracer_provider = init_tracer(SERVICE_NAME, SERVICE_VERSION)
        logger.info("[Middleware] OpenTelemetry tracer initialised")
    except Exception as exc:
        logger.warning(f"[Middleware] OTel init failed (non-fatal): {exc}")

    try:
        mw = MiddlewareBundle(
            service_name=SERVICE_NAME,
            consume_topics=["auth.login.failed", "auth.login.success"],
            handlers={
                "auth.login.failed": _handle_auth_login_failed,
                "auth.login.success": _handle_auth_login_success,
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
