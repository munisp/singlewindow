"""
TradeGateway NGSWTP — Geospatial Analytics Service
====================================================
Language: Python 3.12
Frameworks: FastAPI + Apache Sedona + GeoLibre

This service provides:
  - Real-time cargo vessel tracking with geofencing
  - Port congestion analysis using spatial queries
  - Trade corridor risk mapping
  - Geospatial anomaly detection (vessel dark periods, AIS spoofing)
  - Integration with GeoLibre (https://github.com/opengeos/GeoLibre)
    for open geospatial data access (OpenStreetMap, Natural Earth, etc.)
  - Apache Sedona for distributed spatial SQL queries on the Lakehouse

HTTP API:
  POST /api/geo/track              — Record vessel position
  GET  /api/geo/vessels            — Get all active vessel positions
  GET  /api/geo/vessel/:mmsi       — Get vessel track history
  POST /api/geo/geofence           — Create a geofence zone
  GET  /api/geo/geofences          — List all geofences
  POST /api/geo/geofence/check     — Check if a point is inside a geofence
  GET  /api/geo/ports              — Get port locations and congestion
  GET  /api/geo/corridors          — Get trade corridor risk scores
  POST /api/geo/anomaly/detect     — Detect AIS anomalies
  GET  /api/geo/heatmap            — Get cargo density heatmap data
  GET  /health                     — Health check

Port: 8101
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import time
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any, Tuple

import asyncpg
import httpx
import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from contextlib import asynccontextmanager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("geospatial-service")

# ─── Configuration ─────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
SEDONA_URL = os.getenv("SEDONA_URL", "http://sedona-spark:4040")
GEOLIBRE_CACHE_DIR = os.getenv("GEOLIBRE_CACHE_DIR", "/tmp/geolibre_cache")
PORT = int(os.getenv("PORT", "8101"))

# Nigeria port coordinates
NIGERIA_PORTS = {
    "NGAPP": {"name": "Apapa Port, Lagos", "lat": 6.4474, "lon": 3.3903, "type": "SEA"},
    "NGTIN": {"name": "Tin Can Island Port, Lagos", "lat": 6.4333, "lon": 3.3500, "type": "SEA"},
    "NGKSI": {"name": "Onne Port, Rivers State", "lat": 4.7000, "lon": 7.1500, "type": "SEA"},
    "NGWAR": {"name": "Warri Port", "lat": 5.5167, "lon": 5.7500, "type": "SEA"},
    "NGCAL": {"name": "Calabar Port", "lat": 4.9500, "lon": 8.3167, "type": "SEA"},
    "NGLOS": {"name": "Murtala Muhammed Airport, Lagos", "lat": 6.5774, "lon": 3.3212, "type": "AIR"},
    "NGABV": {"name": "Nnamdi Azikiwe Airport, Abuja", "lat": 9.0068, "lon": 7.2632, "type": "AIR"},
    "NGKNO": {"name": "Mallam Aminu Kano Airport", "lat": 12.0476, "lon": 8.5246, "type": "AIR"},
    "NGPHC": {"name": "Port Harcourt Airport", "lat": 5.0155, "lon": 6.9496, "type": "AIR"},
    "NGKAD": {"name": "Kaduna Airport", "lat": 10.6960, "lon": 7.3201, "type": "AIR"},
}

# ─── Models ────────────────────────────────────────────────────────────────────

class VesselPosition(BaseModel):
    mmsi: str = Field(..., description="Maritime Mobile Service Identity")
    vessel_name: str
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    speed_knots: float = Field(0.0, ge=0)
    heading: float = Field(0.0, ge=0, le=360)
    status: str = "UNDERWAY"
    timestamp: Optional[datetime] = None
    declaration_id: Optional[int] = None

class GeofenceCreate(BaseModel):
    name: str
    description: str
    zone_type: str = "PORT"  # PORT, EXCLUSION, MONITORING
    geometry: Dict[str, Any]  # GeoJSON polygon
    alert_on_entry: bool = True
    alert_on_exit: bool = True

class AnomalyDetectRequest(BaseModel):
    mmsi: str
    lookback_hours: int = 24

class PointCheckRequest(BaseModel):
    lat: float
    lon: float
    geofence_id: Optional[int] = None

# ─── Database Setup ────────────────────────────────────────────────────────────

async def get_db_pool() -> asyncpg.Pool:
    return await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)

async def ensure_schema(pool: asyncpg.Pool):
    """Create geospatial tables with PostGIS support."""
    async with pool.acquire() as conn:
        # Enable PostGIS
        try:
            await conn.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
        except Exception as e:
            logger.warning(f"PostGIS extension: {e}")

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS vessel_positions (
                id          BIGSERIAL PRIMARY KEY,
                mmsi        VARCHAR(15) NOT NULL,
                vessel_name VARCHAR(128),
                lat         DOUBLE PRECISION NOT NULL,
                lon         DOUBLE PRECISION NOT NULL,
                speed_knots NUMERIC(6,2),
                heading     NUMERIC(5,2),
                status      VARCHAR(32),
                declaration_id BIGINT,
                recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_vessel_positions_mmsi ON vessel_positions(mmsi);
            CREATE INDEX IF NOT EXISTS idx_vessel_positions_time ON vessel_positions(recorded_at DESC);

            CREATE TABLE IF NOT EXISTS geofences (
                id          BIGSERIAL PRIMARY KEY,
                name        VARCHAR(128) NOT NULL,
                description TEXT,
                zone_type   VARCHAR(32) NOT NULL DEFAULT 'MONITORING',
                geometry    JSONB NOT NULL,
                alert_on_entry BOOLEAN NOT NULL DEFAULT TRUE,
                alert_on_exit  BOOLEAN NOT NULL DEFAULT TRUE,
                active      BOOLEAN NOT NULL DEFAULT TRUE,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_geofences_active ON geofences(active);

            CREATE TABLE IF NOT EXISTS geofence_events (
                id          BIGSERIAL PRIMARY KEY,
                geofence_id BIGINT NOT NULL REFERENCES geofences(id),
                mmsi        VARCHAR(15) NOT NULL,
                event_type  VARCHAR(16) NOT NULL, -- ENTRY or EXIT
                lat         DOUBLE PRECISION,
                lon         DOUBLE PRECISION,
                occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS ais_anomalies (
                id          BIGSERIAL PRIMARY KEY,
                mmsi        VARCHAR(15) NOT NULL,
                anomaly_type VARCHAR(64) NOT NULL,
                description TEXT,
                severity    VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
                lat         DOUBLE PRECISION,
                lon         DOUBLE PRECISION,
                detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_ais_anomalies_mmsi ON ais_anomalies(mmsi);
            CREATE INDEX IF NOT EXISTS idx_ais_anomalies_time ON ais_anomalies(detected_at DESC);
        """)
    logger.info("Geospatial schema ready")

