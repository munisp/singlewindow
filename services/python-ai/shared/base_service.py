"""
base_service.py — Production-ready FastAPI base for all TradeGateway™ NGSWTP Python AI services.

Provides:
  - /healthz  — liveness probe
  - /readyz   — readiness probe (checks DB, Kafka, Redis)
  - /metrics  — Prometheus metrics (via prometheus_client)
  - Structured JSON logging
  - Retry logic with exponential backoff (tenacity)
  - Graceful shutdown
  - Request ID propagation
  - Model loading lifecycle management
  - CORS + security headers
"""
from __future__ import annotations

import json
import logging
import os
import signal
import sys
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, Callable, Dict, List, Optional

import psycopg2
import psycopg2.extras
import requests
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import (
    Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
)
from tenacity import (
    retry, stop_after_attempt, wait_exponential,
    retry_if_exception_type, before_sleep_log
)

# ─── Structured JSON Logging ──────────────────────────────────────────────────

class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S.%fZ"),
            "level": record.levelname,
            "service": getattr(record, "service", "unknown"),
            "message": record.getMessage(),
            "logger": record.name,
        }
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)
        if hasattr(record, "request_id"):
            log_data["request_id"] = record.request_id
        if hasattr(record, "duration_ms"):
            log_data["duration_ms"] = record.duration_ms
        return json.dumps(log_data)


def setup_logging(service_name: str) -> logging.Logger:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler])
    logger = logging.getLogger(service_name)
    logger.setLevel(logging.INFO)
    return logger


# ─── Prometheus Metrics ───────────────────────────────────────────────────────

def create_metrics(service_name: str):
    labels = ["service", "method", "path", "status"]
    return {
        "requests_total": Counter(
            "http_requests_total",
            "Total HTTP requests",
            labels,
        ),
        "request_duration": Histogram(
            "http_request_duration_seconds",
            "HTTP request duration",
            ["service", "method", "path"],
            buckets=[.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10],
        ),
        "model_inference_duration": Histogram(
            "model_inference_duration_seconds",
            "ML model inference duration",
            ["service", "model_name"],
            buckets=[.01, .05, .1, .25, .5, 1, 2.5, 5],
        ),
        "model_loaded": Gauge(
            "model_loaded",
            "Whether the ML model is loaded (1=yes, 0=no)",
            ["service", "model_name"],
        ),
        "db_connections": Gauge(
            "db_connections_active",
            "Active database connections",
            ["service"],
        ),
        "kafka_messages_produced": Counter(
            "kafka_messages_produced_total",
            "Total Kafka messages produced",
            ["service", "topic"],
        ),
        "kafka_messages_consumed": Counter(
            "kafka_messages_consumed_total",
            "Total Kafka messages consumed",
            ["service", "topic"],
        ),
    }


# ─── Health Check Registry ────────────────────────────────────────────────────

class HealthCheck:
    def __init__(self, name: str, check_fn: Callable[[], bool]):
        self.name = name
        self.check_fn = check_fn

    def run(self) -> tuple[str, bool, Optional[str]]:
        try:
            ok = self.check_fn()
            return self.name, ok, None
        except Exception as e:
            return self.name, False, str(e)


class HealthRegistry:
    def __init__(self):
        self._checks: List[HealthCheck] = []
        self._ready = False

    def add(self, name: str, check_fn: Callable[[], bool]):
        self._checks.append(HealthCheck(name, check_fn))

    def set_ready(self, ready: bool):
        self._ready = ready

    def is_ready(self) -> bool:
        return self._ready

    def run_all(self) -> Dict[str, Any]:
        results = {}
        all_ok = True
        for check in self._checks:
            name, ok, err = check.run()
            results[name] = "ok" if ok else (err or "failed")
            if not ok:
                all_ok = False
        return {"all_ok": all_ok, "checks": results}


# ─── Retry Decorators ─────────────────────────────────────────────────────────

def with_retry(max_attempts: int = 3, min_wait: float = 1.0, max_wait: float = 10.0):
    """Decorator for retrying transient failures with exponential backoff."""
    logger = logging.getLogger("retry")
    return retry(
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=1, min=min_wait, max=max_wait),
        retry=retry_if_exception_type((
            requests.exceptions.ConnectionError,
            requests.exceptions.Timeout,
            psycopg2.OperationalError,
        )),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )


