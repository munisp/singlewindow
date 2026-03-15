"""
redis_middleware.py — Redis caching for Python AI service inference results.
Uses Webdis HTTP API for portability; swap for redis-py in production.
"""

import json
import logging
import os
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)


def _redis_url() -> str:
    return os.getenv("REDIS_HTTP_URL", "http://redis:7379")


class RedisMiddleware:
    """
    Redis caching middleware for AI service inference results.
    Provides TTL-based caching for risk scores, HS lookups, and model outputs.
    """

    def __init__(self, service_name: str):
        self.service_name = service_name
        self.base_url = _redis_url()
        self.session = requests.Session()
        self.session.timeout = 0.5

    def set(self, key: str, value: Any, ttl_seconds: int = 300) -> bool:
        """Set a key with TTL. Value is JSON-serialized."""
        try:
            serialized = json.dumps(value, default=str)
            url = f"{self.base_url}/SETEX/{key}/{ttl_seconds}/{serialized}"
            resp = self.session.get(url)
            return resp.status_code == 200
        except Exception as e:
            logger.warning(f"[{self.service_name}] Redis SET failed (non-fatal): {e}")
            return False

    def get(self, key: str) -> Optional[Any]:
        """Get a cached value. Returns None on miss or error."""
        try:
            url = f"{self.base_url}/GET/{key}"
            resp = self.session.get(url)
            body = resp.json()
            raw = body.get("GET")
            if raw is None:
                return None
            return json.loads(raw)
        except Exception:
            return None

    def delete(self, key: str):
        """Delete a cached key."""
        try:
            url = f"{self.base_url}/DEL/{key}"
            self.session.get(url)
        except Exception:
            pass

    # ── Convenience methods for common AI service cache patterns ──────────────

    def cache_risk_score(self, declaration_id: str, score: float, lane: str, ttl: int = 120):
        key = f"risk:score:{declaration_id}"
        self.set(key, {"score": score, "lane": lane}, ttl)

    def get_risk_score(self, declaration_id: str) -> Optional[Dict]:
        return self.get(f"risk:score:{declaration_id}")

    def cache_hs_classification(self, goods_desc_hash: str, hs_code: str, confidence: float, ttl: int = 3600):
        key = f"hs:classify:{goods_desc_hash}"
        self.set(key, {"hs_code": hs_code, "confidence": confidence}, ttl)

    def get_hs_classification(self, goods_desc_hash: str) -> Optional[Dict]:
        return self.get(f"hs:classify:{goods_desc_hash}")

    def cache_sanctions_check(self, entity_hash: str, result: Dict, ttl: int = 600):
        key = f"sanctions:{entity_hash}"
        self.set(key, result, ttl)

    def get_sanctions_check(self, entity_hash: str) -> Optional[Dict]:
        return self.get(f"sanctions:{entity_hash}")

    def cache_anomaly_result(self, declaration_id: str, result: Dict, ttl: int = 300):
        key = f"anomaly:{declaration_id}"
        self.set(key, result, ttl)

    def get_anomaly_result(self, declaration_id: str) -> Optional[Dict]:
        return self.get(f"anomaly:{declaration_id}")
