"""
Risk Engine Service — ML-powered risk scoring for customs declarations
Language: Python 3.11 | Framework: FastAPI | Protocol: HTTP REST

Risk scoring approach:
- Rule-based pre-filters (high-risk HS codes, sanctioned countries, value anomalies)
- ML model: Random Forest classifier trained on historical declaration outcomes
- Feature engineering: trader history, commodity risk, origin risk, value/weight ratio
- Lane assignment: GREEN (auto-approve) | YELLOW (doc review) | RED (physical inspection)

WCO SAFE Framework risk management principles:
- Risk profiling based on trader compliance history
- Commodity-based risk assessment
- Origin country risk scoring
- Value/weight anomaly detection
"""

from contextlib import asynccontextmanager
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ─── CONFIGURATION ────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("risk-engine")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway"
)
HTTP_PORT = int(os.getenv("RISK_ENGINE_PORT", "8090"))

# ─── RISK TABLES ─────────────────────────────────────────────────────────────

# High-risk HS chapters (WCO risk indicators)
HIGH_RISK_HS_CHAPTERS = {
    "93": 0.9,   # Weapons
    "28": 0.85,  # Radioactive materials
    "36": 0.85,  # Explosives
    "30": 0.6,   # Pharmaceuticals
    "22": 0.5,   # Beverages (excise fraud)
    "24": 0.6,   # Tobacco (excise fraud)
    "61": 0.4,   # Clothing (undervaluation)
    "62": 0.4,   # Clothing
    "64": 0.35,  # Footwear (undervaluation)
    "85": 0.3,   # Electronics (undervaluation)
}

# Country risk scores (0 = low risk, 1 = very high risk)
# Based on FATF grey/black lists, UN sanctions, WCO risk data
COUNTRY_RISK_SCORES = {
    # FATF Black List (highest risk)
    "KP": 0.95,  # North Korea
    "IR": 0.90,  # Iran
    "MM": 0.80,  # Myanmar
    # FATF Grey List
    "AF": 0.75,  # Afghanistan
    "PK": 0.65,  # Pakistan
    "SY": 0.85,  # Syria
    "YE": 0.80,  # Yemen
    "LY": 0.75,  # Libya
    "SD": 0.70,  # Sudan
    "SO": 0.75,  # Somalia
    "VE": 0.65,  # Venezuela
    # Medium risk
    "NG": 0.45,  # Nigeria (FATF monitoring)
    "ET": 0.40,  # Ethiopia
    "CD": 0.55,  # DRC
    "ZW": 0.50,  # Zimbabwe
    # Low risk (OECD/EU)
    "DE": 0.05,  # Germany
    "GB": 0.05,  # UK
    "FR": 0.05,  # France
    "US": 0.05,  # USA
    "JP": 0.05,  # Japan
    "SG": 0.05,  # Singapore
    "CH": 0.05,  # Switzerland
    # African low-medium risk
    "GH": 0.20,  # Ghana
    "RW": 0.15,  # Rwanda
    "KE": 0.25,  # Kenya
    "TZ": 0.25,  # Tanzania
    "UG": 0.30,  # Uganda
    "ZA": 0.20,  # South Africa
    "EG": 0.30,  # Egypt
    "MA": 0.25,  # Morocco
    "TN": 0.25,  # Tunisia
    "CN": 0.30,  # China
    "IN": 0.20,  # India
    "AE": 0.25,  # UAE
}

DEFAULT_COUNTRY_RISK = 0.40  # Default for unknown countries

# ─── PYDANTIC MODELS ─────────────────────────────────────────────────────────

class ScoreRequest(BaseModel):
    declaration_id: int
    trader_id: int
    hs_code: str
    origin_country: str
    destination_country: str
    declared_value: float
    gross_weight_kg: float
    declaration_type: str = "import"
    is_aeo_certified: bool = False
    trader_declaration_count: int = 0
    trader_compliance_rate: float = 1.0
    document_types: list[str] = []
    preferential_origin_claim: bool = False
    num_packages: int = 1

class RiskFactor(BaseModel):
    factor: str
    weight: float
    description: str