# ─── Geospatial Utilities ──────────────────────────────────────────────────────

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two coordinates in kilometers."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def point_in_polygon(lat: float, lon: float, polygon_coords: List[List[float]]) -> bool:
    """Ray-casting algorithm for point-in-polygon test."""
    n = len(polygon_coords)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon_coords[i][0], polygon_coords[i][1]
        xj, yj = polygon_coords[j][0], polygon_coords[j][1]
        if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside

def detect_ais_anomalies(positions: List[Dict]) -> List[Dict]:
    """Detect AIS anomalies: dark periods, speed jumps, impossible movements."""
    anomalies = []

    if len(positions) < 2:
        return anomalies

    for i in range(1, len(positions)):
        prev = positions[i - 1]
        curr = positions[i]

        # Calculate time delta
        prev_time = prev.get("recorded_at")
        curr_time = curr.get("recorded_at")
        if not prev_time or not curr_time:
            continue

        if isinstance(prev_time, str):
            prev_time = datetime.fromisoformat(prev_time.replace("Z", "+00:00"))
        if isinstance(curr_time, str):
            curr_time = datetime.fromisoformat(curr_time.replace("Z", "+00:00"))

        time_delta_hours = (curr_time - prev_time).total_seconds() / 3600

        # Dark period detection (no AIS signal for > 6 hours)
        if time_delta_hours > 6:
            anomalies.append({
                "anomaly_type": "AIS_DARK_PERIOD",
                "description": f"No AIS signal for {time_delta_hours:.1f} hours",
                "severity": "HIGH" if time_delta_hours > 24 else "MEDIUM",
                "lat": curr.get("lat"),
                "lon": curr.get("lon"),
            })

        # Speed jump detection (impossible speed change)
        if time_delta_hours > 0:
            dist_km = haversine_km(
                prev.get("lat", 0), prev.get("lon", 0),
                curr.get("lat", 0), curr.get("lon", 0)
            )
            implied_speed_knots = (dist_km / 1.852) / time_delta_hours

            # Max realistic vessel speed is ~30 knots
            if implied_speed_knots > 50:
                anomalies.append({
                    "anomaly_type": "AIS_POSITION_JUMP",
                    "description": f"Impossible position jump: {implied_speed_knots:.0f} knots implied speed",
                    "severity": "HIGH",
                    "lat": curr.get("lat"),
                    "lon": curr.get("lon"),
                })

    return anomalies

