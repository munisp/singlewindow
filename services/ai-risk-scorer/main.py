"""
ai-risk-scorer — TradeGateway NGSWTP

FastAPI microservice providing ML-based customs risk scoring.
Integrates XGBoost + scikit-learn ensemble with SHAP explainability.

Why Python:
  - scikit-learn, XGBoost, and SHAP are Python-native
  - Rich ecosystem for feature engineering and model training
  - Pandas for efficient tabular data processing
  - FastAPI for high-performance async REST/gRPC-gateway

Risk scoring pipeline:
  1. Feature extraction from declaration payload
  2. Ensemble scoring: XGBoost (primary) + IsolationForest (anomaly)
  3. SHAP explainability for officer decision support
  4. Lane assignment: GREEN / YELLOW / RED
  5. Kafka event publish: RISK_SCORED

Environment variables:
  PORT                    (default: 8001)
  DATABASE_URL            PostgreSQL async connection string
  KAFKA_BROKERS           (default: localhost:9092)
  REDIS_URL               (default: redis://localhost:6379)
  MODEL_PATH              Path to serialized XGBoost model (default: models/risk_model.pkl)
  METRICS_PORT            (default: 9096)
"""

import asyncio
import hashlib
import json
import logging
import os
import pickle
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np
import pandas as pd
import structlog
import uvicorn
from confluent_kafka import Producer
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from prometheus_client import Counter, Gauge, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response
from tenacity import retry, stop_after_attempt, wait_exponential

# ─── Logging ──────────────────────────────────────────────────────────────────

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)
logger = structlog.get_logger("ai-risk-scorer")

# ─── Metrics ──────────────────────────────────────────────────────────────────

RISK_SCORES_TOTAL = Counter("risk_scores_total", "Total risk scores computed", ["lane"])
RISK_SCORE_DURATION = Histogram(
    "risk_score_duration_seconds",
    "Risk scoring duration",
    buckets=[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5],
)
MODEL_VERSION = Gauge("risk_model_version", "Current model version")
HIGH_RISK_DECLARATIONS = Counter("high_risk_declarations_total", "Declarations assigned RED lane")

# ─── Feature engineering ──────────────────────────────────────────────────────

# HS codes known to be high-risk (dual-use goods, controlled substances, etc.)
HIGH_RISK_HS_PREFIXES = {
    "93",  # Arms and ammunition
    "28",  # Inorganic chemicals
    "29",  # Organic chemicals
    "38",  # Miscellaneous chemical products
    "84",  # Nuclear reactors, machinery
    "85",  # Electrical machinery
    "90",  # Optical, photographic, precision instruments
}

# Countries with elevated risk profiles (FATF grey/black list proxies)
HIGH_RISK_COUNTRIES = {
    "AF", "BY", "CF", "CD", "CU", "ER", "ET", "GN", "GW", "HT",
    "IR", "IQ", "KP", "LB", "LY", "ML", "MM", "NI", "PK", "RU",
    "SO", "SS", "SD", "SY", "TN", "UA", "VE", "YE", "ZW",
}

MEDIUM_RISK_COUNTRIES = {
    "AL", "BB", "BF", "CM", "HK", "JM", "JO", "KH", "MG", "MU",
    "MZ", "NG", "PA", "PH", "SN", "TZ", "TT", "UG", "VN",
}


