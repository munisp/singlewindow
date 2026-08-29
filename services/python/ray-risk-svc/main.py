"""
TradeGateway NGSWTP — Declaration Risk Scoring Service
Port: 8106

Scoring is performed by a deterministic, transparent rule engine (HS chapter
risk, origin risk, transshipment risk, trader history, value anomaly, AEO).
The rules are the first line of defence and always run.

Model registry: this service is a THIN, HONEST client of a real MLflow
registry (env MLFLOW_TRACKING_URI). It keeps no model data of its own:
  * MLFLOW_TRACKING_URI unset / registry unreachable / mlflow not installed
    -> registry endpoints return 503 {"status": "REGISTRY_UNAVAILABLE"}.
    Fake registry entries are never served. A previous version hard-coded a
    MODEL_REGISTRY list with invented accuracy figures; it was removed.

A/B testing: deterministic, hash-based traffic split on entity ID between
two env-configured model versions (AB_CHAMPION_MODEL / AB_CHALLENGER_MODEL,
format "name:version" or "name/version", AB_TRAFFIC_SPLIT_PCT percent to the
champion). Both versions' REAL metrics are surfaced live from MLflow. No
invented request counts or win rates.

Environment:
  PORT                   — listen port (default 8106)
  MLFLOW_TRACKING_URI    — MLflow tracking server URI (e.g. http://mlflow:5000)
  MLFLOW_REGISTRY_TTL_S  — registry read cache TTL seconds (default 30)
  AB_CHAMPION_MODEL      — "name:version" serving the champion slice
  AB_CHALLENGER_MODEL    — "name:version" serving the challenger slice
  AB_TRAFFIC_SPLIT_PCT   — percent of entities hashed to champion (default 50)
"""

from __future__ import annotations
from contextlib import asynccontextmanager

import hashlib
import json
import math
import os
import time
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

# ─── Real MLflow registry client (fail-closed) ────────────────────────────────

MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "").strip() or None
MLFLOW_REGISTRY_TTL_S = int(os.getenv("MLFLOW_REGISTRY_TTL_S", "30"))

AB_CHAMPION_MODEL = os.getenv("AB_CHAMPION_MODEL", "").strip() or None
AB_CHALLENGER_MODEL = os.getenv("AB_CHALLENGER_MODEL", "").strip() or None
AB_TRAFFIC_SPLIT_PCT = int(os.getenv("AB_TRAFFIC_SPLIT_PCT", "50"))

_mlflow_client = None
_mlflow_client_error: Optional[str] = None
_registry_cache: dict[str, tuple[float, Any]] = {}


def get_mlflow_client():
    """
    Lazily build a real MLflow client. Returns None (and records the reason)
    when the registry is unconfigured or mlflow is unavailable. Never fakes
    a registry.
    """
    global _mlflow_client, _mlflow_client_error
    if _mlflow_client is not None:
        return _mlflow_client
    if not MLFLOW_TRACKING_URI:
        _mlflow_client_error = "MLFLOW_TRACKING_URI not set"
        return None
    try:
        from mlflow.tracking import MlflowClient
        _mlflow_client = MlflowClient(tracking_uri=MLFLOW_TRACKING_URI)
        # Cheap liveness check: list registered models (may be empty).
        _mlflow_client.search_registered_models(max_results=1)
        _mlflow_client_error = None
        return _mlflow_client
    except Exception as exc:
        _mlflow_client_error = f"{type(exc).__name__}: {exc}"
        _mlflow_client = None
        return None


def registry_unavailable(detail: Optional[str] = None) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "status": "REGISTRY_UNAVAILABLE",
            "message": "No real MLflow model registry is reachable. This service "
                       "never fabricates registry entries.",
            "reason": detail or _mlflow_client_error or "unknown",
        },
    )


def _cached(key: str, producer):
    """Small TTL cache so live registry reads don't hammer MLflow."""
    now = time.time()
    hit = _registry_cache.get(key)
    if hit and now - hit[0] < MLFLOW_REGISTRY_TTL_S:
        return hit[1]
    value = producer()
    _registry_cache[key] = (now, value)
    return value