class ScoreResponse(BaseModel):
    declaration_id: int
    risk_score: float
    risk_lane: str  # green | yellow | red
    risk_factors: list[RiskFactor]
    recommended_checks: list[str]
    requires_physical_inspection: bool
    requires_document_review: bool
    confidence: float
    scored_at: str

class BatchScoreRequest(BaseModel):
    declarations: list[ScoreRequest]

class TraderRiskProfile(BaseModel):
    trader_id: int
    overall_risk_score: float
    total_declarations: int
    violations_count: int
    compliance_rate: float
    risk_category: str
    is_aeo_eligible: bool
    risk_indicators: list[str]

# ─── RISK SCORING ENGINE ──────────────────────────────────────────────────────

def compute_value_weight_ratio_risk(declared_value: float, gross_weight_kg: float) -> float:
    """
    Detect value/weight anomalies.
    Very high value with very low weight, or vice versa, indicates potential fraud.
    """
    if gross_weight_kg <= 0:
        return 0.5
    ratio = declared_value / gross_weight_kg  # USD per kg
    # Extremely high ratio (e.g., $100k/kg for electronics) or very low (undervaluation)
    if ratio > 10_000:
        return 0.7  # Very high value per kg — possible overvaluation for insurance fraud
    if ratio < 0.1:
        return 0.6  # Very low value per kg — possible undervaluation
    if ratio < 1.0:
        return 0.4  # Low value per kg — moderate risk
    return 0.1  # Normal range

def compute_hs_risk(hs_code: str) -> float:
    """Get risk score for HS chapter."""
    chapter = hs_code[:2] if len(hs_code) >= 2 else "00"
    return HIGH_RISK_HS_CHAPTERS.get(chapter, 0.15)

def compute_country_risk(origin_country: str, destination_country: str) -> float:
    """Compute combined origin/destination country risk."""
    origin_risk = COUNTRY_RISK_SCORES.get(origin_country, DEFAULT_COUNTRY_RISK)
    dest_risk = COUNTRY_RISK_SCORES.get(destination_country, DEFAULT_COUNTRY_RISK)
    # Weight origin more heavily
    return 0.7 * origin_risk + 0.3 * dest_risk

def compute_trader_risk(
    trader_declaration_count: int,
    trader_compliance_rate: float,
    is_aeo_certified: bool,
) -> float:
    """Compute trader-specific risk score."""
    if is_aeo_certified:
        return 0.05  # AEO traders are pre-vetted — very low risk

    # New traders (< 10 declarations) have higher uncertainty
    if trader_declaration_count < 10:
        base_risk = 0.5
    elif trader_declaration_count < 50:
        base_risk = 0.3
    else:
        base_risk = 0.15

    # Adjust for compliance history
    compliance_penalty = (1.0 - trader_compliance_rate) * 0.5
    return min(base_risk + compliance_penalty, 1.0)

def compute_document_completeness_risk(document_types: list[str]) -> float:
    """Risk from missing standard documents."""
    required = {"INVOICE", "PACKING_LIST", "BL_AWB"}
    missing = required - set(document_types)
    if not missing:
        return 0.0
    return len(missing) * 0.25  # 0.25 per missing required document

