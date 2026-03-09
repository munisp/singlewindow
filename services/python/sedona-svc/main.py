"""
sedona-svc — Apache Sedona Geospatial Analytics Service
Port: 8102

Provides vessel AIS tracking, route anomaly detection, geofencing alerts,
and spatial queries for the TradeGateway™ NGSWTP Customs Dashboard.

In production this service uses Apache Sedona (PySpark) for distributed
spatial queries. In this implementation we use shapely + geopy for
geometry operations and simulate the Sedona spatial engine interface.
"""

from __future__ import annotations

import math
import random
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="sedona-svc", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Constants ────────────────────────────────────────────────────────────────

KNOTS_TO_KMH = 1.852

# Major shipping lanes as bounding boxes [min_lon, min_lat, max_lon, max_lat]
SHIPPING_LANES = {
    "malacca_strait": [98.0, 1.0, 104.5, 6.5],
    "gulf_of_guinea": [-5.0, -5.0, 8.0, 5.0],
    "red_sea": [32.0, 12.0, 44.0, 28.0],
    "indian_ocean_east": [70.0, -10.0, 100.0, 25.0],
    "south_china_sea": [105.0, 0.0, 122.0, 22.0],
}

# Restricted zones (e.g. military, environmental, sanctions)
RESTRICTED_ZONES = [
    {"id": "rz-001", "name": "Exclusive Economic Zone Alpha", "min_lon": 102.0, "min_lat": 1.5, "max_lon": 103.5, "max_lat": 2.5},
    {"id": "rz-002", "name": "Marine Protected Area Beta",   "min_lon": 99.5,  "min_lat": 3.0, "max_lon": 101.0, "max_lat": 4.0},
    {"id": "rz-003", "name": "Naval Exercise Zone Gamma",    "min_lon": 106.0, "min_lat": 1.0, "max_lon": 107.5, "max_lat": 2.0},
]

# Seed vessel registry
VESSEL_REGISTRY: dict[str, dict] = {}
VESSEL_POSITIONS: dict[str, list[dict]] = {}  # MMSI -> list of AIS positions
GEOFENCE_ALERTS: list[dict] = []
ANOMALIES: list[dict] = []

def _seed_vessels() -> None:
    vessels = [
        {"mmsi": "477123456", "name": "PACIFIC TRADER",   "flag": "HK", "type": "CONTAINER", "imo": "9234567", "declared_route": ["SGSIN", "CNSHA"]},
        {"mmsi": "566789012", "name": "GULF STAR",         "flag": "SG", "type": "BULK",      "imo": "9345678", "declared_route": ["SGSIN", "INBOM"]},
        {"mmsi": "352456789", "name": "ATLANTIC BREEZE",   "flag": "PA", "type": "TANKER",    "imo": "9456789", "declared_route": ["NGAPP", "GBFXT"]},
        {"mmsi": "636012345", "name": "WEST AFRICA STAR",  "flag": "LR", "type": "RORO",      "imo": "9567890", "declared_route": ["GHTEM", "NLRTM"]},
        {"mmsi": "548234567", "name": "MEKONG PRIDE",      "flag": "VN", "type": "CONTAINER", "imo": "9678901", "declared_route": ["VNSGN", "JPOSA"]},
        {"mmsi": "440567890", "name": "KOREA EXPRESS",     "flag": "KR", "type": "CONTAINER", "imo": "9789012", "declared_route": ["KRPUS", "USLA"]},
        {"mmsi": "255801234", "name": "EUROPA LINK",       "flag": "PT", "type": "CONTAINER", "imo": "9890123", "declared_route": ["PTLIS", "BRBEL"]},
        {"mmsi": "620345678", "name": "NILE CARRIER",      "flag": "EG", "type": "BULK",      "imo": "9901234", "declared_route": ["EGPSD", "CNSHA"]},
    ]
    now = datetime.now(timezone.utc)
    for v in vessels:
        VESSEL_REGISTRY[v["mmsi"]] = v
        # Generate 24h of position history
        positions = []
        base_lon = random.uniform(98.0, 115.0)
        base_lat = random.uniform(0.5, 8.0)
        for i in range(48):  # every 30 min
            ts = now - timedelta(minutes=30 * (47 - i))
            lon = base_lon + (i * 0.05) + random.uniform(-0.02, 0.02)
            lat = base_lat + (i * 0.01) + random.uniform(-0.01, 0.01)
            speed = random.uniform(8.0, 18.0)
            heading = random.uniform(0, 360)
            positions.append({
                "mmsi": v["mmsi"],
                "timestamp": ts.isoformat(),
                "lon": round(lon, 6),
                "lat": round(lat, 6),
                "speed_knots": round(speed, 1),
                "heading": round(heading, 1),
                "nav_status": "UNDERWAY_ENGINE",
            })
        VESSEL_POSITIONS[v["mmsi"]] = positions

    # Inject one anomalous vessel: dark period + deviation
    anomalous_mmsi = "352456789"
    positions = VESSEL_POSITIONS[anomalous_mmsi]
    # Dark period: remove positions 20-30 (10h gap)
    VESSEL_POSITIONS[anomalous_mmsi] = positions[:20] + positions[30:]
    ANOMALIES.append({
        "id": str(uuid.uuid4()),
        "mmsi": anomalous_mmsi,
        "vessel_name": "ATLANTIC BREEZE",
        "anomaly_type": "DARK_VESSEL",
        "severity": "HIGH",
        "description": "Vessel AIS transponder disabled for ~5 hours in Gulf of Guinea",
        "detected_at": (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat(),
        "position_before": {"lon": positions[19]["lon"], "lat": positions[19]["lat"]},
        "position_after":  {"lon": positions[20]["lon"], "lat": positions[20]["lat"]},
        "gap_hours": 5.0,
    })

_seed_vessels()

# ─── Models ───────────────────────────────────────────────────────────────────

class AISPosition(BaseModel):
    mmsi: str
    timestamp: str
    lon: float
    lat: float
    speed_knots: float
    heading: float
    nav_status: str = "UNDERWAY_ENGINE"

class AISIngestRequest(BaseModel):
    positions: list[AISPosition]

class GeofenceCheckRequest(BaseModel):
    mmsi: str
    lon: float
    lat: float

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def _in_bbox(lon: float, lat: float, bbox: list[float]) -> bool:
    return bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]