def extract_features(declaration: dict) -> pd.DataFrame:
    """
    Extract numerical features from a declaration for ML scoring.
    Returns a single-row DataFrame with all feature columns.
    """
    items = declaration.get("items", [])
    total_value = float(declaration.get("totalValue", 0))
    total_weight = float(declaration.get("totalWeight", 0))
    num_items = len(items)
    num_packages = int(declaration.get("numberOfPackages", 0))

    # HS code risk features
    hs_codes = [str(item.get("hsCode", ""))[:2] for item in items]
    high_risk_hs_count = sum(1 for hs in hs_codes if hs in HIGH_RISK_HS_PREFIXES)
    hs_diversity = len(set(hs_codes))

    # Country risk
    country_of_origin = declaration.get("countryOfOrigin", "")
    country_risk_score = (
        3.0 if country_of_origin in HIGH_RISK_COUNTRIES
        else 2.0 if country_of_origin in MEDIUM_RISK_COUNTRIES
        else 1.0
    )

    # Trader history features
    trader_history = declaration.get("traderHistory", {})
    trader_total_declarations = int(trader_history.get("totalDeclarations", 0))
    trader_rejection_rate = float(trader_history.get("rejectionRate", 0.0))
    trader_amendment_rate = float(trader_history.get("amendmentRate", 0.0))
    trader_is_aeo = int(trader_history.get("isAEO", False))
    trader_months_active = int(trader_history.get("monthsActive", 0))

    # Value anomaly features
    declared_value_per_kg = total_value / max(total_weight, 0.001)
    value_per_item = total_value / max(num_items, 1)

    # Duty calculation features
    total_duty = float(declaration.get("totalDuty", 0))
    effective_duty_rate = total_duty / max(total_value, 0.001)
    duty_value_ratio = total_duty / max(total_value, 0.001)

    # Document completeness
    documents = declaration.get("documents", [])
    has_invoice = int(any(d.get("type") == "COMMERCIAL_INVOICE" for d in documents))
    has_bill_of_lading = int(any(d.get("type") in ["BILL_OF_LADING", "AIRWAY_BILL"] for d in documents))
    has_packing_list = int(any(d.get("type") == "PACKING_LIST" for d in documents))
    doc_completeness = (has_invoice + has_bill_of_lading + has_packing_list) / 3.0

    # Declaration type risk
    decl_type = declaration.get("declarationType", "IMPORT")
    type_risk = {"IMPORT": 1.0, "EXPORT": 0.8, "TRANSIT": 1.5, "TEMPORARY_IMPORT": 1.3}.get(decl_type, 1.0)

    # Time-based features
    submission_hour = datetime.now(timezone.utc).hour
    is_off_hours = int(submission_hour < 6 or submission_hour > 22)

    features = {
        "total_value": total_value,
        "total_weight": total_weight,
        "num_items": num_items,
        "num_packages": num_packages,
        "high_risk_hs_count": high_risk_hs_count,
        "hs_diversity": hs_diversity,
        "country_risk_score": country_risk_score,
        "trader_total_declarations": trader_total_declarations,
        "trader_rejection_rate": trader_rejection_rate,
        "trader_amendment_rate": trader_amendment_rate,
        "trader_is_aeo": trader_is_aeo,
        "trader_months_active": trader_months_active,
        "declared_value_per_kg": declared_value_per_kg,
        "value_per_item": value_per_item,
        "effective_duty_rate": effective_duty_rate,
        "duty_value_ratio": duty_value_ratio,
        "doc_completeness": doc_completeness,
        "type_risk": type_risk,
        "is_off_hours": is_off_hours,
    }

    return pd.DataFrame([features])


# ─── Rule-based scorer (fallback + override) ─────────────────────────────────