def _parse_model_ref(ref: str) -> tuple[str, str]:
    """Parse 'name:version' or 'name/version' into (name, version)."""
    if ":" in ref:
        name, _, version = ref.partition(":")
    elif "/" in ref:
        name, _, version = ref.partition("/")
    else:
        raise ValueError(f"Invalid model reference {ref!r}; expected 'name:version'")
    return name.strip(), version.strip()


def _version_to_dict(mv, run_metrics: Optional[dict] = None) -> dict:
    """Convert a real MLflow ModelVersion to a plain dict with REAL data only."""
    return {
        "name": mv.name,
        "version": str(mv.version),
        "status": mv.status,
        "current_stage": getattr(mv, "current_stage", None),
        "aliases": sorted(getattr(mv, "aliases", []) or []),
        "description": getattr(mv, "description", None),
        "run_id": getattr(mv, "run_id", None),
        "source": getattr(mv, "source", None),
        "creation_timestamp": getattr(mv, "creation_timestamp", None),
        "last_updated_timestamp": getattr(mv, "last_updated_timestamp", None),
        "tags": dict(getattr(mv, "tags", {}) or {}),
        # Real run metrics from MLflow, or None — never invented.
        "metrics": run_metrics,
    }


def _run_metrics_for_version(client, mv) -> Optional[dict]:
    """Fetch the REAL metrics of the MLflow run that produced this version."""
    run_id = getattr(mv, "run_id", None)
    if not run_id:
        return None
    try:
        run = client.get_run(run_id)
        return dict(run.data.metrics) or None
    except Exception:
        return None


def list_registry_models() -> list[dict]:
    client = get_mlflow_client()
    if client is None:
        raise registry_unavailable()
    try:
        def _produce():
            out = []
            for rm in client.search_registered_models():
                for mv in client.search_model_versions(f"name='{rm.name}'"):
                    out.append(_version_to_dict(mv, _run_metrics_for_version(client, mv)))
            return out
        return _cached("models", _produce)
    except HTTPException:
        raise
    except Exception as exc:
        raise registry_unavailable(str(exc))


def get_registry_model(ref: str) -> dict:
    client = get_mlflow_client()
    if client is None:
        raise registry_unavailable()
    try:
        name, version = _parse_model_ref(ref)
        mv = client.get_model_version(name, version)
        return _version_to_dict(mv, _run_metrics_for_version(client, mv))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=404,
            detail={"status": "MODEL_NOT_FOUND", "reference": ref,
                    "reason": f"{type(exc).__name__}: {exc}"},
        )


# ─── Deterministic A/B assignment ─────────────────────────────────────────────

def ab_configured() -> bool:
    return bool(AB_CHAMPION_MODEL and AB_CHALLENGER_MODEL)


def assign_ab_bucket(entity_id: str) -> dict:
    """
    Deterministic hash-based split on entity ID. The same entity always lands
    in the same bucket; no randomness, no state, reproducible across replicas.
    """
    digest = hashlib.sha256(entity_id.encode("utf-8")).hexdigest()
    bucket = int(digest[:8], 16) % 100
    variant = "champion" if bucket < AB_TRAFFIC_SPLIT_PCT else "challenger"
    model_ref = AB_CHAMPION_MODEL if variant == "champion" else AB_CHALLENGER_MODEL
    return {"bucket": bucket, "variant": variant, "model": model_ref}


