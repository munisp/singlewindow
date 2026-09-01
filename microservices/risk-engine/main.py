"""
risk-engine — TradeGateway NGSWTP
Python FastAPI service that computes rule-based risk scores for customs
declarations. This is a HAND-WEIGHTED DETERMINISTIC HEURISTIC — there is no
trained ML model in this service (ML scoring lives in blueeconomy-ml-stack).
`modelVersion` honestly identifies the active rule set as
`rules-v1-<sha256[:12]>` where the hash is computed over the actual rule
tables (HS profiles, country risk, weights, reference prices), so any rule
change changes the reported version.

Features combined by the heuristic:
  - Trader compliance history (from the database — FAIL CLOSED: when the
    trader profile cannot be fetched due to a database error the score is
    unavailable, HTTP 503 RISK_UNAVAILABLE; a 0.50 stand-in is never used)
  - HS code risk profile
  - Declared value vs. reference price
  - Origin country risk
  - Document completeness

Lane assignment:
  - GREEN  (score < 30):  Auto-clearance, no inspection
  - YELLOW (30-70):       Documentary review
  - RED    (> 70):        Physical inspection + officer review
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [risk-engine] %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway",
)
PORT = int(os.getenv("PORT", "8085"))

# ── HS Code risk profiles (WCO-based risk categories) ─────────────────────────
HS_RISK_PROFILES: dict[str, float] = {
    # Chapter 93: Arms and ammunition — highest risk
    "93": 0.95,
    # Chapter 29: Organic chemicals (dual-use)
    "29": 0.70,
    # Chapter 28: Inorganic chemicals
    "28": 0.65,
    # Chapter 84: Machinery (high-value, under-invoicing risk)
    "84": 0.45,
    # Chapter 85: Electrical equipment
    "85": 0.40,
    # Chapter 61-62: Clothing (misdescription risk)
    "61": 0.55,
    "62": 0.55,
    # Chapter 64: Footwear
    "64": 0.50,
    # Chapter 39: Plastics
    "39": 0.30,
    # Chapter 10: Cereals
    "10": 0.20,
    # Chapter 08: Fruit
    "08": 0.20,
}

# ── Country risk scores (FATF/WCO risk-based) ─────────────────────────────────
COUNTRY_RISK: dict[str, float] = {
    # High-risk jurisdictions
    "IR": 0.95, "KP": 0.99, "SY": 0.90, "YE": 0.85, "LY": 0.80,
    # Medium-high risk
    "PK": 0.60, "MM": 0.65, "AF": 0.90, "IQ": 0.75,
    # Medium risk
    "NG": 0.45, "GH": 0.30, "KE": 0.35, "TZ": 0.35,
    # Lower risk (OECD)
    "DE": 0.10, "GB": 0.10, "US": 0.12, "JP": 0.08, "SG": 0.08,
    "CN": 0.40, "IN": 0.35,
}

# ── Heuristic rule set (weights, reference prices, adjustments) ──────────────
# Feature weights, calibrated from WCO risk management guidelines.
RULE_WEIGHTS: dict[str, float] = {
    "hs_risk": 0.25,
    "country_risk": 0.20,
    "trader_risk": 0.30,
    "value_deviation": 0.20,
    "document_risk": 0.05,
}

# Simplified reference prices per HS chapter (USD/kg).
REFERENCE_PRICES: dict[str, float] = {
    "84": 5000, "85": 3000, "61": 20, "62": 25,
    "64": 30, "39": 5, "29": 50, "28": 30,
}
REFERENCE_PRICE_DEFAULT = 100.0

# Document risk by KYC state and the AEO risk-reduction multiplier.
DOCUMENT_RISK_KYC_VERIFIED = 0.1
DOCUMENT_RISK_KYC_UNVERIFIED = 0.5
AEO_RISK_MULTIPLIER = 0.60

# Policy default for a trader with NO profile row (unknown trader). This is
# an explicit, labelled policy choice — never used to mask a database
# failure (those fail closed with RISK_UNAVAILABLE).
UNKNOWN_TRADER_RISK = 0.50

# Honest model identity: hash of the actual rule tables above. Any change to
# the rules changes the reported version.
MODEL_VERSION = "rules-v1-" + hashlib.sha256(
    json.dumps(
        {
            "hs_risk_profiles": HS_RISK_PROFILES,
            "country_risk": COUNTRY_RISK,
            "rule_weights": RULE_WEIGHTS,
            "reference_prices": REFERENCE_PRICES,
            "reference_price_default": REFERENCE_PRICE_DEFAULT,
            "document_risk": {
                "kyc_verified": DOCUMENT_RISK_KYC_VERIFIED,
                "kyc_unverified": DOCUMENT_RISK_KYC_UNVERIFIED,
            },
            "aeo_risk_multiplier": AEO_RISK_MULTIPLIER,
            "unknown_trader_risk": UNKNOWN_TRADER_RISK,
        },
        sort_keys=True,
    ).encode("utf-8")
).hexdigest()[:12]


class RiskUnavailableError(RuntimeError):
    """Fail-closed: a required risk input could not be obtained."""

    CODE = "RISK_UNAVAILABLE"


# ── Database connection pool ──────────────────────────────────────────────────
_db_conn: Optional[psycopg2.extensions.connection] = None


def get_db():
    global _db_conn
    if _db_conn is None or _db_conn.closed:
        _db_conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    return _db_conn


# ── Pydantic models ───────────────────────────────────────────────────────────
class RiskScoreRequest(BaseModel):
    declarationId: int
    traderId: int
    hsCode: str = Field(..., min_length=2, max_length=10)
    declaredValue: float = Field(..., gt=0)
    originCountry: str = Field(..., min_length=2, max_length=3)


class RiskScoreResponse(BaseModel):
    declarationId: int
    score: float = Field(..., ge=0, le=100)
    lane: str  # "green", "yellow", "red"
    features: dict
    scoredAt: str
    modelVersion: str = MODEL_VERSION  # honest heuristic identity, not a model


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    time: str


# ── Risk scoring engine ───────────────────────────────────────────────────────

def get_hs_risk(hs_code: str) -> float:
    """Returns risk score for an HS code based on chapter (first 2 digits)."""
    chapter = hs_code[:2]
    return HS_RISK_PROFILES.get(chapter, 0.35)  # Default 35% risk


def get_country_risk(country_code: str) -> float:
    """Returns risk score for an origin country."""
    return COUNTRY_RISK.get(country_code.upper(), 0.35)


def get_trader_risk(trader_id: int) -> tuple[float, dict]:
    """Fetches trader compliance history from database."""
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    compliance_score,
                    total_declarations,
                    rejected_declarations,
                    kyc_status,
                    aeo_status
                FROM trader_profiles
                WHERE user_id = %s
                LIMIT 1
            """, (trader_id,))
            row = cur.fetchone()
            if not row:
                # Unknown trader: explicit labelled policy default (the
                # trader has no compliance history to score from).
                return UNKNOWN_TRADER_RISK, {
                    "compliance_score": None,
                    "aeo": False,
                    "kyc_verified": False,
                    "traderKnown": False,
                    "traderRiskSource": "policy-default-unknown-trader",
                }

            compliance = float(row["compliance_score"]) / 100.0
            trader_risk = 1.0 - compliance  # High compliance = low risk

            return trader_risk, {
                "compliance_score": float(row["compliance_score"]),
                "total_declarations": row["total_declarations"],
                "rejected_declarations": row["rejected_declarations"],
                "aeo": row["aeo_status"] == "certified",
                "kyc_verified": row["kyc_status"] == "verified",
                "traderKnown": True,
                "traderRiskSource": "trader_profiles",
            }
    except RiskUnavailableError:
        raise
    except Exception as e:
        # FAIL CLOSED: a database error is never masked by a 0.50 stand-in.
        logger.error(f"Trader risk unavailable for {trader_id}: {e}")
        raise RiskUnavailableError(
            f"trader compliance history unavailable (database error): {e}"
        ) from e