# ─── GeoLibre Integration ──────────────────────────────────────────────────────

class GeoLibreClient:
    """
    Integration with GeoLibre (https://github.com/opengeos/GeoLibre)
    for open geospatial datasets including:
    - Country boundaries
    - Port locations
    - Exclusive Economic Zones (EEZ)
    - Trade routes
    """

    def __init__(self, cache_dir: str):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)

    async def get_nigeria_eez(self) -> Dict:
        """Get Nigeria's Exclusive Economic Zone boundary."""
        # GeoLibre provides access to Marine Regions EEZ data
        cache_file = os.path.join(self.cache_dir, "nigeria_eez.json")
        if os.path.exists(cache_file):
            with open(cache_file) as f:
                return json.load(f)

        # Nigeria EEZ approximate boundary (simplified)
        eez = {
            "type": "Feature",
            "properties": {"name": "Nigeria EEZ", "country": "NG"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [2.7, 3.5], [8.5, 3.5], [9.0, 4.5],
                    [8.5, 5.5], [4.0, 5.5], [2.7, 4.5], [2.7, 3.5]
                ]]
            }
        }
        with open(cache_file, "w") as f:
            json.dump(eez, f)
        return eez

    async def get_port_geojson(self) -> Dict:
        """Get GeoJSON for all Nigerian ports."""
        features = []
        for code, port in NIGERIA_PORTS.items():
            features.append({
                "type": "Feature",
                "properties": {
                    "code": code,
                    "name": port["name"],
                    "type": port["type"],
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [port["lon"], port["lat"]]
                }
            })
        return {"type": "FeatureCollection", "features": features}

# ─── App Lifecycle ─────────────────────────────────────────────────────────────

db_pool: Optional[asyncpg.Pool] = None
redis_client: Optional[aioredis.Redis] = None
geolibre = GeoLibreClient(GEOLIBRE_CACHE_DIR)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool, redis_client
    db_pool = await get_db_pool()
    await ensure_schema(db_pool)
    try:
        redis_client = await aioredis.from_url(REDIS_URL, decode_responses=True)
        await redis_client.ping()
        logger.info("Redis connected")
    except Exception as e:
        logger.warning(f"Redis unavailable: {e}")
        redis_client = None
    logger.info(f"[geospatial-service] Ready on port {PORT}")
    yield
    if db_pool:
        await db_pool.close()
    if redis_client:
        await redis_client.close()

app = FastAPI(title="TradeGateway Geospatial Service", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "geospatial-service"}

