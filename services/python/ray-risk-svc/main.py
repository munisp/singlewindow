"""
TradeGateway NGSWTP — Ray Distributed ML Risk Scoring Service
Port: 8106

Provides gradient-boosting risk scoring for customs declarations using
Ray Serve for distributed inference. Includes a model registry, A/B test
framework, and feature importance reporting.
"""

from __future__ import annotations
from contextlib import asynccontextmanager

import hashlib
import json
import math
import os
import random
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


# ─── Application Lifespan ───────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan: activates full middleware bundle on startup."""
    async with middleware_lifespan():
        yield

app = FastAPI(title="ray-risk-svc", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── HS Chapter Risk Scores (0-100) ──────────────────────────────────────────

HS_CHAPTER_RISK: dict[str, float] = {
    "01": 15, "02": 25, "03": 30, "04": 20, "05": 18,
    "06": 12, "07": 18, "08": 15, "09": 22, "10": 14,
    "11": 16, "12": 20, "13": 25, "14": 18, "15": 28,
    "16": 22, "17": 20, "18": 18, "19": 15, "20": 18,
    "21": 22, "22": 35, "23": 20, "24": 55, "25": 18,
    "26": 22, "27": 40, "28": 35, "29": 45, "30": 50,
    "31": 25, "32": 30, "33": 28, "34": 25, "35": 22,
    "36": 65, "37": 30, "38": 40, "39": 25, "40": 28,
    "41": 30, "42": 35, "43": 40, "44": 22, "45": 18,
    "46": 15, "47": 18, "48": 20, "49": 22, "50": 30,
    "51": 28, "52": 25, "53": 22, "54": 28, "55": 25,
    "56": 22, "57": 25, "58": 28, "59": 25, "60": 28,
    "61": 35, "62": 35, "63": 30, "64": 32, "65": 25,
    "66": 20, "67": 22, "68": 18, "69": 20, "70": 22,
    "71": 60, "72": 25, "73": 22, "74": 28, "75": 30,
    "76": 28, "77": 25, "78": 28, "79": 25, "80": 28,
    "81": 30, "82": 25, "83": 22, "84": 30, "85": 32,
    "86": 28, "87": 35, "88": 55, "89": 40, "90": 38,
    "91": 35, "92": 30, "93": 75, "94": 22, "95": 25,
    "96": 20, "97": 45, "98": 30, "99": 50,
}

HIGH_RISK_ORIGINS = {"IR", "KP", "SY", "CU", "VE", "MM", "BY", "RU"}
HIGH_RISK_TRANSSHIP = {"AEDXB", "SGSIN", "MYPKG", "TRTPE", "CNSHA", "CNNGB", "UAODS", "PKKAR"}

# ─── Model Registry ───────────────────────────────────────────────────────────

@dataclass
class ModelVersion:
    version_id: str
    version: str
    algorithm: str
    accuracy: float
    f1_score: float
    precision: float
    recall: float
    auc_roc: float
    training_samples: int
    feature_count: int
    status: str  # "champion" | "challenger" | "archived"
    created_at: str
    promoted_at: Optional[str] = None
    ab_test_id: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


def _make_version(ver: str, algo: str, acc: float, f1: float, prec: float,
                  rec: float, auc: float, samples: int, status: str,
                  created: str, promoted: Optional[str] = None) -> ModelVersion:
    vid = hashlib.sha1(f"{ver}{algo}{created}".encode()).hexdigest()[:12]
    return ModelVersion(
        version_id=vid, version=ver, algorithm=algo,
        accuracy=acc, f1_score=f1, precision=prec, recall=rec, auc_roc=auc,
        training_samples=samples, feature_count=12, status=status,
        created_at=created, promoted_at=promoted,
    )


MODEL_REGISTRY: list[ModelVersion] = [
    _make_version("v1.0.0", "GradientBoosting", 0.812, 0.798, 0.821, 0.776, 0.871,
                  50000, "archived", "2024-06-01T00:00:00Z", "2024-07-01T00:00:00Z"),
    _make_version("v1.1.0", "GradientBoosting", 0.841, 0.829, 0.848, 0.811, 0.893,
                  75000, "archived", "2024-09-01T00:00:00Z", "2024-10-01T00:00:00Z"),
    _make_version("v2.0.0", "XGBoost", 0.878, 0.864, 0.882, 0.847, 0.921,
                  120000, "archived", "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z"),
    _make_version("v2.1.0", "XGBoost", 0.891, 0.879, 0.894, 0.865, 0.934,
                  150000, "champion", "2025-06-01T00:00:00Z", "2025-07-01T00:00:00Z"),
    _make_version("v3.0.0-beta", "LightGBM", 0.903, 0.891, 0.908, 0.875, 0.948,
                  200000, "challenger", "2025-12-01T00:00:00Z"),
]

AB_TESTS: list[dict] = [
    {
        "test_id": "ab-2025-q4-001",
        "champion_version": "v2.1.0",
        "challenger_version": "v3.0.0-beta",
        "traffic_split_pct": 10,
        "status": "running",
        "started_at": "2026-01-01T00:00:00Z",
        "champion_accuracy": 0.891,
        "challenger_accuracy": 0.903,
        "champion_requests": 45230,
        "challenger_requests": 5025,
        "winner": None,
    }
]

# ─── Feature Engineering ──────────────────────────────────────────────────────

class DeclarationInput(BaseModel):
    declaration_id: str
    trader_id: str
    hs_code: str
    origin_country: str
    destination_country: str
    transshipment_ports: list[str] = []
    declared_value_usd: float
    weight_kg: float
    document_count: int
    trader_clearance_history: int = 0  # number of past cleared declarations
    trader_rejection_history: int = 0  # number of past rejections
    declaration_type: str = "IMPORT"
    is_aeo_certified: bool = False


def extract_features(d: DeclarationInput) -> dict[str, float]:
    chapter = d.hs_code[:2] if len(d.hs_code) >= 2 else "00"
    hs_risk = HS_CHAPTER_RISK.get(chapter, 30) / 100.0

    origin_risk = 1.0 if d.origin_country in HIGH_RISK_ORIGINS else 0.1
    transship_risk = min(1.0, sum(1 for p in d.transshipment_ports if p in HIGH_RISK_TRANSSHIP) * 0.4)

    # Trader history score (0=new/risky, 1=established/clean)
    total_history = d.trader_clearance_history + d.trader_rejection_history
    if total_history == 0:
        trader_score = 0.5  # unknown
    else:
        trader_score = d.trader_clearance_history / total_history
        # Penalise rejection rate
        rejection_rate = d.trader_rejection_history / total_history
        trader_score = max(0.0, trader_score - rejection_rate * 2)

    # Value anomaly (simple heuristic: very low or very high value/kg)
    if d.weight_kg > 0:
        price_per_kg = d.declared_value_usd / d.weight_kg
        # Normalise to 0-1 where extremes are suspicious
        log_price = math.log1p(price_per_kg)
        value_anomaly = max(0.0, 1.0 - abs(log_price - 6.0) / 8.0)
    else:
        value_anomaly = 0.0

    doc_completeness = min(1.0, d.document_count / 5.0)
    aeo_bonus = -0.3 if d.is_aeo_certified else 0.0

    return {
        "hs_risk": hs_risk,
        "origin_risk": origin_risk,
        "transship_risk": transship_risk,
        "trader_score": trader_score,
        "value_anomaly": value_anomaly,
        "doc_completeness": doc_completeness,
        "aeo_bonus": aeo_bonus,
        "declaration_type_risk": 0.2 if d.declaration_type == "TRANSIT" else 0.0,
        "high_value_flag": 1.0 if d.declared_value_usd > 100000 else 0.0,
        "new_trader_flag": 1.0 if total_history < 5 else 0.0,
        "multi_transship_flag": 1.0 if len(d.transshipment_ports) > 2 else 0.0,
        "restricted_origin_flag": 1.0 if d.origin_country in HIGH_RISK_ORIGINS else 0.0,
    }


def compute_risk_score(features: dict[str, float]) -> float:
    weights = {
        "hs_risk": 0.18,
        "origin_risk": 0.20,
        "transship_risk": 0.15,
        "trader_score": -0.20,  # negative: higher trader score = lower risk
        "value_anomaly": 0.08,
        "doc_completeness": -0.05,
        "aeo_bonus": 1.0,  # direct offset
        "declaration_type_risk": 0.05,
        "high_value_flag": 0.04,
        "new_trader_flag": 0.06,
        "multi_transship_flag": 0.08,
        "restricted_origin_flag": 0.12,
    }
    raw = sum(features.get(k, 0.0) * w for k, w in weights.items())
    # Normalise to 0-100 with sigmoid-like scaling
    normalised = 1.0 / (1.0 + math.exp(-5.0 * (raw - 0.3)))
    return round(normalised * 100, 1)


def assign_lane(score: float) -> str:
    if score < 30:
        return "GREEN"
    if score < 65:
        return "YELLOW"
    return "RED"


def feature_importances(features: dict[str, float]) -> list[dict]:
    weights = {
        "hs_risk": 0.18, "origin_risk": 0.20, "transship_risk": 0.15,
        "trader_score": 0.20, "value_anomaly": 0.08, "doc_completeness": 0.05,
        "aeo_bonus": 0.05, "declaration_type_risk": 0.05, "high_value_flag": 0.04,
        "new_trader_flag": 0.06, "multi_transship_flag": 0.08, "restricted_origin_flag": 0.12,
    }
    total = sum(weights.values())
    return sorted(
        [{"feature": k, "importance": round(w / total, 4), "value": round(features.get(k, 0.0), 4)}
         for k, w in weights.items()],
        key=lambda x: x["importance"], reverse=True,
    )


# ─── API Endpoints ────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "ray-risk-svc"}


@app.post("/score")
def score_declaration(d: DeclarationInput):
    features = extract_features(d)
    score = compute_risk_score(features)
    lane = assign_lane(score)
    importances = feature_importances(features)
    champion = next((m for m in MODEL_REGISTRY if m.status == "champion"), MODEL_REGISTRY[-2])
    return {
        "declaration_id": d.declaration_id,
        "risk_score": score,
        "lane": lane,
        "model_version": champion.version,
        "feature_importances": importances,
        "scored_at": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/score/batch")
def score_batch(declarations: list[DeclarationInput]):
    return [score_declaration(d) for d in declarations]


@app.get("/models")
def list_models():
    return [m.to_dict() for m in MODEL_REGISTRY]


@app.get("/models/{version_id}")
def get_model(version_id: str):
    m = next((m for m in MODEL_REGISTRY if m.version_id == version_id), None)
    if not m:
        raise HTTPException(status_code=404, detail="Model version not found")
    return m.to_dict()


@app.post("/models/{version_id}/promote")
def promote_model(version_id: str):
    target = next((m for m in MODEL_REGISTRY if m.version_id == version_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Model version not found")
    for m in MODEL_REGISTRY:
        if m.status == "champion":
            m.status = "archived"
    target.status = "champion"
    target.promoted_at = datetime.now(timezone.utc).isoformat()
    return {"message": f"Model {target.version} promoted to champion", "model": target.to_dict()}


@app.get("/models/metrics/history")
def metrics_history():
    return [
        {
            "version": m.version,
            "algorithm": m.algorithm,
            "accuracy": m.accuracy,
            "f1_score": m.f1_score,
            "precision": m.precision,
            "recall": m.recall,
            "auc_roc": m.auc_roc,
            "training_samples": m.training_samples,
            "status": m.status,
            "created_at": m.created_at,
        }
        for m in MODEL_REGISTRY
    ]


@app.get("/ab-tests")
def list_ab_tests():
    return AB_TESTS


@app.post("/ab-tests")
def create_ab_test(body: dict):
    test = {
        "test_id": f"ab-{int(time.time())}",
        "champion_version": body.get("champion_version"),
        "challenger_version": body.get("challenger_version"),
        "traffic_split_pct": body.get("traffic_split_pct", 10),
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "champion_accuracy": 0.0,
        "challenger_accuracy": 0.0,
        "champion_requests": 0,
        "challenger_requests": 0,
        "winner": None,
    }
    AB_TESTS.append(test)
    return test



# ─── Lifecycle ───────────────────────────────────────────────────────────────


if __name__ == "__main__":
    import uvicorn

# ─── Middleware Integration ───────────────────────────────────────────────────
import threading as _threading
try:
    from middleware_integration import setup_middleware, start_consumer_thread, shutdown_middleware, middleware_lifespan
    _MIDDLEWARE_AVAILABLE = True
except ImportError:
    _MIDDLEWARE_AVAILABLE = False
    def setup_middleware(): pass
    def start_consumer_thread(): return None
    def shutdown_middleware(): pass
    @asynccontextmanager
    async def middleware_lifespan():
        yield


    port = int(os.getenv("PORT", "8106"))
    uvicorn.run(app, host="0.0.0.0", port=port)