def get_reference_price_deviation(hs_code: str, declared_value: float) -> float:
    """
    Compares declared value against the chapter reference-price table
    (REFERENCE_PRICES, USD/kg; part of the hashed rule set).
    Returns deviation ratio (0 = no deviation, 1 = 100% deviation).
    """
    chapter = hs_code[:2]
    ref = REFERENCE_PRICES.get(chapter, REFERENCE_PRICE_DEFAULT)
    # Assume 1 unit = 1 kg for simplification
    deviation = abs(declared_value - ref) / max(ref, 1)
    return min(deviation, 1.0)


def compute_risk_score(
    hs_risk: float,
    country_risk: float,
    trader_risk: float,
    value_deviation: float,
    aeo_certified: bool,
    kyc_verified: bool,
) -> float:
    """
    Hand-weighted heuristic risk score (no trained model). Weights live in
    RULE_WEIGHTS and are part of the hashed MODEL_VERSION rule set.
    """
    weights = RULE_WEIGHTS

    # Document risk: lower if KYC verified
    document_risk = DOCUMENT_RISK_KYC_VERIFIED if kyc_verified else DOCUMENT_RISK_KYC_UNVERIFIED

    raw_score = (
        weights["hs_risk"] * hs_risk
        + weights["country_risk"] * country_risk
        + weights["trader_risk"] * trader_risk
        + weights["value_deviation"] * value_deviation
        + weights["document_risk"] * document_risk
    )

    # AEO traders get a risk reduction
    if aeo_certified:
        raw_score *= AEO_RISK_MULTIPLIER

    # Scale to 0-100
    return round(min(raw_score * 100, 100), 2)


