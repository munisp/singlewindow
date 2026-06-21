"""
main.py — FastAPI service for insider threat detection and model retraining.

Endpoints:
  GET  /health                  — liveness probe
  POST /detect                  — score a single user action event
  POST /train                   — retrain IsolationForest on labelled events
  GET  /model/info              — current model metadata
  GET  /model/versions          — list all stored model versions
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from anomaly_detector import score_event, train_model
from model_store import (
    load_current_model,
    load_metadata,
    list_versions,
    save_model,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# ─── Global model state ───────────────────────────────────────────────────────
_model = None
_scaler = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the current model on startup."""
    global _model, _scaler
    import joblib
    from pathlib import Path
    from model_store import CURRENT_LINK, MODELS_DIR

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    if CURRENT_LINK.exists():
        try:
            bundle = joblib.load(CURRENT_LINK)
            if isinstance(bundle, dict):
                _model = bundle.get("model")
                _scaler = bundle.get("scaler")
            else:
                _model = bundle
                _scaler = None
            logger.info("Loaded model from %s", CURRENT_LINK)
        except Exception as exc:
            logger.warning("Could not load model on startup: %s", exc)
    else:
        logger.info("No pre-trained model found — /detect will use heuristics until /train is called")
    yield


app = FastAPI(
    title="TradeGateway Insider Threat Service",
    version="1.0.0",
    description="ML-based behavioural anomaly detection for insider threat prevention",
    lifespan=lifespan,
)


# ─── Schemas ──────────────────────────────────────────────────────────────────

class DetectRequest(BaseModel):
    user_id: str
    session_id: str
    role: str = "trader"
    action: str
    hour_of_day: int = Field(ge=0, le=23)
    action_count_per_hour: int = Field(ge=0, default=1)
    unique_records_accessed: int = Field(ge=0, default=1)


class DetectResponse(BaseModel):
    user_id: str
    session_id: str
    anomaly_score: float = Field(description="0.0 = normal, 1.0 = highly anomalous")
    blocked: bool
    threshold: float
    model_version: Optional[int]
    scored_at: str


class LabelledEvent(BaseModel):
    hour_of_day: int = Field(ge=0, le=23)
    action_count_per_hour: int = Field(ge=0, default=1)
    unique_records_accessed: int = Field(ge=0, default=1)
    role: str = "trader"
    action: str = "general"
    is_anomaly: Optional[bool] = None  # label (used for future supervised learning)


class TrainRequest(BaseModel):
    events: list[LabelledEvent] = Field(min_length=10)
    contamination: float = Field(default=0.05, ge=0.01, le=0.5)
    n_estimators: int = Field(default=100, ge=10, le=500)


class TrainResponse(BaseModel):
    version: int
    n_samples: int
    contamination: float
    metrics: dict
    trained_at: str


# ─── Routes ───────────────────────────────────────────────────────────────────

BLOCK_THRESHOLD = float(os.getenv("ANOMALY_BLOCK_THRESHOLD", "0.85"))


@app.get("/health")
def health():
    meta = load_metadata()
    return {
        "status": "ok",
        "service": "insider-threat-svc",
        "version": "1.0.0",
        "model_loaded": _model is not None,
        "model_version": meta.get("version") if meta else None,
    }


@app.post("/detect", response_model=DetectResponse)
def detect(req: DetectRequest):
    """Score a single user action event."""
    global _model, _scaler

    meta = load_metadata()
    model_version = meta.get("version") if meta else None

    if _model is None:
        # Heuristic fallback: off-hours + high action count = elevated score
        off_hours = 1.0 if req.hour_of_day < 7 or req.hour_of_day > 20 else 0.0
        rate_factor = min(req.action_count_per_hour / 50.0, 1.0)
        anomaly_score = round(0.3 * off_hours + 0.4 * rate_factor, 4)
    else:
        anomaly_score = score_event(
            _model, _scaler,
            req.hour_of_day,
            req.action_count_per_hour,
            req.unique_records_accessed,
            req.role,
            req.action,
        )

    blocked = anomaly_score >= BLOCK_THRESHOLD

    return DetectResponse(
        user_id=req.user_id,
        session_id=req.session_id,
        anomaly_score=anomaly_score,
        blocked=blocked,
        threshold=BLOCK_THRESHOLD,
        model_version=model_version,
        scored_at=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/train", response_model=TrainResponse)
def train(req: TrainRequest):
    """
    Retrain the IsolationForest model on the provided labelled events.
    Persists the new model and updates the current model in memory.
    """
    global _model, _scaler
    import joblib

    events_dicts = [e.model_dump() for e in req.events]

    try:
        model, scaler, metrics = train_model(
            events_dicts,
            contamination=req.contamination,
            n_estimators=req.n_estimators,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # Save bundle (model + scaler together)
    import joblib as jl
    from model_store import MODELS_DIR, CURRENT_LINK, METADATA_FILE, _ensure_dir, load_metadata
    import json, shutil
    from pathlib import Path

    _ensure_dir()
    meta = load_metadata()
    version = (meta.get("version", 0) if meta else 0) + 1

    bundle = {"model": model, "scaler": scaler}
    versioned = MODELS_DIR / f"isolation_forest_v{version}.joblib"
    jl.dump(bundle, versioned)

    tmp = MODELS_DIR / "_current_tmp.joblib"
    if tmp.exists():
        tmp.unlink()
    shutil.copy2(versioned, tmp)
    tmp.rename(CURRENT_LINK)

    trained_at = datetime.now(timezone.utc).isoformat()
    metadata = {
        "version": version,
        "trained_at": trained_at,
        "n_samples": len(req.events),
        "contamination": req.contamination,
        **metrics,
    }
    METADATA_FILE.write_text(json.dumps(metadata, indent=2))

    # Update in-memory model
    _model = model
    _scaler = scaler

    logger.info("Model retrained: v%d on %d samples", version, len(req.events))

    return TrainResponse(
        version=version,
        n_samples=len(req.events),
        contamination=req.contamination,
        metrics=metrics,
        trained_at=trained_at,
    )


@app.get("/model/info")
def model_info():
    """Return current model metadata."""
    meta = load_metadata()
    if not meta:
        return {"model_loaded": False, "message": "No model trained yet"}
    return {"model_loaded": _model is not None, **meta}


@app.get("/model/versions")
def model_versions():
    """List all stored model versions."""
    return {"versions": list_versions()}
