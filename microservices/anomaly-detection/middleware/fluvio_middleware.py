"""
fluvio_middleware.py — Fluvio real-time streaming for Python AI services.
Publishes AI inference results to Fluvio topics for real-time dashboard consumption.
"""
import json
import logging
import os
from typing import Any, Dict

import requests

logger = logging.getLogger(__name__)


class FluvioMiddleware:
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.base_url = os.getenv("FLUVIO_HTTP_URL", "http://fluvio:9003")
        self.session = requests.Session()
        self.session.timeout = 3

    def produce(self, topic: str, payload: Dict[str, Any]) -> bool:
        """Produce a message to a Fluvio topic. Non-fatal on failure."""
        try:
            url = f"{self.base_url}/produce/{topic}"
            resp = self.session.post(url, json=payload)
            if resp.status_code < 300:
                logger.info(f"[{self.service_name}] Fluvio produced to {topic}")
                return True
            logger.warning(f"[{self.service_name}] Fluvio produce non-2xx: {resp.status_code}")
            return False
        except Exception as e:
            logger.warning(f"[{self.service_name}] Fluvio produce failed (non-fatal): {e}")
            return False

    def stream_risk_score(self, declaration_id: str, score: float, lane: str):
        self.produce("declaration.risk-scored", {
            "declaration_id": declaration_id,
            "risk_score": score,
            "lane": lane,
            "source": self.service_name,
        })

    def stream_sanctions_hit(self, entity_name: str, declaration_id: str, confidence: float):
        self.produce("sanctions.hit", {
            "entity_name": entity_name,
            "declaration_id": declaration_id,
            "confidence": confidence,
            "source": self.service_name,
        })

    def stream_anomaly_alert(self, declaration_id: str, anomaly_type: str, score: float):
        self.produce("security.alert", {
            "declaration_id": declaration_id,
            "anomaly_type": anomaly_type,
            "score": score,
            "source": self.service_name,
        })
