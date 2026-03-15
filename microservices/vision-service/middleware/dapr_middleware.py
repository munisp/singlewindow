"""
dapr_middleware.py — Dapr sidecar integration for Python AI services.

Dapr capabilities used by Python AI services:
  - Service invocation: Call Go services (declaration-service, oga-service) directly
  - Pub/sub: Publish AI results to Dapr pub/sub (backed by Kafka)
  - State store: Store model metadata and inference session state (backed by Redis)
  - Secrets: Retrieve API keys and model credentials from Dapr secrets store
  - Bindings: Trigger scheduled model retraining via Dapr cron bindings
"""
import json
import logging
import os
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)


def _dapr_http_port() -> int:
    return int(os.getenv("DAPR_HTTP_PORT", "3500"))


class DaprMiddleware:
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.base_url = f"http://localhost:{_dapr_http_port()}"
        self.session = requests.Session()
        self.session.timeout = 5

    # ── Service Invocation ────────────────────────────────────────────────────

    def invoke(self, app_id: str, method: str, data: Optional[Dict] = None,
               http_method: str = "POST") -> Optional[Dict]:
        """
        Invoke a method on another Dapr-enabled service.
        app_id: Dapr app ID of the target service (e.g., "declaration-service")
        method: HTTP method path (e.g., "declarations/123")
        """
        url = f"{self.base_url}/v1.0/invoke/{app_id}/method/{method}"
        try:
            if http_method == "GET":
                resp = self.session.get(url)
            else:
                resp = self.session.post(url, json=data or {})
            if resp.status_code < 300:
                return resp.json() if resp.content else {}
            logger.warning(
                f"[{self.service_name}] Dapr invoke non-2xx: "
                f"app={app_id} method={method} status={resp.status_code}"
            )
            return None
        except Exception as e:
            logger.warning(f"[{self.service_name}] Dapr invoke failed: {e}")
            return None

    def get_declaration(self, declaration_id: str) -> Optional[Dict]:
        """Fetch declaration details from declaration-service via Dapr."""
        return self.invoke("declaration-service", f"declarations/{declaration_id}", http_method="GET")

    def get_trader_profile(self, trader_id: str) -> Optional[Dict]:
        """Fetch trader profile from profile-service via Dapr."""
        return self.invoke("profile-service", f"traders/{trader_id}", http_method="GET")

    # ── Pub/Sub ───────────────────────────────────────────────────────────────

    def publish(self, pubsub_name: str, topic: str, data: Dict[str, Any]) -> bool:
        """Publish a message to a Dapr pub/sub topic (backed by Kafka)."""
        url = f"{self.base_url}/v1.0/publish/{pubsub_name}/{topic}"
        try:
            resp = self.session.post(url, json=data)
            if resp.status_code < 300:
                logger.info(f"[{self.service_name}] Dapr published to {pubsub_name}/{topic}")
                return True
            return False
        except Exception as e:
            logger.warning(f"[{self.service_name}] Dapr publish failed: {e}")
            return False

    def publish_risk_result(self, declaration_id: str, score: float, lane: str):
        self.publish("kafka-pubsub", "declaration.risk-scored", {
            "declaration_id": declaration_id,
            "risk_score": score,
            "lane": lane,
            "source": self.service_name,
        })

    # ── State Store ───────────────────────────────────────────────────────────

    def state_set(self, store_name: str, key: str, value: Any) -> bool:
        """Save state to Dapr state store (backed by Redis)."""
        url = f"{self.base_url}/v1.0/state/{store_name}"
        try:
            resp = self.session.post(url, json=[{"key": key, "value": value}])
            return resp.status_code < 300
        except Exception as e:
            logger.warning(f"[{self.service_name}] Dapr state set failed: {e}")
            return False

    def state_get(self, store_name: str, key: str) -> Optional[Any]:
        """Get state from Dapr state store."""
        url = f"{self.base_url}/v1.0/state/{store_name}/{key}"
        try:
            resp = self.session.get(url)
            if resp.status_code == 200 and resp.content:
                return resp.json()
            return None
        except Exception:
            return None

    def save_model_metadata(self, model_name: str, version: str, metrics: Dict):
        """Save ML model metadata to Dapr state store."""
        self.state_set("redis-state", f"model:{model_name}:{version}", {
            "model_name": model_name,
            "version": version,
            "metrics": metrics,
            "service": self.service_name,
        })

    # ── Secrets ───────────────────────────────────────────────────────────────

    def get_secret(self, store_name: str, secret_name: str) -> Optional[str]:
        """Retrieve a secret from Dapr secrets store."""
        url = f"{self.base_url}/v1.0/secrets/{store_name}/{secret_name}"
        try:
            resp = self.session.get(url)
            if resp.status_code == 200:
                data = resp.json()
                return data.get(secret_name)
            return None
        except Exception as e:
            logger.warning(f"[{self.service_name}] Dapr secret fetch failed: {e}")
            return None