def rule_based_score(declaration: dict, features: pd.DataFrame) -> tuple[float, list[str]]:
    """
    Hard business rules that override or augment ML score.
    Returns (score_override_or_None, list_of_triggered_rules).
    """
    triggered = []
    score = 0.0

    row = features.iloc[0]

    # Rule R1: High-risk HS codes
    if row["high_risk_hs_count"] > 0:
        score += 0.3 * row["high_risk_hs_count"]
        triggered.append(f"R1: {int(row['high_risk_hs_count'])} high-risk HS code(s)")

    # Rule R2: High-risk country of origin
    if row["country_risk_score"] >= 3.0:
        score += 0.4
        triggered.append(f"R2: High-risk country of origin ({declaration.get('countryOfOrigin', '')})")
    elif row["country_risk_score"] >= 2.0:
        score += 0.15
        triggered.append(f"R2: Medium-risk country of origin ({declaration.get('countryOfOrigin', '')})")

    # Rule R3: New trader with high value
    if row["trader_months_active"] < 3 and row["total_value"] > 50000:
        score += 0.25
        triggered.append("R3: New trader with high-value shipment")

    # Rule R4: High rejection/amendment history
    if row["trader_rejection_rate"] > 0.2:
        score += 0.2
        triggered.append(f"R4: High rejection rate ({row['trader_rejection_rate']:.1%})")

    # Rule R5: Incomplete documentation
    if row["doc_completeness"] < 0.67:
        score += 0.15
        triggered.append("R5: Incomplete documentation")

    # Rule R6: Value anomaly — unusually low declared value per kg
    if row["declared_value_per_kg"] < 0.5 and row["total_value"] > 10000:
        score += 0.2
        triggered.append(f"R6: Suspicious value/weight ratio ({row['declared_value_per_kg']:.2f} USD/kg)")

    # Rule R7: AEO exemption — reduce score
    if row["trader_is_aeo"] == 1:
        score = max(0.0, score - 0.3)
        triggered.append("R7: AEO status — risk reduced")

    # Rule R8: Transit with high-risk origin
    if declaration.get("declarationType") == "TRANSIT" and row["country_risk_score"] >= 2.0:
        score += 0.2
        triggered.append("R8: Transit from elevated-risk country")

    return min(score, 1.0), triggered


# ─── ML model ─────────────────────────────────────────────────────────────────

class RiskModel:
    """
    Ensemble risk model: XGBoost primary + IsolationForest anomaly detection.
    Falls back to rule-based scoring if model is not loaded.
    """

    def __init__(self, model_path: str):
        self.model_path = model_path
        self.xgb_model = None
        self.isolation_forest = None
        self.feature_columns = None
        self.version = 0
        self._load()

    def _load(self):
        if os.path.exists(self.model_path):
            try:
                with open(self.model_path, "rb") as f:
                    bundle = pickle.load(f)
                self.xgb_model = bundle.get("xgb")
                self.isolation_forest = bundle.get("isolation_forest")
                self.feature_columns = bundle.get("feature_columns")
                self.version = bundle.get("version", 1)
                MODEL_VERSION.set(self.version)
                logger.info("ML model loaded", version=self.version, path=self.model_path)
            except Exception as e:
                logger.warning("Failed to load ML model — using rule-based fallback", error=str(e))
        else:
            logger.info("No ML model found — using rule-based scoring only", path=self.model_path)

    def score(self, features: pd.DataFrame) -> tuple[float, float]:
        """
        Returns (ml_score, anomaly_score) both in [0, 1].
        Falls back to 0.0 if model not loaded.
        """
        if self.xgb_model is None:
            return 0.0, 0.0

        try:
            # Align feature columns
            if self.feature_columns:
                for col in self.feature_columns:
                    if col not in features.columns:
                        features[col] = 0.0
                features = features[self.feature_columns]

            ml_score = float(self.xgb_model.predict_proba(features)[0][1])

            anomaly_score = 0.0
            if self.isolation_forest is not None:
                # IsolationForest returns -1 (anomaly) or 1 (normal)
                raw = self.isolation_forest.decision_function(features)[0]
                # Normalize to [0, 1] where 1 = most anomalous
                anomaly_score = max(0.0, min(1.0, -raw + 0.5))

            return ml_score, anomaly_score

        except Exception as e:
            logger.warning("ML scoring failed — using rule-based fallback", error=str(e))
            return 0.0, 0.0


# ─── Pydantic models ──────────────────────────────────────────────────────────

