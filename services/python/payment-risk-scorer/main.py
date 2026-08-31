"""
Payment Risk Scorer — TradeGateway NGSWTP
Language: Python 3.11 | Framework: FastAPI
Role: payment risk scoring before Mojaloop transfer initiation.

Scoring design (fail-closed, two layers):
  1. Deterministic rule layer (FIRST LINE OF DEFENCE, always runs):
     velocity checks, amount thresholds, FSP channel risk, time-of-day,
     duty-to-value ratio, trader compliance history, first-payment flag.
  2. Optional REAL ML augmentation layer (never fabricated):
     when the environment variable ML_SCORING_URL is set, the rule-layer
     feature vector is posted to that external inference endpoint (the
     future blueeconomy-ml-stack inference service) and its score is
     blended with the rule score. When ML_SCORING_URL is unset, the
     endpoint is unreachable, or the response is invalid, the response
     reports ml_augmentation="UNAVAILABLE" and the decision proceeds
     rules-only. This service NEVER invents an ML signal: a previous
     version derived an "ml_signal" by SHA-256-hashing the payer account,
     which was deterministic noise masquerading as ML and has been removed.

  Fail-closed guarantee: a rule-layer CRITICAL score (>= 0.85) is never
  softened by the ML layer — the ML layer can only augment, not unblock.

  Output: risk score (0.0–1.0), risk tier (LOW/MEDIUM/HIGH/CRITICAL),
  recommended action.

Risk tiers:
  LOW      (0.00–0.29) → auto-approve payment
  MEDIUM   (0.30–0.59) → approve with enhanced monitoring
  HIGH     (0.60–0.84) → require secondary authentication (OTP/biometric)
  CRITICAL (0.85–1.00) → block and alert compliance officer

Endpoints:
  GET  /health
  POST /api/payment-risk/score
  POST /api/payment-risk/batch-score
  GET  /api/payment-risk/stats

Environment:
  PAYMENT_RISK_PORT       — listen port (default 8092)
  ML_SCORING_URL          — full URL of the external ML scoring endpoint
                            (POST JSON {"features": {...}} ->
                             200 JSON {"risk_score": 0..1, "model_version": "..."}).
                            Unset => ML augmentation disabled (rules-only).
  ML_SCORING_TIMEOUT_MS   — HTTP timeout for the ML call (default 800)
"""

from contextlib import asynccontextmanager
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Optional

import httpx

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ─── Configuration ────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("payment-risk-scorer")

HTTP_PORT = int(os.getenv("PAYMENT_RISK_PORT", "8092"))

# External ML augmentation endpoint (blueeconomy-ml-stack inference service).
# Unset => ML layer disabled; every response reports ml_augmentation="UNAVAILABLE".
ML_SCORING_URL = os.getenv("ML_SCORING_URL", "").strip() or None
ML_SCORING_TIMEOUT_MS = int(os.getenv("ML_SCORING_TIMEOUT_MS", "800"))

# Blend weights when the ML layer is available. Rules remain the dominant layer.
RULES_BLEND_WEIGHT = 0.65
ML_BLEND_WEIGHT = 0.35

# ─── Risk tables ──────────────────────────────────────────────────────────────

# FSP risk weights (higher = riskier channel for fraud)
FSP_RISK_WEIGHTS: dict[str, float] = {
    "GCB_BANK": 0.10,
    "ECOBANK_GH": 0.10,
    "STANBIC_GH": 0.10,
    "MTN_MOMO": 0.20,
    "VODAFONE_CASH": 0.22,
    "AIRTELTIGO_MONEY": 0.25,
    "CENTRAL_BANK": 0.05,  # RTGS — lowest risk
}

# Amount thresholds (GHS)
AMOUNT_THRESHOLDS = {
    "low": 5_000,
    "medium": 50_000,
    "high": 500_000,
    "critical": 5_000_000,
}

# High-risk hour ranges (UTC) — late-night transactions carry higher risk
HIGH_RISK_HOURS = {0, 1, 2, 3, 4, 22, 23}

# Velocity limits (per trader per 24h)
VELOCITY_LIMIT_COUNT = 10
VELOCITY_LIMIT_AMOUNT_GHS = 1_000_000

# ─── In-memory velocity tracker ───────────────────────────────────────────────

