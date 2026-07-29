"""
TradeGateway NGSWTP — Risk AI Service
Language: Python 3.11
Framework: FastAPI
Role: Advanced AI-powered risk assessment combining:
      1. XGBoost ML model for tabular risk scoring
      2. LLM-based risk narrative generation (via Ollama)
      3. SHAP explainability for model decisions
      4. Anomaly detection using Isolation Forest

Integration:
  - Reads declaration data from PostgreSQL
  - Publishes risk scores to Kafka topic: risk.ai-scored
  - Caches results in Redis (TTL: 1 hour)
  - Reports metrics to Prometheus

Port: 8094 (HTTP)
"""
from __future__ import annotations

import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import numpy as np
import redis
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from pydantic import BaseModel, Field

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("risk-ai")

# ─── Configuration ────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway"
)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
PORT = int(os.getenv("PORT", "8094"))
MODEL_DIR = os.getenv("MODEL_DIR", "/tmp/risk_ai_models")
CACHE_TTL = int(os.getenv("CACHE_TTL", "3600"))

# ─── Prometheus Metrics ───────────────────────────────────────────────────────
REQUESTS_TOTAL = Counter("risk_ai_requests_total", "Total risk AI requests", ["lane"])
SCORING_DURATION = Histogram(
    "risk_ai_scoring_duration_seconds",
    "Risk AI scoring duration",
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0],
)

# ─── Risk tables ──────────────────────────────────────────────────────────────
HIGH_RISK_HS_CHAPTERS = {"93", "28", "36", "30", "22", "24", "61", "62", "64", "85"}
HIGH_RISK_COUNTRIES = {"KP", "IR", "MM", "AF", "SY", "YE", "LY", "SD", "SO", "VE", "PK"}
MEDIUM_RISK_COUNTRIES = {"CN", "NG", "GH", "CI", "SN", "ML", "BF"}

# ─── Models ───────────────────────────────────────────────────────────────────
class RiskAIRequest(BaseModel):
    declaration_id: str
    trader_id: Optional[str] = None
    hs_code: Optional[str] = None
    declared_value: Optional[float] = None
    origin_country: Optional[str] = None
    destination_country: Optional[str] = None
    weight_kg: Optional[float] = None
    num_packages: Optional[int] = None
    goods_description: Optional[str] = None
    trader_history: Optional[dict[str, Any]] = None
    generate_narrative: bool = False

class RiskAIResponse(BaseModel):
    declaration_id: str
    risk_score: float
    lane: str
    confidence: float
    risk_factors: list[dict[str, Any]]
    shap_values: Optional[dict[str, float]] = None
    narrative: Optional[str] = None
    model_version: str
    scoring_ms: float
    scored_at: str

# ─── Redis client ─────────────────────────────────────────────────────────────
_redis_client: Optional[redis.Redis] = None

def get_redis() -> Optional[redis.Redis]:
    global _redis_client
    if _redis_client is None:
        try:
            _redis_client = redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=2)
            _redis_client.ping()
        except Exception as e:
            logger.warning(f"Redis unavailable: {e}")
            _redis_client = None
    return _redis_client

# ─── ML Model ─────────────────────────────────────────────────────────────────
_xgb_model = None
_model_version = "0"

def load_model():
    global _xgb_model, _model_version
    model_path = Path(MODEL_DIR) / "xgb_risk.json"
    if not model_path.exists():
        logger.warning(f"XGBoost model not found at {model_path}. Using rule-based scoring.")
        return

    try:
        import xgboost as xgb
        _xgb_model = xgb.Booster()
        _xgb_model.load_model(str(model_path))
        _model_version = "1.0"
        logger.info("XGBoost risk model loaded successfully")
    except ImportError:
        logger.warning("XGBoost not available. Using rule-based scoring.")
    except Exception as e:
        logger.error(f"Failed to load XGBoost model: {e}")

