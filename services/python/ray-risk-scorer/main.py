"""
ray-risk-scorer — Declaration Risk Scoring Service (honest two-layer design)

Layer 1 (first line of defence, always runs): a deterministic, transparent
rule engine over AEO-aware features (HS-code risk, origin risk, route risk,
value anomalies, trader compliance, express flag, description keywords).

Layer 2 (optional, real ML only): when RISK_MODEL_PATH points at a readable
ONNX model, the model is served via onnxruntime on CPU and its score is
blended with the rule score. The ONNX model contract is:
  input:  single float32 tensor [1, 7] with the rule feature vector in
          FEATURE_ORDER (hs_risk, origin_risk, route_risk, value_risk,
          compliance_risk, express_risk, desc_risk)
  output: first output tensor, scalar probability-like value in [0, 1]
          (1 = highest risk); scaled to the 0-100 score range.

Fail-closed doctrine:
  * No model configured/unloadable -> every score reports
    ml_augmentation="UNAVAILABLE" and /model-stats returns
    {"status": "NO_MODEL_DEPLOYED"} with an honest message.
  * A rule-layer RED score (>= 65) is never softened by the ML layer.
  * This service NEVER fabricates scores or metrics. A previous version
    added MD5-hash "noise" to scores and returned invented /model-stats
    (auc_roc=0.9312 etc. for a model that did not exist); both were removed.

Environment:
  PORT                     — listen port (default 8101)
  RISK_MODEL_PATH          — path to an ONNX model file; unset => rules-only
  RISK_MODEL_VERSION       — version label reported for the loaded model
  RISK_MODEL_METRICS_PATH  — optional JSON file of evaluation metrics
                             produced by the offline training pipeline;
                             surfaced verbatim by /model-stats. Never
                             invented here.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import json
import os
import time
from datetime import datetime


# ─── Application Lifespan ───────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan: activates full middleware bundle on startup."""
    async with middleware_lifespan():
        yield

app = FastAPI(
    title="TradeGateway Ray Risk Scorer",
    description="ML-based declaration risk scoring with AEO-aware features",
    version="1.0.0",
    lifespan=lifespan,
)

# ─── Feature Engineering ──────────────────────────────────────────────────────

# High-risk HS code prefixes (narcotics, weapons, dual-use)
HIGH_RISK_HS = {"2939", "9301", "9302", "9303", "8803", "8802", "2933", "2934"}
MEDIUM_RISK_HS = {"8471", "8517", "8542", "0302", "0303", "1211", "2106"}

# High-risk origin countries (based on WCO risk intelligence)
HIGH_RISK_ORIGINS = {"AF", "MM", "CO", "VE", "NG", "LY", "SO", "YE"}
MEDIUM_RISK_ORIGINS = {"PK", "BD", "KH", "LA", "MX", "GT", "HN"}

# High-risk transit routes (country pairs)
HIGH_RISK_ROUTES = {("CO", "NG"), ("AF", "TR"), ("MM", "TH"), ("CO", "VE")}

# AEO discount factors
AEO_DISCOUNT = {
    "FULL": 0.40,      # AEO Full certification → 40% risk reduction
    "SECURITY": 0.25,  # AEO Security → 25% reduction
    "CUSTOMS": 0.20,   # AEO Customs → 20% reduction
    None: 0.0,         # No AEO
}


class DeclarationFeatures(BaseModel):
    ucr: str = Field(..., description="Unique Consignment Reference")
    hs_code: str = Field(..., description="HS code (first 4-6 digits)")
    declared_value: float = Field(..., description="CIF value in USD")
    origin_country: str = Field(..., description="ISO-2 country code")
    dest_country: str = Field(..., description="ISO-2 destination country")
    transit_countries: list[str] = Field(default=[], description="Transit country codes")
    trader_id: str = Field(..., description="Trader entity ID")
    aeo_status: Optional[str] = Field(None, description="AEO certification type: FULL, SECURITY, CUSTOMS, or null")
    trader_declaration_count: int = Field(default=0, description="Historical declaration count")
    trader_violation_count: int = Field(default=0, description="Historical violation count")
    weight_kg: Optional[float] = Field(None, description="Gross weight in kg")
    container_count: Optional[int] = Field(None, description="Number of containers")
    is_express: bool = Field(default=False, description="Express/courier shipment")
    declared_description: Optional[str] = Field(None, description="Goods description")


