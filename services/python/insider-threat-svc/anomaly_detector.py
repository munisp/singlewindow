"""
anomaly_detector.py — IsolationForest-based behavioural anomaly detector.

Features (5 dimensions):
  1. hour_of_day          (0–23)
  2. action_count_per_hour (rolling count from Redis)
  3. unique_records_accessed (distinct entity IDs in session)
  4. off_hours_flag        (1 if hour < 7 or hour > 20, else 0)
  5. role_mismatch_score   (0.0–1.0; elevated when action doesn't match role)

Scoring:
  IsolationForest.decision_function() returns negative values for anomalies.
  We normalise to [0, 1] where 1.0 = most anomalous.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import MinMaxScaler

logger = logging.getLogger(__name__)

# ─── Role-action mismatch table ───────────────────────────────────────────────
# Maps (role, action_category) → mismatch_score.
# Higher = more suspicious for that role to perform that action.
_ROLE_ACTION_MISMATCH: dict[tuple[str, str], float] = {
    ("trader", "admin"):          1.0,
    ("trader", "audit"):          0.8,
    ("trader", "bulk_export"):    0.6,
    ("customs_officer", "admin"): 0.9,
    ("customs_officer", "finance"): 0.7,
    ("finance", "admin"):         0.8,
    ("inspector", "admin"):       0.9,
    ("inspector", "finance"):     0.7,
}

_ACTION_CATEGORY_MAP: dict[str, str] = {
    "duty-override":    "finance",
    "aeo-revoke":       "admin",
    "bond-forfeiture":  "finance",
    "bulk-export":      "bulk_export",
    "delete-record":    "admin",
    "approve-payment":  "finance",
    "audit-query":      "audit",
    "user-promote":     "admin",
}


def _role_mismatch_score(role: str, action: str) -> float:
    category = _ACTION_CATEGORY_MAP.get(action, "general")
    return _ROLE_ACTION_MISMATCH.get((role.lower(), category), 0.0)


# ─── Feature extraction ───────────────────────────────────────────────────────

def extract_features(
    hour_of_day: int,
    action_count_per_hour: int,
    unique_records_accessed: int,
    role: str,
    action: str,
) -> np.ndarray:
    """
    Extract a 5-dimensional feature vector for a single event.
    Returns shape (1, 5).
    """
    off_hours = 1.0 if hour_of_day < 7 or hour_of_day > 20 else 0.0
    mismatch = _role_mismatch_score(role, action)

    return np.array([[
        float(hour_of_day),
        float(action_count_per_hour),
        float(unique_records_accessed),
        off_hours,
        mismatch,
    ]])


# ─── Scoring ──────────────────────────────────────────────────────────────────

def score_event(
    model: IsolationForest,
    scaler: Optional[MinMaxScaler],
    hour_of_day: int,
    action_count_per_hour: int,
    unique_records_accessed: int,
    role: str,
    action: str,
) -> float:
    """
    Score a single event. Returns anomaly score in [0.0, 1.0].
    0.0 = normal, 1.0 = highly anomalous.
    """
    features = extract_features(
        hour_of_day, action_count_per_hour,
        unique_records_accessed, role, action,
    )
    if scaler is not None:
        features = scaler.transform(features)

    # decision_function: negative = anomalous, positive = normal
    raw_score = model.decision_function(features)[0]

    # Normalise: map [-0.5, 0.5] → [1.0, 0.0] (invert so anomaly = high)
    normalised = float(np.clip(0.5 - raw_score, 0.0, 1.0))
    return round(normalised, 4)


# ─── Training ─────────────────────────────────────────────────────────────────

def build_feature_matrix(events: list[dict]) -> np.ndarray:
    """
    Build a feature matrix from a list of event dicts.
    Each dict must have: hour_of_day, action_count_per_hour,
    unique_records_accessed, role, action.
    """
    rows = []
    for e in events:
        vec = extract_features(
            e.get("hour_of_day", 12),
            e.get("action_count_per_hour", 1),
            e.get("unique_records_accessed", 1),
            e.get("role", "trader"),
            e.get("action", "general"),
        )
        rows.append(vec[0])
    return np.array(rows)


def train_model(
    events: list[dict],
    contamination: float = 0.05,
    n_estimators: int = 100,
    random_state: int = 42,
) -> tuple[IsolationForest, MinMaxScaler, dict]:
    """
    Train an IsolationForest on a list of event dicts.
    Returns (model, scaler, metrics).
    """
    if len(events) < 10:
        raise ValueError(f"Need at least 10 events to train; got {len(events)}")

    X = build_feature_matrix(events)

    scaler = MinMaxScaler()
    X_scaled = scaler.fit_transform(X)

    model = IsolationForest(
        n_estimators=n_estimators,
        contamination=contamination,
        random_state=random_state,
        n_jobs=-1,
    )
    model.fit(X_scaled)

    # Compute pseudo-metrics on training data
    predictions = model.predict(X_scaled)   # -1 = anomaly, 1 = normal
    n_anomalies = int(np.sum(predictions == -1))
    n_normal = int(np.sum(predictions == 1))
    scores = model.decision_function(X_scaled)

    metrics = {
        "n_anomalies_detected": n_anomalies,
        "n_normal": n_normal,
        "contamination_actual": round(n_anomalies / len(events), 4),
        "mean_score": round(float(np.mean(scores)), 4),
        "std_score": round(float(np.std(scores)), 4),
        "min_score": round(float(np.min(scores)), 4),
        "max_score": round(float(np.max(scores)), 4),
    }

    logger.info(
        "Trained IsolationForest on %d samples: %d anomalies detected (%.1f%%)",
        len(events), n_anomalies, 100 * n_anomalies / len(events),
    )
    return model, scaler, metrics