class DeclarationItem(BaseModel):
    hs_code: str = Field(..., alias="hsCode")
    description: str = ""
    quantity: float = 0.0
    unit_value: float = Field(0.0, alias="unitValue")
    country_of_origin: str = Field("", alias="countryOfOrigin")

    model_config = {"populate_by_name": True}


class TraderHistory(BaseModel):
    total_declarations: int = Field(0, alias="totalDeclarations")
    rejection_rate: float = Field(0.0, alias="rejectionRate")
    amendment_rate: float = Field(0.0, alias="amendmentRate")
    is_aeo: bool = Field(False, alias="isAEO")
    months_active: int = Field(0, alias="monthsActive")

    model_config = {"populate_by_name": True}


class Document(BaseModel):
    type: str
    reference: str = ""


class RiskScoreRequest(BaseModel):
    declaration_id: str = Field(..., alias="declarationId")
    trader_id: str = Field(..., alias="traderId")
    declaration_type: str = Field("IMPORT", alias="declarationType")
    country_of_origin: str = Field("", alias="countryOfOrigin")
    country_of_destination: str = Field("", alias="countryOfDestination")
    total_value: float = Field(0.0, alias="totalValue")
    total_weight: float = Field(0.0, alias="totalWeight")
    total_duty: float = Field(0.0, alias="totalDuty")
    number_of_packages: int = Field(0, alias="numberOfPackages")
    items: list[DeclarationItem] = []
    documents: list[Document] = []
    trader_history: TraderHistory = Field(default_factory=TraderHistory, alias="traderHistory")

    model_config = {"populate_by_name": True}


class RiskFactor(BaseModel):
    code: str
    description: str
    weight: float
    value: float


class RiskScoreResponse(BaseModel):
    declaration_id: str
    risk_score: float = Field(..., description="Composite risk score 0.0–1.0")
    ml_score: float
    rule_score: float
    anomaly_score: float
    lane: str = Field(..., description="GREEN | YELLOW | RED")
    risk_factors: list[RiskFactor]
    triggered_rules: list[str]
    shap_explanation: Optional[dict] = None
    model_version: int
    scored_at: str
    processing_ms: float


# ─── App lifecycle ────────────────────────────────────────────────────────────

risk_model: Optional[RiskModel] = None
kafka_producer: Optional[Producer] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global risk_model, kafka_producer

    model_path = os.getenv("MODEL_PATH", "models/risk_model.pkl")
    risk_model = RiskModel(model_path)

    brokers = os.getenv("KAFKA_BROKERS", "localhost:9092")
    try:
        kafka_producer = Producer({"bootstrap.servers": brokers, "acks": "all"})
        logger.info("Kafka producer connected", brokers=brokers)
    except Exception as e:
        logger.warning("Kafka producer failed — events will not be published", error=str(e))

    yield

    if kafka_producer:
        kafka_producer.flush(timeout=5)
    logger.info("ai-risk-scorer shutdown complete")


app = FastAPI(
    title="TradeGateway AI Risk Scorer",
    description="ML-based customs risk scoring service",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ai-risk-scorer",
        "model_loaded": risk_model is not None and risk_model.xgb_model is not None,
        "model_version": risk_model.version if risk_model else 0,
    }