def _detect_dark_periods(positions: list[dict]) -> list[dict]:
    """Detect gaps > 2 hours in AIS position stream."""
    anomalies = []
    sorted_pos = sorted(positions, key=lambda p: p["timestamp"])
    for i in range(1, len(sorted_pos)):
        t1 = datetime.fromisoformat(sorted_pos[i - 1]["timestamp"].replace("Z", "+00:00"))
        t2 = datetime.fromisoformat(sorted_pos[i]["timestamp"].replace("Z", "+00:00"))
        gap_hours = (t2 - t1).total_seconds() / 3600
        if gap_hours > 2.0:
            anomalies.append({
                "type": "DARK_VESSEL",
                "gap_hours": round(gap_hours, 2),
                "last_seen": sorted_pos[i - 1]["timestamp"],
                "reappeared": sorted_pos[i]["timestamp"],
                "position_before": {"lon": sorted_pos[i - 1]["lon"], "lat": sorted_pos[i - 1]["lat"]},
                "position_after":  {"lon": sorted_pos[i]["lon"],     "lat": sorted_pos[i]["lat"]},
            })
    return anomalies

def _detect_speed_anomalies(positions: list[dict]) -> list[dict]:
    """Detect implausible speed jumps between consecutive positions."""
    anomalies = []
    sorted_pos = sorted(positions, key=lambda p: p["timestamp"])
    for i in range(1, len(sorted_pos)):
        t1 = datetime.fromisoformat(sorted_pos[i - 1]["timestamp"].replace("Z", "+00:00"))
        t2 = datetime.fromisoformat(sorted_pos[i]["timestamp"].replace("Z", "+00:00"))
        dt_hours = max((t2 - t1).total_seconds() / 3600, 0.001)
        dist_km = _haversine_km(
            sorted_pos[i - 1]["lon"], sorted_pos[i - 1]["lat"],
            sorted_pos[i]["lon"],     sorted_pos[i]["lat"],
        )
        implied_speed_knots = (dist_km / KNOTS_TO_KMH) / dt_hours
        if implied_speed_knots > 35.0:  # no commercial vessel exceeds 35 knots
            anomalies.append({
                "type": "SPEED_ANOMALY",
                "implied_speed_knots": round(implied_speed_knots, 1),
                "from_position": {"lon": sorted_pos[i - 1]["lon"], "lat": sorted_pos[i - 1]["lat"]},
                "to_position":   {"lon": sorted_pos[i]["lon"],     "lat": sorted_pos[i]["lat"]},
                "timestamp": sorted_pos[i]["timestamp"],
            })
    return anomalies

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "sedona-svc", "vessels_tracked": len(VESSEL_REGISTRY)}

@app.get("/vessels")
def get_vessels() -> dict:
    result = []
    for mmsi, vessel in VESSEL_REGISTRY.items():
        positions = VESSEL_POSITIONS.get(mmsi, [])
        latest = positions[-1] if positions else None
        result.append({
            **vessel,
            "latest_position": latest,
            "position_count": len(positions),
        })
    return {"vessels": result, "total": len(result)}