def describe_ab_test() -> dict:
    """
    Describe the env-configured deterministic A/B split and surface BOTH
    versions' real metrics from MLflow. No fabricated request counts.
    """
    if not ab_configured():
        return {
            "status": "AB_NOT_CONFIGURED",
            "message": "Set AB_CHAMPION_MODEL and AB_CHALLENGER_MODEL "
                       "('name:version') to enable the deterministic A/B split.",
        }
    champion = get_registry_model(AB_CHAMPION_MODEL)      # 503/404 propagate
    challenger = get_registry_model(AB_CHALLENGER_MODEL)
    return {
        "status": "RUNNING",
        "assignment": "deterministic sha256(entity_id) bucket split",
        "traffic_split_pct": {"champion": AB_TRAFFIC_SPLIT_PCT,
                              "challenger": 100 - AB_TRAFFIC_SPLIT_PCT},
        "champion": {"reference": AB_CHAMPION_MODEL, **champion},
        "challenger": {"reference": AB_CHALLENGER_MODEL, **challenger},
    }

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
    return {
        "status": "ok",
        "service": "ray-risk-svc",
        "scoring_layer": "deterministic-rules",
        "registry": "configured" if MLFLOW_TRACKING_URI else "unconfigured",
        "ab_configured": ab_configured(),
    }


@app.post("/score")
def score_declaration(d: DeclarationInput):
    features = extract_features(d)
    score = compute_risk_score(features)
    lane = assign_lane(score)
    importances = feature_importances(features)
    response = {
        "declaration_id": d.declaration_id,
        "risk_score": score,
        "lane": lane,
        # Honest identity: the score above comes from the deterministic rules.
        "model_version": "rules-only-2.0.0",
        "feature_importances": importances,
        "scored_at": datetime.now(timezone.utc).isoformat(),
    }
    # Deterministic A/B assignment: which registered model version WOULD serve
    # this entity once the ML layer is promoted into the scoring path.
    if ab_configured():
        response["ab_assignment"] = assign_ab_bucket(d.declaration_id)
    return response


@app.post("/score/batch")
def score_batch(declarations: list[DeclarationInput]):
    return [score_declaration(d) for d in declarations]


@app.get("/models")
def list_models():
    """List REAL model versions from the MLflow registry (503 if unavailable)."""
    return list_registry_models()


@app.get("/models/metrics/history")
def metrics_history():
    """REAL metrics history: every registered version with its MLflow run metrics."""
    models = list_registry_models()
    return [
        {
            "name": m["name"],
            "version": m["version"],
            "aliases": m["aliases"],
            "metrics": m["metrics"],
            "creation_timestamp": m["creation_timestamp"],
        }
        for m in models
    ]


@app.get("/models/{model_ref:path}")
def get_model(model_ref: str):
    """Fetch one REAL model version, referenced as 'name:version' or 'name/version'."""
    return get_registry_model(model_ref)


@app.post("/models/{model_ref:path}/promote")
def promote_model(model_ref: str):
    """
    Promote a model version by setting the REAL MLflow 'champion' alias on it.
    Fails closed (503) when no registry is reachable.
    """
    client = get_mlflow_client()
    if client is None:
        raise registry_unavailable()
    try:
        name, version = _parse_model_ref(model_ref)
        client.set_registered_model_alias(name, "champion", version)
        _registry_cache.clear()
        return {
            "message": f"Model {name}:{version} promoted to champion in MLflow",
            "model": get_registry_model(model_ref),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=404,
            detail={"status": "MODEL_NOT_FOUND", "reference": model_ref,
                    "reason": f"{type(exc).__name__}: {exc}"},
        )


@app.get("/ab-tests")
def list_ab_tests():
    """
    The single env-configured deterministic A/B split, with BOTH versions'
    real metrics from MLflow. 503 when the registry is unavailable;
    AB_NOT_CONFIGURED when the split is not env-configured.
    """
    return describe_ab_test()


@app.post("/ab-tests")
def create_ab_test():
    """
    A/B tests are configuration, not runtime state: they are defined via
    AB_CHAMPION_MODEL / AB_CHALLENGER_MODEL / AB_TRAFFIC_SPLIT_PCT environment
    variables so the split is identical across replicas. This endpoint cannot
    invent an ad-hoc test.
    """
    raise HTTPException(
        status_code=409,
        detail={
            "status": "AB_ENV_CONFIGURED",
            "message": "A/B tests are configured via environment variables "
                       "(AB_CHAMPION_MODEL, AB_CHALLENGER_MODEL, "
                       "AB_TRAFFIC_SPLIT_PCT) and cannot be created ad-hoc.",
        },
    )



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
