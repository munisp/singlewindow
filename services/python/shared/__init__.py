"""
TradeGateway™ NGSWTP — Python Shared Middleware
Exports the comprehensive MiddlewareBundle covering all 10 middleware technologies.
"""
from .middleware_full import (
    MiddlewareBundle,
    MiddlewareConfig,
    KafkaClient,
    DaprClient,
    KeycloakClient,
    PermifyClient,
    RedisClient,
    TigerBeetleClient,
    LakehouseClient,
    APISIXClient,
    create_bundle,
)

__all__ = [
    "MiddlewareBundle",
    "MiddlewareConfig",
    "KafkaClient",
    "DaprClient",
    "KeycloakClient",
    "PermifyClient",
    "RedisClient",
    "TigerBeetleClient",
    "LakehouseClient",
    "APISIXClient",
    "create_bundle",
]