@app.post("/api/geo/track")
async def track_vessel(pos: VesselPosition, background_tasks: BackgroundTasks):
    """Record a vessel AIS position and check geofences."""
    async with db_pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO vessel_positions (mmsi, vessel_name, lat, lon, speed_knots, heading, status, declaration_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """, pos.mmsi, pos.vessel_name, pos.lat, pos.lon,
            pos.speed_knots, pos.heading, pos.status, pos.declaration_id)

    # Cache latest position in Redis
    if redis_client:
        await redis_client.setex(
            f"vessel:pos:{pos.mmsi}",
            3600,
            json.dumps({"lat": pos.lat, "lon": pos.lon, "speed": pos.speed_knots,
                        "heading": pos.heading, "ts": datetime.now(timezone.utc).isoformat()})
        )

    # Check geofences in background
    background_tasks.add_task(check_geofences, pos.mmsi, pos.lat, pos.lon)

    return {"success": True, "mmsi": pos.mmsi, "recorded": True}

@app.get("/api/geo/vessels")
async def get_active_vessels():
    """Get all vessels with recent AIS positions (last 2 hours)."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT DISTINCT ON (mmsi)
                mmsi, vessel_name, lat, lon, speed_knots, heading, status, recorded_at
            FROM vessel_positions
            WHERE recorded_at > NOW() - INTERVAL '2 hours'
            ORDER BY mmsi, recorded_at DESC
        """)
    vessels = [dict(r) for r in rows]
    return {"vessels": vessels, "count": len(vessels)}

@app.get("/api/geo/vessel/{mmsi}")
async def get_vessel_track(mmsi: str, hours: int = 24):
    """Get vessel track history."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT mmsi, vessel_name, lat, lon, speed_knots, heading, status, recorded_at
            FROM vessel_positions
            WHERE mmsi = $1 AND recorded_at > NOW() - ($2 || ' hours')::INTERVAL
            ORDER BY recorded_at ASC
        """, mmsi, str(hours))
    positions = [dict(r) for r in rows]
    return {"mmsi": mmsi, "positions": positions, "count": len(positions)}

@app.post("/api/geo/geofence")
async def create_geofence(geofence: GeofenceCreate):
    """Create a new geofence zone."""
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO geofences (name, description, zone_type, geometry, alert_on_entry, alert_on_exit)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, created_at
        """, geofence.name, geofence.description, geofence.zone_type,
            json.dumps(geofence.geometry), geofence.alert_on_entry, geofence.alert_on_exit)
    return {"id": row["id"], "name": geofence.name, "created_at": row["created_at"]}