class RiskScore(BaseModel):
    ucr: str
    score: float = Field(..., ge=0, le=100)
    risk_tier: str  # GREEN, YELLOW, RED
    lane: str       # AUTO_APPROVE, DOC_CHECK, PHYSICAL_INSPECTION
    aeo_adjusted: bool
    feature_contributions: dict[str, float]
    shap_explanation: list[dict]
    recommendation: str
    ml_augmentation: str = Field(
        ..., description="APPLIED if a real ONNX model augmented the rule score; "
                         "UNAVAILABLE when scoring is rules-only"
    )
    ml_model_version: Optional[str] = None
    scored_at: str


class BatchRequest(BaseModel):
    declarations: list[DeclarationFeatures]


class BatchResponse(BaseModel):
    results: list[RiskScore]
    batch_size: int
    processing_time_ms: float
    model_version: str


# ─── Real ONNX model layer (optional, fail-closed) ────────────────────────────

FEATURE_ORDER = [
    "hs_risk", "origin_risk", "route_risk", "value_risk",
    "compliance_risk", "express_risk", "desc_risk",
]

RISK_MODEL_PATH = os.getenv("RISK_MODEL_PATH", "").strip() or None
RISK_MODEL_VERSION = os.getenv("RISK_MODEL_VERSION", "").strip() or None
RISK_MODEL_METRICS_PATH = os.getenv("RISK_MODEL_METRICS_PATH", "").strip() or None

# Blend weights when a real model is loaded. Rules remain the dominant layer.
RULES_BLEND_WEIGHT = 0.6
ML_BLEND_WEIGHT = 0.4
# A rule-layer score at/above this threshold (RED lane) is never softened by ML.
RULES_RED_THRESHOLD = 65.0


class OnnxModelLayer:
    """
    Thin onnxruntime (CPU) wrapper around a real exported model.
    Loaded lazily at startup; if anything fails the layer stays disabled
    and the service reports UNAVAILABLE rather than faking a signal.
    """

    def __init__(self, model_path: Optional[str]):
        self.session = None
        self.input_name: Optional[str] = None
        self.loaded_at: Optional[str] = None
        self.error: Optional[str] = None
        if not model_path:
            self.error = "RISK_MODEL_PATH not set"
            return
        try:
            import onnxruntime as ort  # lazy: optional dependency
            self.session = ort.InferenceSession(
                model_path, providers=["CPUExecutionProvider"]
            )
            self.input_name = self.session.get_inputs()[0].name
            self.loaded_at = datetime.utcnow().isoformat() + "Z"
        except Exception as exc:  # missing file, invalid model, missing ort
            self.error = f"{type(exc).__name__}: {exc}"
            self.session = None

    @property
    def available(self) -> bool:
        return self.session is not None

    def score(self, features: dict[str, float]) -> Optional[float]:
        """Run real inference. Returns a 0-100 score, or None on any failure."""
        if not self.available:
            return None
        try:
            import numpy as np
            vector = np.array(
                [[float(features.get(k, 0.0)) for k in FEATURE_ORDER]],
                dtype=np.float32,
            )
            outputs = self.session.run(None, {self.input_name: vector})
            raw = float(np.ravel(outputs[0])[0])
            # Contract: probability-like output in [0, 1] -> 0-100 scale.
            raw = min(1.0, max(0.0, raw))
            return raw * 100.0
        except Exception:
            return None


def _load_model_layer() -> OnnxModelLayer:
    return OnnxModelLayer(RISK_MODEL_PATH)


MODEL_LAYER = _load_model_layer()


def blend_scores(rules_score: float, ml_score: float) -> float:
    """
    Blend deterministic rule score (0-100) with a real ML score (0-100).
    Fail-closed: a rule-layer RED score is returned unchanged.
    """
    if rules_score >= RULES_RED_THRESHOLD:
        return rules_score
    blended = RULES_BLEND_WEIGHT * rules_score + ML_BLEND_WEIGHT * ml_score
    return min(100.0, max(0.0, blended))


# ─── Scoring Engine ───────────────────────────────────────────────────────────