@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/score", response_model=RiskScoreResponse)
async def score_declaration(request: RiskScoreRequest):
    start = time.perf_counter()

    declaration_dict = request.model_dump(by_alias=True)

    # Feature extraction
    features = extract_features(declaration_dict)

    # Rule-based scoring
    rule_score, triggered_rules = rule_based_score(declaration_dict, features)

    # ML scoring
    ml_score, anomaly_score = risk_model.score(features) if risk_model else (0.0, 0.0)

    # Composite score: 40% rules + 40% ML + 20% anomaly
    if ml_score > 0:
        composite = 0.40 * rule_score + 0.40 * ml_score + 0.20 * anomaly_score
    else:
        # No ML model — use rules only
        composite = rule_score

    composite = min(1.0, max(0.0, composite))

    # Lane assignment
    if composite >= 0.70:
        lane = "RED"
        HIGH_RISK_DECLARATIONS.inc()
    elif composite >= 0.35:
        lane = "YELLOW"
    else:
        lane = "GREEN"

    RISK_SCORES_TOTAL.labels(lane=lane).inc()

    # SHAP explanation (only for ML-scored declarations)
    shap_explanation = None
    if risk_model and risk_model.xgb_model and ml_score > 0:
        try:
            import shap
            explainer = shap.TreeExplainer(risk_model.xgb_model)
            shap_values = explainer.shap_values(features)
            shap_explanation = {
                col: float(val)
                for col, val in zip(features.columns, shap_values[0])
            }
        except Exception:
            pass

    # Build risk factors
    risk_factors = [
        RiskFactor(
            code="COMPOSITE",
            description="Composite risk score",
            weight=1.0,
            value=composite,
        ),
        RiskFactor(
            code="RULE_SCORE",
            description="Business rule score",
            weight=0.40,
            value=rule_score,
        ),
        RiskFactor(
            code="ML_SCORE",
            description="Machine learning score",
            weight=0.40,
            value=ml_score,
        ),
        RiskFactor(
            code="ANOMALY_SCORE",
            description="Anomaly detection score",
            weight=0.20,
            value=anomaly_score,
        ),
    ]

    processing_ms = (time.perf_counter() - start) * 1000
    RISK_SCORE_DURATION.observe(processing_ms / 1000)

    scored_at = datetime.now(timezone.utc).isoformat()

    # Publish to Kafka
    if kafka_producer:
        event = {
            "event_type": "RISK_SCORED",
            "entity_id": request.declaration_id,
            "entity_type": "declaration",
            "actor_id": "ai-risk-scorer",
            "actor_type": "system",
            "payload": {
                "risk_score": composite,
                "lane": lane,
                "ml_score": ml_score,
                "rule_score": rule_score,
                "triggered_rules": triggered_rules,
            },
            "timestamp": scored_at,
        }
        try:
            kafka_producer.produce(
                "risk-events",
                key=request.declaration_id,
                value=json.dumps(event).encode(),
                headers={"event_type": b"RISK_SCORED"},
            )
            kafka_producer.poll(0)
        except Exception as e:
            logger.warning("Failed to publish risk event", error=str(e))

    logger.info(
        "Risk scored",
        declaration_id=request.declaration_id,
        lane=lane,
        composite=round(composite, 3),
        processing_ms=round(processing_ms, 2),
    )

    return RiskScoreResponse(
        declaration_id=request.declaration_id,
        risk_score=composite,
        ml_score=ml_score,
        rule_score=rule_score,
        anomaly_score=anomaly_score,
        lane=lane,
        risk_factors=risk_factors,
        triggered_rules=triggered_rules,
        shap_explanation=shap_explanation,
        model_version=risk_model.version if risk_model else 0,
        scored_at=scored_at,
        processing_ms=round(processing_ms, 2),
    )


@app.post("/batch-score")
async def batch_score(requests: list[RiskScoreRequest]):
    """Score multiple declarations in a single request."""
    results = []
    for req in requests[:100]:  # Cap at 100 per batch
        result = await score_declaration(req)
        results.append(result)
    return results


@app.get("/model/info")
async def model_info():
    return {
        "model_loaded": risk_model is not None and risk_model.xgb_model is not None,
        "model_version": risk_model.version if risk_model else 0,
        "model_path": risk_model.model_path if risk_model else None,
        "feature_columns": risk_model.feature_columns if risk_model else None,
        "rule_count": 8,
        "high_risk_hs_prefixes": sorted(HIGH_RISK_HS_PREFIXES),
        "high_risk_countries_count": len(HIGH_RISK_COUNTRIES),
    }


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        workers=int(os.getenv("WORKERS", "2")),
        log_config=None,  # Use structlog
    )