@app.get("/vessels/{mmsi}/route")
def get_vessel_route(mmsi: str) -> dict:
    if mmsi not in VESSEL_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Vessel {mmsi} not found")
    positions = VESSEL_POSITIONS.get(mmsi, [])
    vessel = VESSEL_REGISTRY[mmsi]
    return {
        "mmsi": mmsi,
        "vessel_name": vessel["name"],
        "declared_route": vessel["declared_route"],
        "positions": sorted(positions, key=lambda p: p["timestamp"]),
        "total_positions": len(positions),
    }

@app.get("/anomalies")
def get_anomalies() -> dict:
    # Recompute from live position data
    all_anomalies = list(ANOMALIES)
    for mmsi, positions in VESSEL_POSITIONS.items():
        vessel = VESSEL_REGISTRY.get(mmsi, {})
        dark = _detect_dark_periods(positions)
        speed = _detect_speed_anomalies(positions)
        for a in dark + speed:
            all_anomalies.append({
                "id": str(uuid.uuid4()),
                "mmsi": mmsi,
                "vessel_name": vessel.get("name", mmsi),
                "anomaly_type": a["type"],
                "severity": "HIGH" if a.get("gap_hours", 0) > 4 or a.get("implied_speed_knots", 0) > 50 else "MEDIUM",
                "detected_at": datetime.now(timezone.utc).isoformat(),
                **a,
            })
    return {"anomalies": all_anomalies, "total": len(all_anomalies)}

@app.get("/geofence-alerts")
def get_geofence_alerts() -> dict:
    alerts = list(GEOFENCE_ALERTS)
    # Check current vessel positions against restricted zones
    for mmsi, positions in VESSEL_POSITIONS.items():
        if not positions:
            continue
        latest = positions[-1]
        vessel = VESSEL_REGISTRY.get(mmsi, {})
        for zone in RESTRICTED_ZONES:
            if _in_bbox(latest["lon"], latest["lat"],
                        [zone["min_lon"], zone["min_lat"], zone["max_lon"], zone["max_lat"]]):
                alerts.append({
                    "id": str(uuid.uuid4()),
                    "mmsi": mmsi,
                    "vessel_name": vessel.get("name", mmsi),
                    "zone_id": zone["id"],
                    "zone_name": zone["name"],
                    "alert_type": "ZONE_ENTRY",
                    "severity": "HIGH",
                    "position": {"lon": latest["lon"], "lat": latest["lat"]},
                    "detected_at": latest["timestamp"],
                })
    return {"alerts": alerts, "total": len(alerts)}

@app.post("/ais/ingest")
def ingest_ais(req: AISIngestRequest) -> dict:
    ingested = 0
    for pos in req.positions:
        mmsi = pos.mmsi
        if mmsi not in VESSEL_REGISTRY:
            VESSEL_REGISTRY[mmsi] = {
                "mmsi": mmsi, "name": f"UNKNOWN-{mmsi}", "flag": "XX",
                "type": "UNKNOWN", "imo": "", "declared_route": [],
            }
        if mmsi not in VESSEL_POSITIONS:
            VESSEL_POSITIONS[mmsi] = []
        VESSEL_POSITIONS[mmsi].append(pos.model_dump())
        # Keep last 1000 positions per vessel
        if len(VESSEL_POSITIONS[mmsi]) > 1000:
            VESSEL_POSITIONS[mmsi] = VESSEL_POSITIONS[mmsi][-1000:]
        ingested += 1
    return {"ingested": ingested, "total_vessels": len(VESSEL_REGISTRY)}

@app.get("/vessels/near-port")
def vessels_near_port(lon: float, lat: float, radius_km: float = 50.0) -> dict:
    nearby = []
    for mmsi, positions in VESSEL_POSITIONS.items():
        if not positions:
            continue
        latest = positions[-1]
        dist = _haversine_km(lon, lat, latest["lon"], latest["lat"])
        if dist <= radius_km:
            vessel = VESSEL_REGISTRY.get(mmsi, {})
            nearby.append({
                **vessel,
                "distance_km": round(dist, 2),
                "latest_position": latest,
            })
    nearby.sort(key=lambda v: v["distance_km"])
    return {"vessels": nearby, "total": len(nearby), "radius_km": radius_km}

@app.get("/stats")
def get_stats() -> dict:
    total_anomalies = len(ANOMALIES)
    dark_vessel_count = sum(1 for a in ANOMALIES if a.get("anomaly_type") == "DARK_VESSEL")
    return {
        "vessels_tracked": len(VESSEL_REGISTRY),
        "total_positions": sum(len(p) for p in VESSEL_POSITIONS.values()),
        "anomalies_detected": total_anomalies,
        "dark_vessel_alerts": dark_vessel_count,
        "geofence_zones": len(RESTRICTED_ZONES),
        "shipping_lanes_monitored": len(SHIPPING_LANES),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8102)