class VelocityTracker:
    """Tracks payment counts and amounts per trader within a rolling 24-hour window."""

    def __init__(self):
        self._data: dict[str, list[dict]] = {}

    def record(self, trader_id: str, amount: float) -> None:
        now = time.time()
        if trader_id not in self._data:
            self._data[trader_id] = []
        self._data[trader_id].append({"ts": now, "amount": amount})
        # Prune entries older than 24h
        cutoff = now - 86_400
        self._data[trader_id] = [e for e in self._data[trader_id] if e["ts"] > cutoff]

    def get_stats(self, trader_id: str) -> dict:
        now = time.time()
        cutoff = now - 86_400
        entries = [e for e in self._data.get(trader_id, []) if e["ts"] > cutoff]
        return {
            "count_24h": len(entries),
            "amount_24h": sum(e["amount"] for e in entries),
        }


velocity_tracker = VelocityTracker()

# ─── Pydantic models ──────────────────────────────────────────────────────────

class PaymentScoreRequest(BaseModel):
    trader_id: str = Field(..., description="Unique trader identifier")
    declaration_id: Optional[str] = Field(None, description="Associated declaration ID")
    amount: float = Field(..., gt=0, description="Payment amount in GHS")
    currency: str = Field("GHS", description="ISO 4217 currency code")
    fsp_id: str = Field(..., description="Financial Service Provider ID")
    fsp_type: str = Field(..., description="FSP type: BANK | MOBILE_MONEY | RTGS")
    payer_account: str = Field(..., description="Payer account number or MSISDN")
    declaration_value: Optional[float] = Field(None, description="Declared goods value in GHS")
    trader_compliance_score: Optional[float] = Field(
        None, ge=0.0, le=1.0,
        description="Trader's historical compliance score (0=poor, 1=excellent)"
    )
    is_first_payment: Optional[bool] = Field(False, description="First payment from this trader")


class PaymentScoreResponse(BaseModel):
    trader_id: str
    declaration_id: Optional[str]
    risk_score: float
    risk_tier: str
    recommended_action: str
    flags: list[str]
    features: dict
    model_version: str
    ml_augmentation: str = Field(
        ...,
        description="APPLIED if a real external ML model augmented the rule score; "
                    "UNAVAILABLE if no ML endpoint is configured/reachable (rules-only)"
    )
    ml_model_version: Optional[str] = Field(
        None, description="Model version reported by the external ML endpoint, when APPLIED"
    )
    scored_at: str


class BatchScoreRequest(BaseModel):
    payments: list[PaymentScoreRequest]


# ─── External ML augmentation client ─────────────────────────────────────────

def query_ml_scorer(features: dict) -> Optional[dict]:
    """
    Call the external ML scoring endpoint (blueeconomy-ml-stack).

    Returns {"risk_score": float, "model_version": str} on success, or None
    when the ML layer is unconfigured, unreachable, times out, or returns an
    invalid payload. Never raises — the caller fails closed to rules-only.
    """
    if not ML_SCORING_URL:
        return None
    try:
        resp = httpx.post(
            ML_SCORING_URL,
            json={"features": features},
            timeout=ML_SCORING_TIMEOUT_MS / 1000.0,
        )
        if resp.status_code != 200:
            logger.warning("ML scorer returned HTTP %s — rules-only", resp.status_code)
            return None
        payload = resp.json()
        score = float(payload["risk_score"])
        if not (0.0 <= score <= 1.0):
            logger.warning("ML scorer returned out-of-range score %s — ignored", score)
            return None
        return {
            "risk_score": score,
            "model_version": str(payload.get("model_version", "unknown")),
        }
    except Exception as exc:
        logger.warning("ML scorer unavailable (%s) — rules-only", exc)
        return None


def blend_scores(rules_score: float, ml_score: float) -> float:
    """
    Blend the deterministic rule score with a real external ML score.

    Fail-closed: a rule-layer CRITICAL (>= 0.85) is returned unchanged — the
    ML layer can augment but can never unblock what the rules blocked.
    """
    if rules_score >= 0.85:
        return rules_score
    blended = RULES_BLEND_WEIGHT * rules_score + ML_BLEND_WEIGHT * ml_score
    return min(1.0, max(0.0, blended))


# ─── Scoring engine ───────────────────────────────────────────────────────────

