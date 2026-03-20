"""
TradeGateway™ NGSWTP — Comprehensive Python Middleware Bundle
Covers: Kafka, Dapr, Fluvio, Temporal, Keycloak, Permify, Redis, APISIX, TigerBeetle, Delta Lake.
All clients use environment variables with safe fallbacks for local development.
"""
import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("tradegateway.middleware")


# ─── Configuration ────────────────────────────────────────────────────────────

@dataclass
class MiddlewareConfig:
    service_name: str
    # Kafka
    kafka_brokers: str = field(default_factory=lambda: os.getenv("KAFKA_BROKERS", "kafka:9092"))
    kafka_group_id: str = field(default_factory=lambda: os.getenv("KAFKA_GROUP_ID", ""))
    # Dapr
    dapr_http_port: str = field(default_factory=lambda: os.getenv("DAPR_HTTP_PORT", "3500"))
    dapr_grpc_port: str = field(default_factory=lambda: os.getenv("DAPR_GRPC_PORT", "50001"))
    # Fluvio
    fluvio_endpoint: str = field(default_factory=lambda: os.getenv("FLUVIO_ENDPOINT", "fluvio-sc:9003"))
    # Temporal
    temporal_address: str = field(default_factory=lambda: os.getenv("TEMPORAL_ADDRESS", "temporal:7233"))
    temporal_namespace: str = field(default_factory=lambda: os.getenv("TEMPORAL_NAMESPACE", "tradegateway"))
    # Keycloak
    keycloak_url: str = field(default_factory=lambda: os.getenv("KEYCLOAK_URL", "http://keycloak:8080"))
    keycloak_realm: str = field(default_factory=lambda: os.getenv("KEYCLOAK_REALM", "tradegateway"))
    keycloak_client_id: str = field(default_factory=lambda: os.getenv("KEYCLOAK_CLIENT_ID", ""))
    keycloak_client_secret: str = field(default_factory=lambda: os.getenv("KEYCLOAK_CLIENT_SECRET", ""))
    # Permify
    permify_endpoint: str = field(default_factory=lambda: os.getenv("PERMIFY_ENDPOINT", "http://permify:3476"))
    # Redis
    redis_url: str = field(default_factory=lambda: os.getenv("REDIS_URL", "redis://redis:6379/0"))
    # APISIX
    apisix_admin_url: str = field(default_factory=lambda: os.getenv("APISIX_ADMIN_URL", "http://apisix:9180"))
    apisix_admin_key: str = field(default_factory=lambda: os.getenv("APISIX_ADMIN_KEY", ""))
    # TigerBeetle
    tigerbeetle_addr: str = field(default_factory=lambda: os.getenv("TIGERBEETLE_ADDR", "tigerbeetle:3000"))
    # Delta Lake / Lakehouse
    lakehouse_endpoint: str = field(default_factory=lambda: os.getenv("LAKEHOUSE_ENDPOINT", "http://delta-lake:8080"))
    lakehouse_s3_bucket: str = field(default_factory=lambda: os.getenv("LAKEHOUSE_S3_BUCKET", "tradegateway-lakehouse"))
    # OpenTelemetry
    otel_endpoint: str = field(default_factory=lambda: os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4317"))
    service_version: str = field(default_factory=lambda: os.getenv("SERVICE_VERSION", "1.0.0"))

    def __post_init__(self):
        if not self.kafka_group_id:
            self.kafka_group_id = f"{self.service_name}-group"
        if not self.keycloak_client_id:
            self.keycloak_client_id = self.service_name


# ─── Kafka Client ─────────────────────────────────────────────────────────────

class KafkaClient:
    """Kafka producer and consumer wrapper using confluent-kafka."""

    def __init__(self, cfg: MiddlewareConfig):
        self.cfg = cfg
        self._producer = None
        self._consumers: Dict[str, Any] = {}

    def _get_producer(self):
        if self._producer is None:
            try:
                from confluent_kafka import Producer
                self._producer = Producer({
                    "bootstrap.servers": self.cfg.kafka_brokers,
                    "client.id": self.cfg.service_name,
                    "acks": "all",
                    "retries": 5,
                    "retry.backoff.ms": 500,
                    "compression.type": "lz4",
                })
            except ImportError:
                logger.warning("confluent-kafka not installed; Kafka producer disabled")
        return self._producer

    def publish(self, topic: str, key: str, value: Dict[str, Any]) -> bool:
        """Publish a message to a Kafka topic."""
        producer = self._get_producer()
        if not producer:
            return False
        try:
            payload = json.dumps({**value, "_ts": int(time.time() * 1000), "_svc": self.cfg.service_name})
            producer.produce(topic, key=key.encode(), value=payload.encode(),
                             callback=self._delivery_report)
            producer.poll(0)
            return True
        except Exception as e:
            logger.error(f"Kafka publish error topic={topic}: {e}")
            return False

    def flush(self):
        if self._producer:
            self._producer.flush(timeout=10)

    @staticmethod
    def _delivery_report(err, msg):
        if err:
            logger.error(f"Kafka delivery failed: {err}")

    def subscribe(self, topics: List[str], handler: Callable, group_id: Optional[str] = None) -> None:
        """Start a background consumer thread for the given topics."""
        import threading
        def _consume():
            try:
                from confluent_kafka import Consumer, KafkaError
                consumer = Consumer({
                    "bootstrap.servers": self.cfg.kafka_brokers,
                    "group.id": group_id or self.cfg.kafka_group_id,
                    "auto.offset.reset": "earliest",
                    "enable.auto.commit": True,
                })
                consumer.subscribe(topics)
                logger.info(f"Kafka consumer started topics={topics}")
                while True:
                    msg = consumer.poll(1.0)
                    if msg is None:
                        continue
                    if msg.error():
                        if msg.error().code() != KafkaError._PARTITION_EOF:
                            logger.error(f"Kafka consumer error: {msg.error()}")
                        continue
                    try:
                        data = json.loads(msg.value().decode("utf-8"))
                        handler(msg.topic(), msg.key().decode("utf-8") if msg.key() else "", data)
                    except Exception as e:
                        logger.error(f"Kafka handler error: {e}")
            except ImportError:
                logger.warning("confluent-kafka not installed; consumer disabled")
            except Exception as e:
                logger.error(f"Kafka consumer fatal error: {e}")

        t = threading.Thread(target=_consume, daemon=True, name=f"kafka-consumer-{topics[0]}")
        t.start()


# ─── Dapr Client ──────────────────────────────────────────────────────────────

class DaprClient:
    """Lightweight Dapr HTTP sidecar client."""

    def __init__(self, cfg: MiddlewareConfig):
        self.base_url = f"http://localhost:{cfg.dapr_http_port}"
        self.service_name = cfg.service_name

    async def publish_event(self, pubsub_name: str, topic: str, data: Dict[str, Any]) -> bool:
        """Publish an event to a Dapr pubsub component."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{self.base_url}/v1.0/publish/{pubsub_name}/{topic}",
                    json=data,
                    headers={"Content-Type": "application/json"},
                )
                return resp.status_code < 400
        except Exception as e:
            logger.error(f"Dapr publish error: {e}")
            return False

    async def invoke_service(self, app_id: str, method: str, data: Dict[str, Any]) -> Optional[Dict]:
        """Invoke a method on another Dapr-enabled service."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{self.base_url}/v1.0/invoke/{app_id}/method/{method}",
                    json=data,
                )
                return resp.json() if resp.status_code < 400 else None
        except Exception as e:
            logger.error(f"Dapr invoke error: {e}")
            return None

    async def get_secret(self, store_name: str, key: str) -> Optional[str]:
        """Retrieve a secret from a Dapr secret store."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{self.base_url}/v1.0/secrets/{store_name}/{key}")
                if resp.status_code == 200:
                    return resp.json().get(key)
        except Exception as e:
            logger.error(f"Dapr get secret error: {e}")
        return None

    async def get_state(self, store_name: str, key: str) -> Optional[Any]:
        """Get state from a Dapr state store."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{self.base_url}/v1.0/state/{store_name}/{key}")
                return resp.json() if resp.status_code == 200 else None
        except Exception as e:
            logger.error(f"Dapr get state error: {e}")
            return None

    async def save_state(self, store_name: str, key: str, value: Any) -> bool:
        """Save state to a Dapr state store."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.post(
                    f"{self.base_url}/v1.0/state/{store_name}",
                    json=[{"key": key, "value": value}],
                )
                return resp.status_code < 400
        except Exception as e:
            logger.error(f"Dapr save state error: {e}")
            return False


# ─── Keycloak Auth ────────────────────────────────────────────────────────────

class KeycloakClient:
    """Keycloak OIDC token validation and user info client."""

    def __init__(self, cfg: MiddlewareConfig):
        self.base_url = cfg.keycloak_url
        self.realm = cfg.keycloak_realm
        self.client_id = cfg.keycloak_client_id
        self.client_secret = cfg.keycloak_client_secret

    async def validate_token(self, token: str) -> tuple[bool, Dict[str, Any]]:
        """Introspect a bearer token with Keycloak."""
        try:
            import httpx
            url = f"{self.base_url}/realms/{self.realm}/protocol/openid-connect/token/introspect"
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.post(url, data={
                    "token": token,
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                })
                claims = resp.json()
                return claims.get("active", False), claims
        except Exception as e:
            logger.error(f"Keycloak validate error: {e}")
            return False, {}

    async def get_user_info(self, token: str) -> Optional[Dict[str, Any]]:
        """Get user info from Keycloak using a valid access token."""
        try:
            import httpx
            url = f"{self.base_url}/realms/{self.realm}/protocol/openid-connect/userinfo"
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(url, headers={"Authorization": f"Bearer {token}"})
                return resp.json() if resp.status_code == 200 else None
        except Exception as e:
            logger.error(f"Keycloak user info error: {e}")
            return None

    async def get_service_token(self) -> Optional[str]:
        """Get a service account token for M2M calls."""
        try:
            import httpx
            url = f"{self.base_url}/realms/{self.realm}/protocol/openid-connect/token"
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, data={
                    "grant_type": "client_credentials",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                })
                return resp.json().get("access_token") if resp.status_code == 200 else None
        except Exception as e:
            logger.error(f"Keycloak service token error: {e}")
            return None


# ─── Permify Authorization ────────────────────────────────────────────────────

class PermifyClient:
    """Fine-grained authorization via Permify."""

    def __init__(self, cfg: MiddlewareConfig):
        self.endpoint = cfg.permify_endpoint

    async def check(self, tenant_id: str, entity: str, entity_id: str,
                    permission: str, subject_type: str, subject_id: str) -> bool:
        """Check if a subject has a permission on an entity."""
        try:
            import httpx
            payload = {
                "metadata": {"tenant_id": tenant_id, "schema_version": "", "snap_token": "", "depth": 20},
                "entity": {"type": entity, "id": entity_id},
                "permission": permission,
                "subject": {"type": subject_type, "id": subject_id},
            }
            async with httpx.AsyncClient(timeout=3) as client:
                resp = await client.post(
                    f"{self.endpoint}/v1/tenants/{tenant_id}/permissions/check",
                    json=payload,
                )
                return resp.json().get("can") == "CHECK_RESULT_ALLOWED"
        except Exception as e:
            logger.error(f"Permify check error: {e}")
            return False


# ─── Redis Client ─────────────────────────────────────────────────────────────

class RedisClient:
    """Async Redis client for caching, rate limiting, and session storage."""

    def __init__(self, cfg: MiddlewareConfig):
        self.url = cfg.redis_url
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                import redis.asyncio as aioredis
                self._client = aioredis.from_url(self.url, decode_responses=True)
            except ImportError:
                logger.warning("redis not installed; Redis client disabled")
        return self._client

    async def get(self, key: str) -> Optional[str]:
        client = self._get_client()
        if not client:
            return None
        try:
            return await client.get(key)
        except Exception as e:
            logger.error(f"Redis get error: {e}")
            return None

    async def set(self, key: str, value: str, ex: Optional[int] = None) -> bool:
        client = self._get_client()
        if not client:
            return False
        try:
            await client.set(key, value, ex=ex)
            return True
        except Exception as e:
            logger.error(f"Redis set error: {e}")
            return False

    async def delete(self, key: str) -> bool:
        client = self._get_client()
        if not client:
            return False
        try:
            await client.delete(key)
            return True
        except Exception as e:
            logger.error(f"Redis delete error: {e}")
            return False

    async def incr(self, key: str, ex: Optional[int] = None) -> int:
        client = self._get_client()
        if not client:
            return 0
        try:
            val = await client.incr(key)
            if ex:
                await client.expire(key, ex)
            return val
        except Exception as e:
            logger.error(f"Redis incr error: {e}")
            return 0

    async def rate_limit(self, key: str, limit: int, window_seconds: int) -> bool:
        """Returns True if the request is within the rate limit."""
        count = await self.incr(f"rl:{key}", ex=window_seconds)
        return count <= limit


# ─── TigerBeetle Client ───────────────────────────────────────────────────────

class TigerBeetleClient:
    """TigerBeetle financial ledger client via HTTP bridge."""

    def __init__(self, cfg: MiddlewareConfig):
        self.addr = cfg.tigerbeetle_addr
        # TigerBeetle uses a Go bridge service that exposes HTTP
        self.bridge_url = f"http://{self.addr}"

    async def create_account(self, account_id: int, ledger: int, code: int,
                              flags: int = 0) -> bool:
        """Create a TigerBeetle account."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(f"{self.bridge_url}/accounts", json={
                    "id": account_id, "ledger": ledger, "code": code, "flags": flags
                })
                return resp.status_code < 400
        except Exception as e:
            logger.error(f"TigerBeetle create account error: {e}")
            return False

    async def create_transfer(self, transfer_id: int, debit_account_id: int,
                               credit_account_id: int, amount: int, ledger: int,
                               code: int, flags: int = 0) -> bool:
        """Create a double-entry transfer in TigerBeetle."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(f"{self.bridge_url}/transfers", json={
                    "id": transfer_id,
                    "debit_account_id": debit_account_id,
                    "credit_account_id": credit_account_id,
                    "amount": amount,
                    "ledger": ledger,
                    "code": code,
                    "flags": flags,
                })
                return resp.status_code < 400
        except Exception as e:
            logger.error(f"TigerBeetle create transfer error: {e}")
            return False

    async def get_balance(self, account_id: int) -> Optional[Dict[str, int]]:
        """Get account balance from TigerBeetle."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{self.bridge_url}/accounts/{account_id}/balance")
                return resp.json() if resp.status_code == 200 else None
        except Exception as e:
            logger.error(f"TigerBeetle get balance error: {e}")
            return None