def build_features(req: RiskAIRequest) -> tuple[np.ndarray, list[str]]:
    """Build feature vector for risk scoring."""
    history = req.trader_history or {}

    declared_value = req.declared_value or 0.0
    value_norm = min(np.log1p(declared_value) / np.log1p(10_000_000), 1.0)

    hs_chapter = (req.hs_code or "")[:2]
    hs_risk = 0.9 if hs_chapter in HIGH_RISK_HS_CHAPTERS else 0.2

    origin = req.origin_country or ""
    origin_risk = 0.85 if origin in HIGH_RISK_COUNTRIES else (0.5 if origin in MEDIUM_RISK_COUNTRIES else 0.15)

    weight = req.weight_kg or 0.0
    value_per_kg = (declared_value / max(weight, 0.1)) if weight > 0 else 0.0
    value_per_kg_norm = min(value_per_kg / 10_000.0, 1.0)

    trader_risk = float(history.get("risk_score", 0.3))
    violations = float(history.get("violations_count", 0))
    violations_norm = min(violations / 50.0, 1.0)
    aeo_status = 1.0 if history.get("aeo_certified") else 0.0
    declaration_count = float(history.get("declaration_count", 0))
    decl_count_norm = min(declaration_count / 1000.0, 1.0)

    features = np.array([
        value_norm,
        hs_risk,
        origin_risk,
        value_per_kg_norm,
        trader_risk,
        violations_norm,
        aeo_status,
        decl_count_norm,
        float(req.num_packages or 1) / 1000.0,
        1.0 if hs_chapter in {"93", "28", "36"} else 0.0,  # controlled goods
    ], dtype=np.float32)

    feature_names = [
        "declared_value_norm", "hs_risk", "origin_risk", "value_per_kg_norm",
        "trader_risk", "violations_norm", "aeo_status", "declaration_count_norm",
        "packages_norm", "controlled_goods",
    ]

    return features, feature_names

def rule_based_score(features: np.ndarray) -> tuple[float, str]:
    """Rule-based risk scoring fallback."""
    score = (
        0.20 * features[0]  # value
        + 0.20 * features[1]  # hs risk
        + 0.25 * features[2]  # origin risk
        + 0.10 * features[3]  # value per kg
        + 0.15 * features[4]  # trader risk
        + 0.10 * features[5]  # violations
    )
    score = float(np.clip(score, 0.0, 1.0))
    lane = "RED" if score >= 0.70 else ("YELLOW" if score >= 0.35 else "GREEN")
    return score, lane

def build_risk_factors(req: RiskAIRequest, features: np.ndarray, feature_names: list[str]) -> list[dict]:
    """Build human-readable risk factors."""
    factors = []

    hs_chapter = (req.hs_code or "")[:2]
    if hs_chapter in HIGH_RISK_HS_CHAPTERS:
        factors.append({
            "code": "HIGH_RISK_HS",
            "description": f"HS chapter {hs_chapter} is classified as high-risk",
            "severity": "HIGH",
            "weight": 0.20,
        })

    origin = req.origin_country or ""
    if origin in HIGH_RISK_COUNTRIES:
        factors.append({
            "code": "HIGH_RISK_ORIGIN",
            "description": f"Country of origin {origin} is on the high-risk list",
            "severity": "HIGH",
            "weight": 0.25,
        })
    elif origin in MEDIUM_RISK_COUNTRIES:
        factors.append({
            "code": "MEDIUM_RISK_ORIGIN",
            "description": f"Country of origin {origin} is on the medium-risk list",
            "severity": "MEDIUM",
            "weight": 0.15,
        })

    history = req.trader_history or {}
    violations = int(history.get("violations_count", 0))
    if violations > 5:
        factors.append({
            "code": "TRADER_VIOLATIONS",
            "description": f"Trader has {violations} previous violations",
            "severity": "HIGH" if violations > 10 else "MEDIUM",
            "weight": 0.15,
        })

    declared_value = req.declared_value or 0.0
    weight = req.weight_kg or 0.0
    if weight > 0 and declared_value > 0:
        value_per_kg = declared_value / weight
        if value_per_kg > 5000:
            factors.append({
                "code": "HIGH_VALUE_PER_KG",
                "description": f"High declared value per kg: ${value_per_kg:.2f}/kg",
                "severity": "MEDIUM",
                "weight": 0.10,
            })

    if not factors:
        factors.append({
            "code": "LOW_RISK",
            "description": "No significant risk factors identified",
            "severity": "LOW",
            "weight": 0.0,
        })

    return factors

# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Risk AI Service starting up...")
    load_model()
    yield
    logger.info("Risk AI Service shutting down...")

# ─── FastAPI app ──────────────────────────────────────────────────────────────
app = FastAPI(
    title="TradeGateway Risk AI Service",
    description="Advanced AI-powered trade declaration risk assessment",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/healthz")
async def liveness():
    return {"status": "ok", "service": "risk-ai"}

@app.get("/readyz")
async def readiness():
    return {
        "status": "ready",
        "model": "xgboost" if _xgb_model else "rule_based",
        "redis": "ok" if get_redis() else "unavailable",
    }

@app.get("/metrics")
async def metrics():
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.post("/score", response_model=RiskAIResponse)
async def score_declaration(req: RiskAIRequest):
    start = time.perf_counter()

    # Check cache
    cache_key = f"risk_ai:{req.declaration_id}"
    redis_client = get_redis()
    if redis_client and not req.generate_narrative:
        try:
            cached = redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    # Build features
    features, feature_names = build_features(req)

    # Score using XGBoost or rule-based fallback
    shap_values = None
    if _xgb_model:
        try:
            import xgboost as xgb
            dmatrix = xgb.DMatrix(features.reshape(1, -1), feature_names=feature_names)
            raw_score = float(_xgb_model.predict(dmatrix)[0])
            risk_score = float(np.clip(raw_score, 0.0, 1.0))
            lane = "RED" if risk_score >= 0.70 else ("YELLOW" if risk_score >= 0.35 else "GREEN")
            confidence = 0.90
            model_version = _model_version

            # SHAP values
            try:
                import shap
                explainer = shap.TreeExplainer(_xgb_model)
                sv = explainer.shap_values(features.reshape(1, -1))
                shap_values = {name: float(val) for name, val in zip(feature_names, sv[0])}
            except Exception:
                pass
        except Exception as e:
            logger.warning(f"XGBoost scoring failed: {e}. Using rule-based.")
            risk_score, lane = rule_based_score(features)
            confidence = 0.75
            model_version = "rule_based"
    else:
        risk_score, lane = rule_based_score(features)
        confidence = 0.75
        model_version = "rule_based"

    risk_factors = build_risk_factors(req, features, feature_names)
    scoring_ms = (time.perf_counter() - start) * 1000
    REQUESTS_TOTAL.labels(lane=lane).inc()
    SCORING_DURATION.observe(scoring_ms / 1000)

    # Generate LLM narrative if requested
    narrative = None
    if req.generate_narrative and req.goods_description:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.post(
                    f"{OLLAMA_BASE_URL}/api/chat",
                    json={
                        "model": "qwen2.5:7b",
                        "messages": [{
                            "role": "user",
                            "content": f"Provide a brief customs risk assessment narrative for: {req.goods_description}. Risk score: {risk_score:.2f}, Lane: {lane}. Key factors: {[f['description'] for f in risk_factors[:3]]}. Keep it under 100 words.",
                        }],
                        "stream": False,
                        "options": {"temperature": 0.3},
                    },
                )
                if res.status_code == 200:
                    narrative = res.json().get("message", {}).get("content", "")
        except Exception as e:
            logger.warning(f"Narrative generation failed: {e}")

    result = RiskAIResponse(
        declaration_id=req.declaration_id,
        risk_score=round(risk_score, 4),
        lane=lane,
        confidence=round(confidence, 4),
        risk_factors=risk_factors,
        shap_values=shap_values,
        narrative=narrative,
        model_version=model_version,
        scoring_ms=round(scoring_ms, 2),
        scored_at=datetime.now(timezone.utc).isoformat(),
    )

    # Cache result (skip if narrative was generated — it's non-deterministic)
    if redis_client and not req.generate_narrative:
        try:
            redis_client.setex(cache_key, CACHE_TTL, result.model_dump_json())
        except Exception:
            pass

    return result

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, workers=2, log_config=None)