def assign_lane(score: float) -> str:
    if score < 30:
        return "green"
    elif score < 70:
        return "yellow"
    return "red"


# ── FastAPI app ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"[risk-engine] Starting on port {PORT}")
    try:
        get_db()
        logger.info("[risk-engine] Database connection established")
    except Exception as e:
        logger.warning(f"[risk-engine] Database not available at startup: {e}")
    yield
    logger.info("[risk-engine] Shutting down")


app = FastAPI(
    title="TradeGateway Risk Engine",
    description="Rule-based (hand-weighted heuristic) risk scoring for customs declarations",
    version="1.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        service="risk-engine",
        version="1.2.0",
        time=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/api/risk/score", response_model=RiskScoreResponse)
async def score_declaration(request: RiskScoreRequest):
    """Compute risk score for a customs declaration."""
    start = time.perf_counter()

    # Gather features
    hs_risk = get_hs_risk(request.hsCode)
    country_risk = get_country_risk(request.originCountry)
    try:
        trader_risk, trader_info = get_trader_risk(request.traderId)
    except RiskUnavailableError as e:
        # FAIL CLOSED: never score with a fabricated trader input.
        raise HTTPException(
            status_code=503,
            detail=f"{RiskUnavailableError.CODE}: {e}",
        ) from e
    value_deviation = get_reference_price_deviation(request.hsCode, request.declaredValue)

    # Compute score
    score = compute_risk_score(
        hs_risk=hs_risk,
        country_risk=country_risk,
        trader_risk=trader_risk,
        value_deviation=value_deviation,
        aeo_certified=trader_info["aeo"],
        kyc_verified=trader_info["kyc_verified"],
    )

    lane = assign_lane(score)
    elapsed_ms = round((time.perf_counter() - start) * 1000, 2)

    logger.info(
        f"[risk-engine] Declaration {request.declarationId}: "
        f"score={score:.1f} lane={lane} elapsed={elapsed_ms}ms"
    )

    # Persist risk score to database
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE declarations
                SET risk_score = %s, risk_lane = %s, updated_at = NOW()
                WHERE id = %s
            """, (score, lane, request.declarationId))
            conn.commit()
    except Exception as e:
        logger.warning(f"[risk-engine] Failed to persist risk score: {e}")

    return RiskScoreResponse(
        declarationId=request.declarationId,
        score=score,
        lane=lane,
        features={
            "hsRisk": hs_risk,
            "countryRisk": country_risk,
            "traderRisk": trader_risk,
            "valueDeviation": value_deviation,
            "traderInfo": trader_info,
            "elapsedMs": elapsed_ms,
        },
        scoredAt=datetime.now(timezone.utc).isoformat(),
    )


@app.get("/api/risk/hs-profile/{hs_code}")
async def get_hs_profile(hs_code: str):
    """Returns risk profile for an HS code."""
    risk = get_hs_risk(hs_code)
    chapter = hs_code[:2]
    return {
        "hsCode": hs_code,
        "chapter": chapter,
        "riskScore": risk,
        "riskLevel": "high" if risk > 0.65 else "medium" if risk > 0.35 else "low",
    }


@app.get("/api/risk/country-profile/{country_code}")
async def get_country_profile(country_code: str):
    """Returns risk profile for a country."""
    risk = get_country_risk(country_code)
    return {
        "countryCode": country_code.upper(),
        "riskScore": risk,
        "riskLevel": "high" if risk > 0.65 else "medium" if risk > 0.35 else "low",
    }


@app.get("/api/risk/stats")
async def get_risk_stats():
    """Returns risk scoring statistics."""
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    risk_lane,
                    COUNT(*) as count,
                    AVG(risk_score) as avg_score
                FROM declarations
                WHERE risk_lane IS NOT NULL
                GROUP BY risk_lane
                ORDER BY risk_lane
            """)
            rows = cur.fetchall()
            return {
                "stats": [dict(r) for r in rows],
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