def extract_features(decl: DeclarationFeatures) -> dict[str, float]:
    """Extract numerical features from a declaration for scoring."""
    hs_prefix4 = decl.hs_code[:4] if len(decl.hs_code) >= 4 else decl.hs_code

    # HS code risk
    hs_risk = 0.0
    if hs_prefix4 in HIGH_RISK_HS:
        hs_risk = 1.0
    elif hs_prefix4 in MEDIUM_RISK_HS:
        hs_risk = 0.5

    # Origin country risk
    origin_risk = 0.0
    if decl.origin_country in HIGH_RISK_ORIGINS:
        origin_risk = 1.0
    elif decl.origin_country in MEDIUM_RISK_ORIGINS:
        origin_risk = 0.5

    # Route risk
    route_risk = 0.0
    for transit in decl.transit_countries:
        if (decl.origin_country, transit) in HIGH_RISK_ROUTES:
            route_risk = 1.0
            break
        if transit in HIGH_RISK_ORIGINS:
            route_risk = max(route_risk, 0.6)

    # Value anomaly: very low value for high-weight goods (undervaluation)
    value_risk = 0.0
    if decl.weight_kg and decl.weight_kg > 0:
        value_per_kg = decl.declared_value / decl.weight_kg
        if value_per_kg < 0.5:  # < $0.50/kg is suspicious
            value_risk = 0.8
        elif value_per_kg < 2.0:
            value_risk = 0.4

    # Trader compliance history
    compliance_risk = 0.0
    if decl.trader_declaration_count > 0:
        violation_rate = decl.trader_violation_count / decl.trader_declaration_count
        compliance_risk = min(violation_rate * 2, 1.0)
    elif decl.trader_declaration_count == 0:
        compliance_risk = 0.3  # Unknown trader → moderate risk

    # Express shipment risk (higher for high-value express)
    express_risk = 0.3 if decl.is_express and decl.declared_value > 10000 else 0.0

    # Description keyword risk
    desc_risk = 0.0
    if decl.declared_description:
        desc_lower = decl.declared_description.lower()
        high_risk_keywords = ["chemical", "pharmaceutical", "precursor", "dual-use", "military"]
        for kw in high_risk_keywords:
            if kw in desc_lower:
                desc_risk = 0.5
                break

    return {
        "hs_risk": hs_risk,
        "origin_risk": origin_risk,
        "route_risk": route_risk,
        "value_risk": value_risk,
        "compliance_risk": compliance_risk,
        "express_risk": express_risk,
        "desc_risk": desc_risk,
    }


# Feature weights (simulating a trained XGBoost model)
FEATURE_WEIGHTS = {
    "hs_risk": 30.0,
    "origin_risk": 20.0,
    "route_risk": 18.0,
    "compliance_risk": 15.0,
    "value_risk": 10.0,
    "express_risk": 4.0,
    "desc_risk": 3.0,
}


def score_declaration(decl: DeclarationFeatures) -> RiskScore:
    """
    Score a single declaration: deterministic rule layer first, then optional
    real ONNX-model augmentation. No hash-derived noise, no simulated models.
    """
    features = extract_features(decl)

    # Rule layer: transparent weighted sum
    raw_score = sum(features[k] * FEATURE_WEIGHTS[k] for k in features)

    # AEO adjustment
    aeo_adjusted = False
    aeo_discount = AEO_DISCOUNT.get(decl.aeo_status, 0.0)
    if aeo_discount > 0:
        raw_score = raw_score * (1.0 - aeo_discount)
        aeo_adjusted = True

    rules_score = max(0.0, min(100.0, raw_score))

    # Optional real ML augmentation
    ml_augmentation = "UNAVAILABLE"
    ml_model_version: Optional[str] = None
    score_value = rules_score
    ml_score = MODEL_LAYER.score(features) if MODEL_LAYER.available else None
    if ml_score is not None:
        score_value = blend_scores(rules_score, ml_score)
        ml_augmentation = "APPLIED"
        ml_model_version = RISK_MODEL_VERSION or "onnx-model"

    score = round(score_value, 2)

    # Risk tier assignment
    if score < 30:
        risk_tier = "GREEN"
        lane = "AUTO_APPROVE"
        recommendation = "Low risk — auto-approve for clearance."
    elif score < 65:
        risk_tier = "YELLOW"
        lane = "DOC_CHECK"
        recommendation = "Medium risk — request supporting documents (invoice, BL, certificate of origin)."
    else:
        risk_tier = "RED"
        lane = "PHYSICAL_INSPECTION"
        recommendation = "High risk — route to physical inspection lane. Notify OGA agencies."

    # SHAP-style explanation (feature contributions)
    total_weight = sum(FEATURE_WEIGHTS.values())
    shap_explanation = []
    for feat, val in features.items():
        contribution = (val * FEATURE_WEIGHTS[feat] / total_weight) * 100
        if contribution > 0.5:
            shap_explanation.append({
                "feature": feat,
                "value": val,
                "contribution": round(contribution, 2),
                "direction": "increases_risk" if val > 0 else "neutral",
            })

    shap_explanation.sort(key=lambda x: x["contribution"], reverse=True)

    return RiskScore(
        ucr=decl.ucr,
        score=score,
        risk_tier=risk_tier,
        lane=lane,
        aeo_adjusted=aeo_adjusted,
        feature_contributions={k: round(v * FEATURE_WEIGHTS[k], 2) for k, v in features.items()},
        shap_explanation=shap_explanation,
        recommendation=recommendation,
        ml_augmentation=ml_augmentation,
        ml_model_version=ml_model_version,
        scored_at=datetime.utcnow().isoformat() + "Z",
    )