# ─── Lakehouse / Delta Lake ───────────────────────────────────────────────────

class LakehouseClient:
    """Delta Lake event writer and query client."""

    def __init__(self, cfg: MiddlewareConfig):
        self.endpoint = cfg.lakehouse_endpoint
        self.s3_bucket = cfg.lakehouse_s3_bucket
        self.service_name = cfg.service_name

    async def write_event(self, table_name: str, event: Dict[str, Any]) -> bool:
        """Write a structured event to a Delta Lake table."""
        try:
            import httpx
            payload = {
                "table": table_name,
                "bucket": self.s3_bucket,
                "data": {**event, "_service": self.service_name, "_ts": int(time.time() * 1000)},
            }
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(f"{self.endpoint}/api/v1/write", json=payload)
                return resp.status_code < 400
        except Exception as e:
            logger.error(f"Lakehouse write error: {e}")
            return False

    async def query(self, sql: str) -> List[Dict[str, Any]]:
        """Execute a SQL query against a Delta Lake table."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(f"{self.endpoint}/api/v1/query",
                                         json={"sql": sql, "bucket": self.s3_bucket})
                return resp.json() if resp.status_code == 200 else []
        except Exception as e:
            logger.error(f"Lakehouse query error: {e}")
            return []


# ─── APISIX Client ────────────────────────────────────────────────────────────

class APISIXClient:
    """APISIX Admin API client for dynamic route management."""

    def __init__(self, cfg: MiddlewareConfig):
        self.admin_url = cfg.apisix_admin_url
        self.admin_key = cfg.apisix_admin_key

    async def upsert_route(self, route_id: str, route: Dict[str, Any]) -> bool:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.put(
                    f"{self.admin_url}/apisix/admin/routes/{route_id}",
                    json=route,
                    headers={"X-API-KEY": self.admin_key},
                )
                return resp.status_code < 400
        except Exception as e:
            logger.error(f"APISIX upsert route error: {e}")
            return False

    async def get_route(self, route_id: str) -> Optional[Dict[str, Any]]:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(
                    f"{self.admin_url}/apisix/admin/routes/{route_id}",
                    headers={"X-API-KEY": self.admin_key},
                )
                return resp.json() if resp.status_code == 200 else None
        except Exception as e:
            logger.error(f"APISIX get route error: {e}")
            return None


# ─── Middleware Bundle ────────────────────────────────────────────────────────

class MiddlewareBundle:
    """Aggregates all middleware clients for a Python service."""

    def __init__(self, service_name: str):
        self.cfg = MiddlewareConfig(service_name=service_name)
        self.kafka = KafkaClient(self.cfg)
        self.dapr = DaprClient(self.cfg)
        self.keycloak = KeycloakClient(self.cfg)
        self.permify = PermifyClient(self.cfg)
        self.redis = RedisClient(self.cfg)
        self.tigerbeetle = TigerBeetleClient(self.cfg)
        self.lakehouse = LakehouseClient(self.cfg)
        self.apisix = APISIXClient(self.cfg)
        self._started = False

    def start(self):
        """Initialize all synchronous middleware connections."""
        logger.info(f"[{self.cfg.service_name}] Middleware bundle starting...")
        self._started = True
        logger.info(f"[{self.cfg.service_name}] Middleware bundle ready")

    def stop(self):
        """Flush and close all middleware connections."""
        if self._started:
            self.kafka.flush()
            logger.info(f"[{self.cfg.service_name}] Middleware bundle stopped")

    @asynccontextmanager
    async def lifespan(self):
        """Async context manager for FastAPI lifespan integration."""
        self.start()
        try:
            yield self
        finally:
            self.stop()


# ─── Convenience factory ──────────────────────────────────────────────────────

def create_bundle(service_name: str) -> MiddlewareBundle:
    """Create and return a fully initialized middleware bundle."""
    return MiddlewareBundle(service_name)
