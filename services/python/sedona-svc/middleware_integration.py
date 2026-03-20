"""
TradeGateway™ NGSWTP — sedona-svc Middleware Integration
Full bundle: Kafka, Dapr, Fluvio, Temporal, Keycloak, Permify, Redis, APISIX, TigerBeetle, Lakehouse.
"""
from __future__ import annotations
import logging
import os
from contextlib import asynccontextmanager
from middleware_bundle import MiddlewareBundle, create_bundle

logger = logging.getLogger("sedona-svc.middleware")

# ─── Global bundle instance ───────────────────────────────────────────────────
_bundle: MiddlewareBundle | None = None


def get_bundle() -> MiddlewareBundle:
    """Lazy-initialize and return the global middleware bundle."""
    global _bundle
    if _bundle is None:
        _bundle = create_bundle("sedona-svc")
    return _bundle


def setup_middleware() -> MiddlewareBundle:
    """Initialize the middleware bundle. Call from FastAPI lifespan startup."""
    bundle = get_bundle()
    bundle.start()
    logger.info("[sedona-svc] Full middleware bundle initialized — Kafka, Dapr, Keycloak, Permify, Redis, TigerBeetle, Lakehouse, APISIX")
    return bundle


def shutdown_middleware() -> None:
    """Shutdown the middleware bundle. Call from FastAPI lifespan shutdown."""
    global _bundle
    if _bundle is not None:
        _bundle.stop()
        _bundle = None
        logger.info("[sedona-svc] Middleware bundle shutdown complete")


def start_consumer_thread(topics: list[str], handler) -> None:
    """Start a background Kafka consumer thread for the given topics."""
    bundle = get_bundle()
    bundle.kafka.subscribe(topics, handler)
    logger.info(f"[sedona-svc] Kafka consumer started for topics: {topics}")


@asynccontextmanager
async def middleware_lifespan():
    """Async context manager for FastAPI lifespan integration.
    
    Usage in main.py:
        from middleware_integration import middleware_lifespan
        
        @asynccontextmanager
        async def lifespan(app: FastAPI):
            async with middleware_lifespan():
                yield
        
        app = FastAPI(lifespan=lifespan)
    """
    bundle = setup_middleware()
    try:
        yield bundle
    finally:
        shutdown_middleware()