class PaymentRiskScorer:
    """
    Deterministic rule-based payment risk scorer with an optional, genuinely
    external ML augmentation layer (see query_ml_scorer). No simulated or
    hash-derived "ML" signals exist in this service.
    """

    MODEL_VERSION = "rules-2.0.0"

    def score(self, req: PaymentScoreRequest) -> PaymentScoreResponse:
        flags: list[str] = []
        feature_scores: dict[str, float] = {}

        # ── Feature 1: Amount risk ──────────────────────────────────────────
        amount_score = self._score_amount(req.amount)
        feature_scores["amount_risk"] = amount_score
        if amount_score > 0.7:
            flags.append(f"HIGH_AMOUNT: {req.amount:,.2f} GHS exceeds threshold")

        # ── Feature 2: FSP channel risk ─────────────────────────────────────
        fsp_score = FSP_RISK_WEIGHTS.get(req.fsp_id, 0.30)
        feature_scores["fsp_channel_risk"] = fsp_score

        # ── Feature 3: Time-of-day risk ─────────────────────────────────────
        hour_utc = datetime.now(timezone.utc).hour
        tod_score = 0.35 if hour_utc in HIGH_RISK_HOURS else 0.05
        feature_scores["time_of_day_risk"] = tod_score
        if tod_score > 0.3:
            flags.append(f"OFF_HOURS: payment at {hour_utc:02d}:00 UTC")

        # ── Feature 4: Velocity risk ────────────────────────────────────────
        velocity = velocity_tracker.get_stats(req.trader_id)
        velocity_score = 0.0
        if velocity["count_24h"] >= VELOCITY_LIMIT_COUNT:
            velocity_score = 0.8
            flags.append(f"VELOCITY_COUNT: {velocity['count_24h']} payments in 24h")
        elif velocity["count_24h"] >= VELOCITY_LIMIT_COUNT * 0.7:
            velocity_score = 0.4
        if velocity["amount_24h"] >= VELOCITY_LIMIT_AMOUNT_GHS:
            velocity_score = max(velocity_score, 0.85)
            flags.append(f"VELOCITY_AMOUNT: {velocity['amount_24h']:,.2f} GHS in 24h")
        feature_scores["velocity_risk"] = velocity_score

        # ── Feature 5: Duty-to-value ratio anomaly ──────────────────────────
        ratio_score = 0.0
        if req.declaration_value and req.declaration_value > 0:
            ratio = req.amount / req.declaration_value
            if ratio > 0.5:
                ratio_score = 0.6
                flags.append(f"HIGH_DUTY_RATIO: duty is {ratio*100:.1f}% of declared value")
            elif ratio < 0.01:
                ratio_score = 0.4
                flags.append(f"LOW_DUTY_RATIO: duty is only {ratio*100:.2f}% of declared value")
        feature_scores["duty_value_ratio_risk"] = ratio_score

        # ── Feature 6: Trader compliance history ────────────────────────────
        compliance = req.trader_compliance_score if req.trader_compliance_score is not None else 0.5
        compliance_score = 1.0 - compliance  # invert: low compliance = high risk
        feature_scores["compliance_risk"] = compliance_score
        if compliance < 0.3:
            flags.append(f"LOW_COMPLIANCE: trader compliance score {compliance:.2f}")

        # ── Feature 7: First-payment risk ───────────────────────────────────
        first_payment_score = 0.15 if req.is_first_payment else 0.0
        feature_scores["first_payment_risk"] = first_payment_score
        if req.is_first_payment:
            flags.append("FIRST_PAYMENT: no prior payment history")

        # ── Rule layer: weighted average (renormalised over present weights) ─
        weights = {
            "amount_risk": 0.25,
            "fsp_channel_risk": 0.10,
            "time_of_day_risk": 0.08,
            "velocity_risk": 0.25,
            "duty_value_ratio_risk": 0.12,
            "compliance_risk": 0.12,
            "first_payment_risk": 0.04,
        }
        weight_total = sum(weights.values())
        rules_score = sum(feature_scores[k] * weights[k] for k in weights) / weight_total
        rules_score = min(1.0, max(0.0, rules_score))

        # ── Optional ML augmentation (real external endpoint only) ──────────
        ml_augmentation = "UNAVAILABLE"
        ml_model_version: Optional[str] = None
        risk_score = rules_score
        ml_result = query_ml_scorer(feature_scores)
        if ml_result is not None:
            risk_score = blend_scores(rules_score, ml_result["risk_score"])
            ml_augmentation = "APPLIED"
            ml_model_version = ml_result["model_version"]
            feature_scores["ml_external_score"] = ml_result["risk_score"]

        # ── Tier and action ─────────────────────────────────────────────────
        if risk_score < 0.30:
            tier = "LOW"
            action = "APPROVE"
        elif risk_score < 0.60:
            tier = "MEDIUM"
            action = "APPROVE_WITH_MONITORING"
        elif risk_score < 0.85:
            tier = "HIGH"
            action = "REQUIRE_2FA"
        else:
            tier = "CRITICAL"
            action = "BLOCK_AND_ALERT"
            flags.append("CRITICAL_RISK: payment blocked — compliance officer notified")

        # Record velocity for future checks
        velocity_tracker.record(req.trader_id, req.amount)

        logger.info(
            "payment scored",
            extra={
                "trader_id": req.trader_id,
                "risk_score": round(risk_score, 4),
                "tier": tier,
                "action": action,
                "flags": flags,
            },
        )

        return PaymentScoreResponse(
            trader_id=req.trader_id,
            declaration_id=req.declaration_id,
            risk_score=round(risk_score, 4),
            risk_tier=tier,
            recommended_action=action,
            flags=flags,
            features=feature_scores,
            model_version=self.MODEL_VERSION,
            ml_augmentation=ml_augmentation,
            ml_model_version=ml_model_version,
            scored_at=datetime.now(timezone.utc).isoformat(),
        )

    def _score_amount(self, amount: float) -> float:
        if amount <= AMOUNT_THRESHOLDS["low"]:
            return 0.05
        elif amount <= AMOUNT_THRESHOLDS["medium"]:
            return 0.20
        elif amount <= AMOUNT_THRESHOLDS["high"]:
            return 0.50
        elif amount <= AMOUNT_THRESHOLDS["critical"]:
            return 0.75
        else:
            return 0.95


