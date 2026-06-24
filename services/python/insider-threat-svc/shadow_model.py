"""
shadow_model.py — A/B parallel scoring with production and shadow IsolationForest models.

The ShadowModel runs both the production model and a candidate shadow model on every
/detect request when shadow mode is enabled. Results are logged to an in-memory ring
buffer and exposed via GET /ab/stats and GET /ab/recent endpoints.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, List, Optional

import numpy as np
from sklearn.ensemble import IsolationForest

from anomaly_detector import AnomalyDetector, AnomalyFeatures

COMPARISON_BUFFER_SIZE = 10_000
BLOCK_THRESHOLD = 0.85


@dataclass
class ComparisonRecord:
    """Single A/B comparison result."""
    timestamp: int
    production_score: float
    shadow_score: float
    production_blocked: bool
    shadow_blocked: bool
    model_version: str = "shadow-v1"


class ShadowModel:
    """Manages parallel production + shadow model scoring."""

    def __init__(self) -> None:
        self._enabled: bool = False
        self._shadow_detector: Optional[AnomalyDetector] = None
        self._buffer: Deque[ComparisonRecord] = deque(maxlen=COMPARISON_BUFFER_SIZE)

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def enable(self, shadow_detector: AnomalyDetector) -> None:
        """Activate shadow mode with the given shadow detector."""
        self._shadow_detector = shadow_detector
        self._enabled = True

    def disable(self) -> None:
        """Deactivate shadow mode."""
        self._enabled = False
        self._shadow_detector = None

    @property
    def is_enabled(self) -> bool:
        return self._enabled

    # ── Scoring ───────────────────────────────────────────────────────────────

    def score(
        self,
        features: AnomalyFeatures,
        production_score: float,
    ) -> Optional[float]:
        """
        Score features with the shadow model.
        Returns shadow score if enabled, else None.
        """
        if not self._enabled or self._shadow_detector is None:
            return None

        shadow_score = self._shadow_detector.score(features)
        record = ComparisonRecord(
            timestamp=int(time.time() * 1000),
            production_score=production_score,
            shadow_score=shadow_score,
            production_blocked=production_score >= BLOCK_THRESHOLD,
            shadow_blocked=shadow_score >= BLOCK_THRESHOLD,
        )
        self._buffer.append(record)
        return shadow_score

    # ── Statistics ────────────────────────────────────────────────────────────

    def get_stats(self) -> Dict:
        """Compute A/B comparison statistics over the full buffer."""
        if not self._buffer:
            return {
                "enabled": self._enabled,
                "total_comparisons": 0,
                "production_mean": 0.0,
                "shadow_mean": 0.0,
                "agreement_rate": 0.0,
                "production_block_rate": 0.0,
                "shadow_block_rate": 0.0,
                "score_distribution": {"production": [0] * 5, "shadow": [0] * 5},
            }

        records = list(self._buffer)
        prod_scores = np.array([r.production_score for r in records])
        shadow_scores = np.array([r.shadow_score for r in records])
        agreements = sum(
            1 for r in records if r.production_blocked == r.shadow_blocked
        )

        def bucket_distribution(scores: np.ndarray) -> List[int]:
            """Count scores in 5 equal-width buckets over [0, 1]."""
            buckets = [0] * 5
            for s in scores:
                idx = min(int(s / 0.2), 4)
                buckets[idx] += 1
            return buckets

        return {
            "enabled": self._enabled,
            "total_comparisons": len(records),
            "production_mean": float(np.mean(prod_scores)),
            "shadow_mean": float(np.mean(shadow_scores)),
            "agreement_rate": agreements / len(records),
            "production_block_rate": float(np.mean(prod_scores >= BLOCK_THRESHOLD)),
            "shadow_block_rate": float(np.mean(shadow_scores >= BLOCK_THRESHOLD)),
            "score_distribution": {
                "production": bucket_distribution(prod_scores),
                "shadow": bucket_distribution(shadow_scores),
            },
        }

    def get_recent(self, limit: int = 100) -> Dict:
        """Return the most recent comparison records."""
        records = list(self._buffer)[-limit:]
        return {
            "enabled": self._enabled,
            "records": [
                {
                    "timestamp": r.timestamp,
                    "production_score": r.production_score,
                    "shadow_score": r.shadow_score,
                    "production_blocked": r.production_blocked,
                    "shadow_blocked": r.shadow_blocked,
                    "model_version": r.model_version,
                }
                for r in records
            ],
        }

    def clear(self) -> None:
        """Clear the comparison buffer (useful for testing)."""
        self._buffer.clear()


# Module-level singleton
_shadow_model = ShadowModel()


def get_shadow_model() -> ShadowModel:
    return _shadow_model