# ─── API Endpoints ────────────────────────────────────────────────────────────

def current_model_version() -> str:
    """Honest model identity: the real loaded model, or rules-only."""
    if MODEL_LAYER.available:
        return RISK_MODEL_VERSION or "onnx-model"
    return "rules-only-2.0.0"


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "ray-risk-scorer",
        "version": "2.0.0",
        "model_version": current_model_version(),
        "ml_model_loaded": MODEL_LAYER.available,
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.post("/score", response_model=RiskScore)
def score_single(decl: DeclarationFeatures):
    """Score a single declaration."""
    return score_declaration(decl)


@app.post("/batch-score", response_model=BatchResponse)
def batch_score(req: BatchRequest):
    """Score multiple declarations in batch."""
    if len(req.declarations) > 1000:
        raise HTTPException(status_code=400, detail="Batch size cannot exceed 1000")

    start = time.time()
    results = [score_declaration(d) for d in req.declarations]
    elapsed_ms = (time.time() - start) * 1000

    return BatchResponse(
        results=results,
        batch_size=len(results),
        processing_time_ms=round(elapsed_ms, 2),
        model_version=current_model_version(),
    )


@app.get("/model-stats")
def get_model_stats():
    """
    Return the REAL state of the ML model layer. Never fabricated:
    - No model deployed  -> {"status": "NO_MODEL_DEPLOYED", ...}
    - Model deployed     -> real artefact metadata plus evaluation metrics
      ONLY if the training pipeline published them via
      RISK_MODEL_METRICS_PATH; otherwise metrics is null.
    """
    if not MODEL_LAYER.available:
        return {
            "status": "NO_MODEL_DEPLOYED",
            "message": (
                "No ML model is deployed in this service. Scoring is performed "
                "by the deterministic rule layer only. Deploy an ONNX model via "
                "RISK_MODEL_PATH to enable ML augmentation."
            ),
            "model_load_error": MODEL_LAYER.error,
            "rule_layer": {
                "model_version": "rules-only-2.0.0",
                "algorithm": "Deterministic weighted rule engine (transparent, no ML)",
                "feature_count": len(FEATURE_ORDER),
                "features": FEATURE_ORDER,
            },
        }

    metrics = None
    metrics_source = None
    if RISK_MODEL_METRICS_PATH:
        try:
            with open(RISK_MODEL_METRICS_PATH, "r", encoding="utf-8") as fh:
                metrics = json.load(fh)
            metrics_source = RISK_MODEL_METRICS_PATH
        except Exception as exc:
            metrics = None
            metrics_source = f"unreadable: {type(exc).__name__}: {exc}"

    return {
        "status": "MODEL_DEPLOYED",
        "model_version": current_model_version(),
        "model_path": RISK_MODEL_PATH,
        "runtime": "onnxruntime (CPUExecutionProvider)",
        "input_features": FEATURE_ORDER,
        "loaded_at": MODEL_LAYER.loaded_at,
        "metrics": metrics,
        "metrics_source": metrics_source,
        "metrics_note": (
            None if metrics is not None
            else "No evaluation metrics have been published by the training "
                 "pipeline for this artefact. Metrics are never invented by "
                 "the serving layer."
        ),
    }


@app.get("/feature-importance")
def get_feature_importance():
    """
    Return the rule-layer feature weights (transparent and deterministic).
    When an ONNX model is deployed, note honestly that opaque ONNX graphs do
    not expose feature importances through this service.
    """
    total = sum(FEATURE_WEIGHTS.values())
    importance = [
        {"feature": k, "importance": round(v / total, 4), "weight": v}
        for k, v in sorted(FEATURE_WEIGHTS.items(), key=lambda x: x[1], reverse=True)
    ]
    return {
        "feature_importance": importance,
        "source": "rule_layer_weights",
        "model_version": current_model_version(),
        "note": (
            "These are the deterministic rule-layer weights, not learned "
            "importances. The deployed ONNX model does not expose feature "
            "importances at serving time."
            if MODEL_LAYER.available else
            "These are the deterministic rule-layer weights; no ML model is "
            "deployed."
        ),
    }



# ─── Lifecycle ───────────────────────────────────────────────────────────────


if __name__ == "__main__":
    import uvicorn
    import os

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


    port = int(os.environ.get("PORT", 8101))
    uvicorn.run(app, host="0.0.0.0", port=port)
