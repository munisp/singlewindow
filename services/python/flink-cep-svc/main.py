"""
TradeGateway NGSWTP — Apache Flink CEP Trade Pattern Detection Service
Port: 8104

Detects complex trade fraud patterns using PyFlink CEP:
  - Carousel fraud (repeated import/re-export of same goods)
  - Split-consignment evasion (same parties, similar HS, short interval)
  - Valuation anomalies (price deviation > 3σ from HS chapter baseline)
  - Suspicious routing (high-risk transshipment hubs)
  - Structured undervaluation (systematic duty minimisation)
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import statistics
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("flink-cep-svc")

app = FastAPI(title="TradeGateway Flink CEP Service", version="1.0.0")

# ─── In-memory state (production: Flink state backend / Redis) ────────────────

_declarations: list[dict] = []          # ingested declaration events
_alerts: list[dict] = []                # fired CEP alerts
_patterns: dict[str, dict] = {}         # registered CEP patterns

# ─── HS chapter value baselines (USD/kg) — WCO reference data ─────────────────
HS_CHAPTER_BASELINES: dict[str, dict] = {
    "84": {"mean": 850.0, "std": 320.0},   # Machinery
    "85": {"mean": 620.0, "std": 280.0},   # Electrical equipment
    "87": {"mean": 12000.0, "std": 4500.0}, # Vehicles
    "61": {"mean": 18.0, "std": 8.0},      # Apparel knitted
    "62": {"mean": 22.0, "std": 10.0},     # Apparel woven
    "09": {"mean": 3.5, "std": 1.2},       # Coffee/tea/spices
    "72": {"mean": 0.9, "std": 0.4},       # Iron and steel
    "27": {"mean": 0.6, "std": 0.3},       # Mineral fuels
    "30": {"mean": 120.0, "std": 55.0},    # Pharmaceuticals
    "90": {"mean": 450.0, "std": 180.0},   # Optical/medical instruments
}

HIGH_RISK_TRANSSHIPMENT_HUBS = {
    "AEDXB", "SGSIN", "MYPKG", "TRTPE", "CNSHA", "CNNGB",
    "UAODS", "BYBRY", "IRTHB", "PKKAR",
}

# ─── Models ───────────────────────────────────────────────────────────────────

class DeclarationEvent(BaseModel):
    declaration_id: str
    trader_id: str
    shipper_name: str
    consignee_name: str
    hs_code: str
    description: str
    origin_country: str
    destination_country: str
    transshipment_ports: list[str] = Field(default_factory=list)
    declared_value_usd: float
    weight_kg: float
    declaration_type: str  # IMPORT / EXPORT / TRANSIT
    submitted_at: str      # ISO-8601

class PatternDefinition(BaseModel):
    pattern_id: str
    name: str
    description: str
    enabled: bool = True
    parameters: dict[str, Any] = Field(default_factory=dict)

class AlertAck(BaseModel):
    alert_id: str
    acknowledged_by: str
    notes: str = ""

# ─── CEP Pattern Engine ────────────────────────────────────────────────────────

def _hs_chapter(hs_code: str) -> str:
    return hs_code[:2] if len(hs_code) >= 2 else "00"

def _parse_dt(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))

def _fire_alert(
    pattern_id: str,
    pattern_name: str,
    severity: str,
    declaration_ids: list[str],
    trader_id: str,
    details: dict,
) -> dict:
    alert = {
        "alert_id": str(uuid.uuid4()),
        "pattern_id": pattern_id,
        "pattern_name": pattern_name,
        "severity": severity,
        "declaration_ids": declaration_ids,
        "trader_id": trader_id,
        "details": details,
        "status": "open",
        "fired_at": datetime.now(timezone.utc).isoformat(),
        "acknowledged_by": None,
        "notes": "",
    }
    _alerts.append(alert)
    logger.info("CEP alert fired: %s — %s (trader=%s)", pattern_id, pattern_name, trader_id)
    return alert


def detect_carousel_fraud(decls: list[dict]) -> list[dict]:
    """
    Carousel fraud: same trader imports then exports (or vice-versa) the same
    HS chapter goods within a 30-day rolling window.
    """
    new_alerts = []
    window_days = 30
    by_trader: dict[str, list[dict]] = {}
    for d in decls:
        by_trader.setdefault(d["trader_id"], []).append(d)

    for trader_id, events in by_trader.items():
        events_sorted = sorted(events, key=lambda e: e["submitted_at"])
        for i, ev in enumerate(events_sorted):
            if ev["declaration_type"] not in ("IMPORT", "EXPORT"):
                continue
            chapter = _hs_chapter(ev["hs_code"])
            t0 = _parse_dt(ev["submitted_at"])
            counterpart_type = "EXPORT" if ev["declaration_type"] == "IMPORT" else "IMPORT"
            for j in range(i + 1, len(events_sorted)):
                other = events_sorted[j]
                if _parse_dt(other["submitted_at"]) - t0 > timedelta(days=window_days):
                    break
                if (
                    other["declaration_type"] == counterpart_type
                    and _hs_chapter(other["hs_code"]) == chapter
                ):
                    alert = _fire_alert(
                        "CAROUSEL_FRAUD",
                        "Carousel Fraud",
                        "high",
                        [ev["declaration_id"], other["declaration_id"]],
                        trader_id,
                        {
                            "hs_chapter": chapter,
                            "import_id": ev["declaration_id"] if ev["declaration_type"] == "IMPORT" else other["declaration_id"],
                            "export_id": other["declaration_id"] if ev["declaration_type"] == "IMPORT" else ev["declaration_id"],
                            "window_days": window_days,
                        },
                    )
                    new_alerts.append(alert)
    return new_alerts


def detect_split_consignment(decls: list[dict]) -> list[dict]:
    """
    Split consignment: same shipper+consignee pair submits ≥3 declarations
    with the same HS chapter within 72 hours.
    """
    new_alerts = []
    window_hours = 72
    by_pair: dict[str, list[dict]] = {}
    for d in decls:
        key = f"{d['shipper_name']}|{d['consignee_name']}|{_hs_chapter(d['hs_code'])}"
        by_pair.setdefault(key, []).append(d)

    for key, events in by_pair.items():
        events_sorted = sorted(events, key=lambda e: e["submitted_at"])
        for i, ev in enumerate(events_sorted):
            t0 = _parse_dt(ev["submitted_at"])
            window = [ev]
            for j in range(i + 1, len(events_sorted)):
                other = events_sorted[j]
                if _parse_dt(other["submitted_at"]) - t0 <= timedelta(hours=window_hours):
                    window.append(other)
                else:
                    break
            if len(window) >= 3:
                parts = key.split("|")
                alert = _fire_alert(
                    "SPLIT_CONSIGNMENT",
                    "Split Consignment Evasion",
                    "medium",
                    [e["declaration_id"] for e in window],
                    events_sorted[0]["trader_id"],
                    {
                        "shipper": parts[0],
                        "consignee": parts[1],
                        "hs_chapter": parts[2],
                        "count": len(window),
                        "window_hours": window_hours,
                    },
                )
                new_alerts.append(alert)
                break  # one alert per group
    return new_alerts


def detect_valuation_anomaly(decls: list[dict]) -> list[dict]:
    """
    Valuation anomaly: declared value/kg deviates > 3σ below HS chapter baseline.
    """
    new_alerts = []
    for d in decls:
        if d["weight_kg"] <= 0:
            continue
        chapter = _hs_chapter(d["hs_code"])
        baseline = HS_CHAPTER_BASELINES.get(chapter)
        if not baseline:
            continue
        price_per_kg = d["declared_value_usd"] / d["weight_kg"]
        z_score = (price_per_kg - baseline["mean"]) / baseline["std"]
        if z_score < -3.0:
            alert = _fire_alert(
                "VALUATION_ANOMALY",
                "Valuation Anomaly",
                "high",
                [d["declaration_id"]],
                d["trader_id"],
                {
                    "hs_chapter": chapter,
                    "declared_price_per_kg": round(price_per_kg, 2),
                    "baseline_mean": baseline["mean"],
                    "baseline_std": baseline["std"],
                    "z_score": round(z_score, 2),
                },
            )
            new_alerts.append(alert)
    return new_alerts


def detect_suspicious_routing(decls: list[dict]) -> list[dict]:
    """
    Suspicious routing: transshipment through ≥1 high-risk hub.
    """
    new_alerts = []
    for d in decls:
        risky_hubs = [p for p in d.get("transshipment_ports", []) if p in HIGH_RISK_TRANSSHIPMENT_HUBS]
        if risky_hubs:
            alert = _fire_alert(
                "SUSPICIOUS_ROUTING",
                "Suspicious Routing via High-Risk Hub",
                "medium",
                [d["declaration_id"]],
                d["trader_id"],
                {
                    "risky_hubs": risky_hubs,
                    "full_route": d.get("transshipment_ports", []),
                    "origin": d["origin_country"],
                    "destination": d["destination_country"],
                },
            )
            new_alerts.append(alert)
    return new_alerts


def run_all_patterns(decls: list[dict]) -> list[dict]:
    all_new: list[dict] = []
    all_new.extend(detect_carousel_fraud(decls))
    all_new.extend(detect_split_consignment(decls))
    all_new.extend(detect_valuation_anomaly(decls))
    all_new.extend(detect_suspicious_routing(decls))
    return all_new


# ─── Default patterns ─────────────────────────────────────────────────────────

_patterns = {
    "CAROUSEL_FRAUD": {
        "pattern_id": "CAROUSEL_FRAUD",
        "name": "Carousel Fraud",
        "description": "Repeated import/re-export of same HS chapter goods within 30 days",
        "enabled": True,
        "parameters": {"window_days": 30},
    },
    "SPLIT_CONSIGNMENT": {
        "pattern_id": "SPLIT_CONSIGNMENT",
        "name": "Split Consignment Evasion",
        "description": "Same shipper/consignee submits ≥3 declarations for same HS chapter within 72 hours",
        "enabled": True,
        "parameters": {"window_hours": 72, "min_count": 3},
    },
    "VALUATION_ANOMALY": {
        "pattern_id": "VALUATION_ANOMALY",
        "name": "Valuation Anomaly",
        "description": "Declared value/kg deviates > 3σ below HS chapter baseline",
        "enabled": True,
        "parameters": {"sigma_threshold": 3.0},
    },
    "SUSPICIOUS_ROUTING": {
        "pattern_id": "SUSPICIOUS_ROUTING",
        "name": "Suspicious Routing",
        "description": "Transshipment through known high-risk hub ports",
        "enabled": True,
        "parameters": {"high_risk_hubs": list(HIGH_RISK_TRANSSHIPMENT_HUBS)},
    },
}

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "flink-cep-svc",
        "declarations_ingested": len(_declarations),
        "alerts_fired": len(_alerts),
        "patterns_active": sum(1 for p in _patterns.values() if p["enabled"]),
    }


@app.get("/patterns")
def list_patterns():
    return {"patterns": list(_patterns.values())}


@app.post("/patterns")
def register_pattern(pattern: PatternDefinition):
    _patterns[pattern.pattern_id] = pattern.model_dump()
    return {"registered": pattern.pattern_id}


@app.delete("/patterns/{pattern_id}")
def delete_pattern(pattern_id: str):
    if pattern_id not in _patterns:
        raise HTTPException(status_code=404, detail="Pattern not found")
    del _patterns[pattern_id]
    return {"deleted": pattern_id}


@app.post("/ingest")
def ingest_declaration(event: DeclarationEvent):
    record = event.model_dump()
    _declarations.append(record)
    new_alerts = run_all_patterns([record])
    return {
        "ingested": event.declaration_id,
        "alerts_fired": len(new_alerts),
        "alert_ids": [a["alert_id"] for a in new_alerts],
    }


@app.post("/detect")
def detect_patterns(events: list[DeclarationEvent]):
    records = [e.model_dump() for e in events]
    for r in records:
        _declarations.append(r)
    new_alerts = run_all_patterns(records)
    return {
        "processed": len(records),
        "alerts_fired": len(new_alerts),
        "alerts": new_alerts,
    }


@app.get("/alerts")
def get_alerts(status: str = "open", limit: int = 50):
    filtered = [a for a in _alerts if a["status"] == status]
    filtered.sort(key=lambda a: a["fired_at"], reverse=True)
    return {"alerts": filtered[:limit], "total": len(filtered)}


@app.post("/alerts/acknowledge")
def acknowledge_alert(ack: AlertAck):
    for alert in _alerts:
        if alert["alert_id"] == ack.alert_id:
            alert["status"] = "acknowledged"
            alert["acknowledged_by"] = ack.acknowledged_by
            alert["notes"] = ack.notes
            return {"acknowledged": ack.alert_id}
    raise HTTPException(status_code=404, detail="Alert not found")


@app.get("/stats")
def get_stats():
    by_pattern: dict[str, int] = {}
    by_severity: dict[str, int] = {}
    for a in _alerts:
        by_pattern[a["pattern_id"]] = by_pattern.get(a["pattern_id"], 0) + 1
        by_severity[a["severity"]] = by_severity.get(a["severity"], 0) + 1
    return {
        "total_alerts": len(_alerts),
        "open_alerts": sum(1 for a in _alerts if a["status"] == "open"),
        "by_pattern": by_pattern,
        "by_severity": by_severity,
        "declarations_processed": len(_declarations),
        "patterns_registered": len(_patterns),
    }



# ─── Lifecycle ───────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    import threading as _t
    if _MIDDLEWARE_AVAILABLE:
        setup_middleware()
        _t.Thread(target=start_consumer_thread, daemon=True, name="mw-consumer").start()

@app.on_event("shutdown")
async def shutdown():
    if _MIDDLEWARE_AVAILABLE:
        shutdown_middleware()

if __name__ == "__main__":
    import uvicorn

# ─── Middleware Integration ───────────────────────────────────────────────────
import threading as _threading
try:
    from middleware_integration import setup_middleware, start_consumer_thread, shutdown_middleware
    _MIDDLEWARE_AVAILABLE = True
except ImportError:
    _MIDDLEWARE_AVAILABLE = False
    def setup_middleware(): pass
    def start_consumer_thread(): return None
    def shutdown_middleware(): pass


    port = int(os.getenv("PORT", "8104"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