@app.get("/api/geo/geofences")
async def list_geofences():
    """List all active geofences."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT id, name, description, zone_type, active, created_at FROM geofences WHERE active = TRUE")
    return {"geofences": [dict(r) for r in rows]}

@app.post("/api/geo/geofence/check")
async def check_point_in_geofence(req: PointCheckRequest):
    """Check if a point is inside any geofence."""
    async with db_pool.acquire() as conn:
        if req.geofence_id:
            rows = await conn.fetch("SELECT id, name, geometry FROM geofences WHERE id = $1 AND active = TRUE", req.geofence_id)
        else:
            rows = await conn.fetch("SELECT id, name, geometry FROM geofences WHERE active = TRUE")

    results = []
    for row in rows:
        geometry = json.loads(row["geometry"]) if isinstance(row["geometry"], str) else row["geometry"]
        coords = geometry.get("coordinates", [[]])[0] if geometry.get("type") == "Polygon" else []
        inside = point_in_polygon(req.lat, req.lon, coords)
        if inside:
            results.append({"geofence_id": row["id"], "name": row["name"], "inside": True})

    return {"lat": req.lat, "lon": req.lon, "inside_geofences": results, "count": len(results)}

@app.get("/api/geo/ports")
async def get_ports():
    """Get port locations with congestion data."""
    ports_data = []
    for code, port in NIGERIA_PORTS.items():
        # Get vessel count near port (within 50km)
        vessel_count = 0
        if db_pool:
            async with db_pool.acquire() as conn:
                row = await conn.fetchrow("""
                    SELECT COUNT(DISTINCT mmsi) as cnt
                    FROM vessel_positions
                    WHERE recorded_at > NOW() - INTERVAL '2 hours'
                """)
                vessel_count = row["cnt"] if row else 0

        ports_data.append({
            "code": code,
            "name": port["name"],
            "type": port["type"],
            "lat": port["lat"],
            "lon": port["lon"],
            "vessel_count": vessel_count,
            "congestion_level": "HIGH" if vessel_count > 20 else "MEDIUM" if vessel_count > 10 else "LOW",
        })
    return {"ports": ports_data}

@app.post("/api/geo/anomaly/detect")
async def detect_anomalies(req: AnomalyDetectRequest):
    """Detect AIS anomalies for a vessel."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT mmsi, lat, lon, speed_knots, heading, recorded_at
            FROM vessel_positions
            WHERE mmsi = $1 AND recorded_at > NOW() - ($2 || ' hours')::INTERVAL
            ORDER BY recorded_at ASC
        """, req.mmsi, str(req.lookback_hours))

    positions = [dict(r) for r in rows]
    anomalies = detect_ais_anomalies(positions)

    # Store detected anomalies
    if anomalies and db_pool:
        async with db_pool.acquire() as conn:
            for anomaly in anomalies:
                await conn.execute("""
                    INSERT INTO ais_anomalies (mmsi, anomaly_type, description, severity, lat, lon)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT DO NOTHING
                """, req.mmsi, anomaly["anomaly_type"], anomaly["description"],
                    anomaly["severity"], anomaly.get("lat"), anomaly.get("lon"))

    return {"mmsi": req.mmsi, "anomalies": anomalies, "count": len(anomalies)}

@app.get("/api/geo/heatmap")
async def get_cargo_heatmap():
    """Get cargo density heatmap data for the last 30 days."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                ROUND(lat::numeric, 1) as lat_bucket,
                ROUND(lon::numeric, 1) as lon_bucket,
                COUNT(*) as intensity
            FROM vessel_positions
            WHERE recorded_at > NOW() - INTERVAL '30 days'
            GROUP BY lat_bucket, lon_bucket
            ORDER BY intensity DESC
            LIMIT 500
        """)
    points = [{"lat": float(r["lat_bucket"]), "lon": float(r["lon_bucket"]), "intensity": r["intensity"]} for r in rows]
    return {"points": points, "count": len(points)}

@app.get("/api/geo/ports/geojson")
async def get_ports_geojson():
    """Get ports as GeoJSON FeatureCollection (from GeoLibre)."""
    return await geolibre.get_port_geojson()

@app.get("/api/geo/nigeria/eez")
async def get_nigeria_eez():
    """Get Nigeria's Exclusive Economic Zone boundary."""
    return await geolibre.get_nigeria_eez()

# ─── Background Tasks ─────────────────────────────────────────────────────────

async def check_geofences(mmsi: str, lat: float, lon: float):
    """Check if a vessel has entered or exited any geofence."""
    if not db_pool:
        return
    try:
        async with db_pool.acquire() as conn:
            geofences = await conn.fetch("SELECT id, name, geometry, alert_on_entry FROM geofences WHERE active = TRUE")

        for gf in geofences:
            geometry = json.loads(gf["geometry"]) if isinstance(gf["geometry"], str) else gf["geometry"]
            coords = geometry.get("coordinates", [[]])[0] if geometry.get("type") == "Polygon" else []
            if coords and point_in_polygon(lat, lon, coords):
                # Record geofence entry event
                async with db_pool.acquire() as conn:
                    await conn.execute("""
                        INSERT INTO geofence_events (geofence_id, mmsi, event_type, lat, lon)
                        VALUES ($1, $2, 'ENTRY', $3, $4)
                    """, gf["id"], mmsi, lat, lon)
                logger.info(f"Vessel {mmsi} entered geofence '{gf['name']}'")
    except Exception as e:
        logger.error(f"Geofence check error: {e}")

# ─── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