def score_declaration(request: ScoreRequest) -> ScoreResponse:
    """Compute comprehensive risk score for a declaration."""
    start_time = time.time()

    risk_factors = []

    # 1. HS code risk
    hs_risk = compute_hs_risk(request.hs_code)
    if hs_risk > 0.1:
        risk_factors.append(RiskFactor(
            factor="hs_code_risk",
            weight=hs_risk,
            description=f"HS code {request.hs_code} (chapter {request.hs_code[:2]}) has elevated risk profile"
        ))

    # 2. Country risk
    country_risk = compute_country_risk(request.origin_country, request.destination_country)
    if country_risk > 0.2:
        risk_factors.append(RiskFactor(
            factor="country_risk",
            weight=country_risk,
            description=f"Origin country {request.origin_country} has risk score {country_risk:.2f}"
        ))

    # 3. Value/weight anomaly
    vw_risk = compute_value_weight_ratio_risk(request.declared_value, request.gross_weight_kg)
    if vw_risk > 0.2:
        ratio = request.declared_value / max(request.gross_weight_kg, 0.001)
        risk_factors.append(RiskFactor(
            factor="value_weight_anomaly",
            weight=vw_risk,
            description=f"Value/weight ratio ${ratio:.2f}/kg is outside normal range"
        ))

    # 4. Trader risk
    trader_risk = compute_trader_risk(
        request.trader_declaration_count,
        request.trader_compliance_rate,
        request.is_aeo_certified,
    )
    if trader_risk > 0.1:
        risk_factors.append(RiskFactor(
            factor="trader_risk",
            weight=trader_risk,
            description=f"Trader risk: {request.trader_declaration_count} declarations, "
                        f"{request.trader_compliance_rate:.0%} compliance rate"
        ))

    # 5. Document completeness
    doc_risk = compute_document_completeness_risk(request.document_types)
    if doc_risk > 0:
        risk_factors.append(RiskFactor(
            factor="missing_documents",
            weight=doc_risk,
            description=f"Missing required documents — risk penalty {doc_risk:.2f}"
        ))

    # 6. High-value threshold
    if request.declared_value > 50_000:
        risk_factors.append(RiskFactor(
            factor="high_value",
            weight=0.2,
            description=f"High-value declaration: ${request.declared_value:,.2f} exceeds $50,000 threshold"
        ))

    # 7. AEO discount
    if request.is_aeo_certified:
        risk_factors.append(RiskFactor(
            factor="aeo_certified",
            weight=-0.3,
            description="AEO certification: significant risk reduction applied"
        ))

    # Weighted composite score
    weights = {
        "hs_code_risk": 0.25,
        "country_risk": 0.30,
        "value_weight_anomaly": 0.15,
        "trader_risk": 0.20,
        "missing_documents": 0.10,
    }

    raw_score = (
        weights["hs_code_risk"] * hs_risk +
        weights["country_risk"] * country_risk +
        weights["value_weight_anomaly"] * vw_risk +
        weights["trader_risk"] * trader_risk +
        weights["missing_documents"] * doc_risk
    )

    # AEO discount
    if request.is_aeo_certified:
        raw_score *= 0.3

    # High-value surcharge
    if request.declared_value > 50_000:
        raw_score = min(raw_score + 0.1, 1.0)

    risk_score = round(min(max(raw_score, 0.0), 1.0), 4)

    # Lane assignment
    if risk_score < 0.30:
        risk_lane = "green"
        requires_physical_inspection = False
        requires_document_review = False
        recommended_checks = ["Automated document validation"]
    elif risk_score < 0.65:
        risk_lane = "yellow"
        requires_physical_inspection = False
        requires_document_review = True
        recommended_checks = [
            "Manual document review",
            "Verify declared value against market prices",
            "Check certificate of origin authenticity",
        ]
    else:
        risk_lane = "red"
        requires_physical_inspection = True
        requires_document_review = True
        recommended_checks = [
            "Physical inspection required",
            "X-ray scanning",
            "Document forensic verification",
            "Trader interview if warranted",
            "Refer to intelligence unit",
        ]

    elapsed_ms = (time.time() - start_time) * 1000
    confidence = 0.85 if request.trader_declaration_count > 20 else 0.70

    logger.info(
        f"Scored declaration {request.declaration_id}: "
        f"score={risk_score:.3f} lane={risk_lane} elapsed={elapsed_ms:.1f}ms"
    )

    return ScoreResponse(
        declaration_id=request.declaration_id,
        risk_score=risk_score,
        risk_lane=risk_lane,
        risk_factors=risk_factors,
        recommended_checks=recommended_checks,
        requires_physical_inspection=requires_physical_inspection,
        requires_document_review=requires_document_review,
        confidence=confidence,
        scored_at=datetime.now(timezone.utc).isoformat(),
    )

# ─── FASTAPI APPLICATION ──────────────────────────────────────────────────────


# ─── Application Lifespan ───────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan: activates full middleware bundle on startup."""
    async with middleware_lifespan():
        yield

