"""
lakehouse_middleware.py — Delta Lake ingest for Python AI service inference logs,
training datasets, and model performance metrics.

Tables written by AI services:
  - risk_scores          (risk-ai: ML risk scores per declaration)
  - hs_classifications   (hs-classifier: HS code predictions)
  - sanctions_checks     (sanctions-service: entity screening results)
  - anomaly_detections   (anomaly-detection: statistical anomalies)
  - gnn_graph_scores     (gnn-risk: graph propagation results)
  - model_metrics        (all: model performance tracking for MLOps)
"""
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)


class LakehouseMiddleware:
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.base_url = os.getenv("LAKEHOUSE_HTTP_URL", "http://lakehouse-ingest:8097")
        self.session = requests.Session()
        self.session.timeout = 10

    def ingest(self, table: str, records: List[Dict[str, Any]]) -> bool:
        """
        Ingest records into a Delta Lake table via the lakehouse HTTP ingest API.
        Non-fatal: primary store is PostgreSQL; lakehouse is for analytics.
        """
        for record in records:
            if "partition_date" not in record:
                record["partition_date"] = datetime.utcnow().strftime("%Y-%m-%d")
        try:
            payload = {"table": table, "records": records}
            resp = self.session.post(f"{self.base_url}/ingest", json=payload)
            if resp.status_code < 300:
                logger.info(f"[{self.service_name}] Ingested {len(records)} records to {table}")
                return True
            logger.warning(f"[{self.service_name}] Lakehouse ingest non-2xx: {resp.status_code}")
            return False
        except Exception as e:
            logger.warning(f"[{self.service_name}] Lakehouse ingest failed (non-fatal): {e}")
            return False

    # ── Convenience methods for each AI service ───────────────────────────────

    def ingest_risk_score(self, declaration_id: str, ucr: str, score: float,
                          lane: str, features: Dict, model_version: str):
        self.ingest("risk_scores", [{
            "declaration_id": declaration_id,
            "ucr": ucr,
            "risk_score": score,
            "lane": lane,
            "features": str(features),
            "model_version": model_version,
            "service": self.service_name,
            "scored_at": datetime.utcnow().isoformat(),
        }])

    def ingest_hs_classification(self, declaration_id: str, goods_desc: str,
                                  predicted_hs: str, confidence: float,
                                  top_candidates: List[Dict], model_version: str):
        self.ingest("hs_classifications", [{
            "declaration_id": declaration_id,
            "goods_description": goods_desc,
            "predicted_hs_code": predicted_hs,
            "confidence": confidence,
            "top_candidates": str(top_candidates),
            "model_version": model_version,
            "service": self.service_name,
            "classified_at": datetime.utcnow().isoformat(),
        }])

    def ingest_sanctions_check(self, entity_name: str, declaration_id: str,
                                hit: bool, confidence: float,
                                matched_list: Optional[str], match_details: Dict):
        self.ingest("sanctions_checks", [{
            "entity_name": entity_name,
            "declaration_id": declaration_id,
            "hit": hit,
            "confidence": confidence,
            "matched_list": matched_list,
            "match_details": str(match_details),
            "service": self.service_name,
            "checked_at": datetime.utcnow().isoformat(),
        }])

    def ingest_anomaly_detection(self, declaration_id: str, anomaly_type: str,
                                  score: float, features: Dict, threshold: float):
        self.ingest("anomaly_detections", [{
            "declaration_id": declaration_id,
            "anomaly_type": anomaly_type,
            "anomaly_score": score,
            "threshold": threshold,
            "features": str(features),
            "is_anomaly": score > threshold,
            "service": self.service_name,
            "detected_at": datetime.utcnow().isoformat(),
        }])

    def ingest_model_metrics(self, model_name: str, model_version: str,
                              metrics: Dict[str, float], eval_dataset_size: int):
        self.ingest("model_metrics", [{
            "model_name": model_name,
            "model_version": model_version,
            "metrics": str(metrics),
            "eval_dataset_size": eval_dataset_size,
            "service": self.service_name,
            "recorded_at": datetime.utcnow().isoformat(),
        }])