# ─── Database Connection with Retry ──────────────────────────────────────────

@retry(
    stop=stop_after_attempt(10),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type(psycopg2.OperationalError),
    reraise=True,
)
def connect_db(database_url: str) -> psycopg2.extensions.connection:
    """Connect to PostgreSQL with retry on startup."""
    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    return conn


# ─── Base Service Factory ─────────────────────────────────────────────────────

def create_app(
    service_name: str,
    version: str = "1.0.0",
    description: str = "",
    startup_fn: Optional[Callable] = None,
    shutdown_fn: Optional[Callable] = None,
) -> tuple[FastAPI, logging.Logger, HealthRegistry, dict]:
    """
    Create a production-ready FastAPI application with all standard middleware.

    Returns:
        (app, logger, health_registry, metrics)
    """
    logger = setup_logging(service_name)
    health = HealthRegistry()
    metrics = create_metrics(service_name)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logger.info(f"Starting {service_name} v{version}")
        try:
            if startup_fn:
                await startup_fn() if asyncio_is_coroutine(startup_fn) else startup_fn()
            health.set_ready(True)
            logger.info(f"{service_name} ready")
        except Exception as e:
            logger.error(f"Startup failed: {e}")
            health.set_ready(False)
        yield
        logger.info(f"Shutting down {service_name}")
        health.set_ready(False)
        if shutdown_fn:
            try:
                await shutdown_fn() if asyncio_is_coroutine(shutdown_fn) else shutdown_fn()
            except Exception as e:
                logger.error(f"Shutdown error: {e}")
        logger.info(f"{service_name} shutdown complete")

    app = FastAPI(
        title=service_name,
        version=version,
        description=description,
        lifespan=lifespan,
        docs_url="/docs" if os.getenv("ENVIRONMENT") != "production" else None,
        redoc_url=None,
    )

    # ── CORS ──────────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=os.getenv("CORS_ORIGINS", "").split(",") or ["*"],
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    )

    # ── Request ID + Logging Middleware ───────────────────────────────────────
    @app.middleware("http")
    async def request_middleware(request: Request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        start = time.time()

        response = await call_next(request)

        duration_ms = (time.time() - start) * 1000
        response.headers["X-Request-ID"] = request_id

        if request.url.path not in ("/healthz", "/readyz", "/metrics"):
            logger.info(
                f"{request.method} {request.url.path} {response.status_code}",
                extra={
                    "service": service_name,
                    "request_id": request_id,
                    "duration_ms": round(duration_ms, 2),
                }
            )
            metrics["requests_total"].labels(
                service=service_name,
                method=request.method,
                path=request.url.path,
                status=str(response.status_code),
            ).inc()
            metrics["request_duration"].labels(
                service=service_name,
                method=request.method,
                path=request.url.path,
            ).observe(duration_ms / 1000)

        return response

    # ── Security Headers ──────────────────────────────────────────────────────
    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Service"] = service_name
        return response

    # ── Built-in Endpoints ────────────────────────────────────────────────────
    @app.get("/healthz", tags=["health"])
    def liveness():
        return {"status": "alive", "service": service_name, "version": version}

    @app.get("/readyz", tags=["health"])
    def readiness():
        if not health.is_ready():
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready", "service": service_name, "reason": "initializing"},
            )
        result = health.run_all()
        status_code = 200 if result["all_ok"] else 503
        return JSONResponse(
            status_code=status_code,
            content={
                "status": "ready" if result["all_ok"] else "degraded",
                "service": service_name,
                "version": version,
                "checks": result["checks"],
            },
        )

    @app.get("/metrics", tags=["observability"])
    def prometheus_metrics():
        return Response(
            content=generate_latest(),
            media_type=CONTENT_TYPE_LATEST,
        )

    return app, logger, health, metrics


def asyncio_is_coroutine(fn) -> bool:
    import asyncio
    return asyncio.iscoroutinefunction(fn)