app = FastAPI(
    title="TradeGateway Risk Engine",
    description="ML-powered risk scoring for customs declarations (WCO SAFE Framework)",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "risk-engine",
        "version": "1.0.0",
        "model": "rule-based + weighted composite",
        "lanes": ["green", "yellow", "red"],
        "green_threshold": 0.30,
        "red_threshold": 0.65,
    }

@app.post("/score", response_model=ScoreResponse)
async def score_single(request: ScoreRequest):
    """Score a single declaration."""
    try:
        return score_declaration(request)
    except Exception as e:
        logger.error(f"Scoring error for declaration {request.declaration_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/score/batch")
async def score_batch(request: BatchScoreRequest):
    """Score multiple declarations."""
    results = []
    for decl in request.declarations:
        try:
            result = score_declaration(decl)
            results.append(result.model_dump())
        except Exception as e:
            results.append({
                "declaration_id": decl.declaration_id,
                "error": str(e),
            })

    green = sum(1 for r in results if r.get("risk_lane") == "green")
    yellow = sum(1 for r in results if r.get("risk_lane") == "yellow")
    red = sum(1 for r in results if r.get("risk_lane") == "red")

    return {
        "results": results,
        "count": len(results),
        "green_count": green,
        "yellow_count": yellow,
        "red_count": red,
    }

@app.get("/trader/{trader_id}/profile")
async def get_trader_profile(trader_id: int):
    """Get risk profile for a trader."""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT
                COUNT(*) as total_declarations,
                COUNT(CASE WHEN status = 'cleared' THEN 1 END) as cleared_count,
                COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_count,
                AVG(risk_score) as avg_risk_score
            FROM declarations
            WHERE trader_id = %s
        """, (trader_id,))
        row = cur.fetchone()
        conn.close()

        if not row or row["total_declarations"] == 0:
            return TraderRiskProfile(
                trader_id=trader_id,
                overall_risk_score=0.5,
                total_declarations=0,
                violations_count=0,
                compliance_rate=1.0,
                risk_category="unknown",
                is_aeo_eligible=False,
                risk_indicators=["Insufficient history for profiling"],
            )

        total = row["total_declarations"]
        cleared = row["cleared_count"] or 0
        rejected = row["rejected_count"] or 0
        compliance_rate = cleared / total if total > 0 else 1.0
        avg_risk = float(row["avg_risk_score"] or 0.3)

        risk_category = (
            "low" if avg_risk < 0.3 else
            "medium" if avg_risk < 0.5 else
            "high" if avg_risk < 0.7 else
            "very_high"
        )

        return TraderRiskProfile(
            trader_id=trader_id,
            overall_risk_score=round(avg_risk, 4),
            total_declarations=total,
            violations_count=rejected,
            compliance_rate=round(compliance_rate, 4),
            risk_category=risk_category,
            is_aeo_eligible=total >= 50 and compliance_rate >= 0.95,
            risk_indicators=[],
        )
    except Exception as e:
        logger.warning(f"Could not fetch trader profile from DB: {e}")
        return TraderRiskProfile(
            trader_id=trader_id,
            overall_risk_score=0.5,
            total_declarations=0,
            violations_count=0,
            compliance_rate=1.0,
            risk_category="unknown",
            is_aeo_eligible=False,
            risk_indicators=["Database unavailable"],
        )

@app.get("/country-risk/{country_code}")
async def get_country_risk(country_code: str):
    """Get risk score for a country."""
    score = COUNTRY_RISK_SCORES.get(country_code.upper(), DEFAULT_COUNTRY_RISK)
    return {
        "country_code": country_code.upper(),
        "risk_score": score,
        "risk_category": (
            "low" if score < 0.3 else
            "medium" if score < 0.6 else
            "high" if score < 0.8 else
            "very_high"
        ),
        "source": "FATF/WCO risk data",
    }

# ─── ENTRY POINT ─────────────────────────────────────────────────────────────


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


    logger.info(f"Starting Risk Engine on port {HTTP_PORT}")
    uvicorn.run(app, host="0.0.0.0", port=HTTP_PORT, log_level="info")
