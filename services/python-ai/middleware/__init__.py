"""
middleware/__init__.py — Shared middleware package for TradeGateway Python AI services.

Provides:
  - KafkaMiddleware: Confluent Kafka producer/consumer for all AI service topics
  - RedisMiddleware: Redis caching for ML inference results
  - FluvioMiddleware: Real-time streaming of AI results to dashboards
  - KeycloakMiddleware: JWT validation via JWKS endpoint
  - LakehouseMiddleware: Delta Lake ingest for ML training data and inference logs
  - PermifyMiddleware: Fine-grained authorization for AI service endpoints
  - APISIXMiddleware: Route registration on startup

Usage:
    from middleware import KafkaMiddleware, RedisMiddleware, LakehouseMiddleware
    kafka = KafkaMiddleware(service_name="risk-ai")
    kafka.publish("declaration.risk-scored", {"declaration_id": "...", "score": 0.87})
"""

from .kafka_middleware import KafkaMiddleware
from .redis_middleware import RedisMiddleware
from .fluvio_middleware import FluvioMiddleware
from .keycloak_middleware import KeycloakMiddleware
from .lakehouse_middleware import LakehouseMiddleware
from .permify_middleware import PermifyMiddleware
from .apisix_middleware import APISIXMiddleware

__all__ = [
    "KafkaMiddleware",
    "RedisMiddleware",
    "FluvioMiddleware",
    "KeycloakMiddleware",
    "LakehouseMiddleware",
    "PermifyMiddleware",
    "APISIXMiddleware",
]