scorer = PaymentRiskScorer()

# ─── Stats tracker ────────────────────────────────────────────────────────────

stats = {
    "total_scored": 0,
    "by_tier": {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0},
    "blocked": 0,
    "started_at": datetime.now(timezone.utc).isoformat(),
}

# ─── FastAPI app ──────────────────────────────────────────────────────────────


# ─── Application Lifespan ───────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan: activates full middleware bundle on startup."""
    async with middleware_lifespan():
        yield

app = FastAPI(
    title="Payment Risk Scorer",
    description="Deterministic rule-based payment risk scoring for TradeGateway NGSWTP "
                "with optional external ML augmentation (fail-closed)",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "payment-risk-scorer",
        "model_version": PaymentRiskScorer.MODEL_VERSION,
        "uptime_since": stats["started_at"],
    }


@app.post("/api/payment-risk/score", response_model=PaymentScoreResponse)
def score_payment(req: PaymentScoreRequest):
    try:
        result = scorer.score(req)
        stats["total_scored"] += 1
        stats["by_tier"][result.risk_tier] += 1
        if result.recommended_action == "BLOCK_AND_ALERT":
            stats["blocked"] += 1
        return result
    except Exception as e:
        logger.error(f"Scoring error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/payment-risk/batch-score")
def batch_score(req: BatchScoreRequest):
    results = []
    for payment in req.payments:
        try:
            result = scorer.score(payment)
            stats["total_scored"] += 1
            stats["by_tier"][result.risk_tier] += 1
            if result.recommended_action == "BLOCK_AND_ALERT":
                stats["blocked"] += 1
            results.append(result.model_dump())
        except Exception as e:
            results.append({"error": str(e), "trader_id": payment.trader_id})
    return {"results": results, "count": len(results)}


@app.get("/api/payment-risk/stats")
def get_stats():
    return {
        **stats,
        "model_version": PaymentRiskScorer.MODEL_VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ─── Entry point ──────────────────────────────────────────────────────────────


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


    logger.info(f"Payment Risk Scorer starting on port {HTTP_PORT}")
    uvicorn.run(app, host="0.0.0.0", port=HTTP_PORT)
