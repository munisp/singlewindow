"""
deltalake-svc — Delta Lake Analytics Pipeline Service
Port: 8103

Provides trade statistics aggregation, HS code volume analytics,
trader performance metrics, and route-level trade flow analytics
for the TradeGateway™ NGSWTP Trade Analytics dashboard.

In production this service uses delta-rs + PyArrow + DuckDB for
in-process analytics on Delta Lake Parquet partitions. Kafka
consumer ingests declaration events in real-time.
"""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="deltalake-svc", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Simulated Delta Lake Data ────────────────────────────────────────────────

HS_CHAPTERS = {
    "84": "Nuclear reactors, boilers, machinery",
    "85": "Electrical machinery and equipment",
    "87": "Vehicles other than railway",
    "27": "Mineral fuels, oils and waxes",
    "39": "Plastics and articles thereof",
    "72": "Iron and steel",
    "30": "Pharmaceutical products",
    "61": "Knitted or crocheted clothing",
    "62": "Not knitted/crocheted clothing",
    "90": "Optical, photographic instruments",
}

ORIGIN_COUNTRIES = ["CN", "US", "DE", "JP", "KR", "IN", "SG", "GB", "FR", "NL"]
DEST_COUNTRIES   = ["NG", "GH", "RW", "KE", "ZA", "ET", "TZ", "UG", "CM", "SN"]

INGESTED_EVENTS: list[dict] = []

def _seed_analytics_data() -> None:
    """Seed 90 days of simulated declaration events."""
    now = datetime.now(timezone.utc)
    hs_list = list(HS_CHAPTERS.keys())
    for day_offset in range(90):
        day = now - timedelta(days=day_offset)
        daily_count = random.randint(80, 250)
        for _ in range(daily_count):
            hs = random.choice(hs_list)
            origin = random.choice(ORIGIN_COUNTRIES)
            dest   = random.choice(DEST_COUNTRIES)
            value  = random.uniform(5_000, 500_000)
            duty   = value * random.uniform(0.05, 0.25)
            lane   = random.choices(["GREEN", "YELLOW", "RED"], weights=[70, 20, 10])[0]
            clearance_hours = {"GREEN": random.uniform(0.1, 4), "YELLOW": random.uniform(4, 24), "RED": random.uniform(24, 72)}[lane]
            INGESTED_EVENTS.append({
                "id": str(uuid.uuid4()),
                "date": day.strftime("%Y-%m-%d"),
                "timestamp": day.isoformat(),
                "hs_chapter": hs,
                "hs_description": HS_CHAPTERS[hs],
                "origin_country": origin,
                "dest_country": dest,
                "declared_value_usd": round(value, 2),
                "duty_amount_usd": round(duty, 2),
                "clearance_lane": lane,
                "clearance_hours": round(clearance_hours, 2),
                "trader_id": f"TRD-{random.randint(1000, 9999)}",
                "status": "CLEARED",
            })

_seed_analytics_data()

# ─── Models ───────────────────────────────────────────────────────────────────

class DeclarationEvent(BaseModel):
    declaration_id: str
    date: str
    hs_chapter: str
    origin_country: str
    dest_country: str
    declared_value_usd: float
    duty_amount_usd: float
    clearance_lane: str
    clearance_hours: float
    trader_id: str

class IngestRequest(BaseModel):
    events: list[DeclarationEvent]

# ─── Aggregation helpers ──────────────────────────────────────────────────────

def _filter_by_period(events: list[dict], period: str) -> list[dict]:
    now = datetime.now(timezone.utc)
    if period == "daily":
        cutoff = now - timedelta(days=1)
    elif period == "weekly":
        cutoff = now - timedelta(days=7)
    elif period == "monthly":
        cutoff = now - timedelta(days=30)
    else:  # quarterly
        cutoff = now - timedelta(days=90)
    cutoff_str = cutoff.strftime("%Y-%m-%d")
    return [e for e in events if e["date"] >= cutoff_str]

def _group_by_date(events: list[dict]) -> list[dict]:
    by_date: dict[str, dict] = {}
    for e in events:
        d = e["date"]
        if d not in by_date:
            by_date[d] = {"date": d, "declaration_count": 0, "total_value_usd": 0.0, "total_duty_usd": 0.0, "avg_clearance_hours": []}
        by_date[d]["declaration_count"] += 1
        by_date[d]["total_value_usd"] += e["declared_value_usd"]
        by_date[d]["total_duty_usd"] += e["duty_amount_usd"]
        by_date[d]["avg_clearance_hours"].append(e["clearance_hours"])
    result = []
    for d, stats in sorted(by_date.items()):
        hours_list = stats.pop("avg_clearance_hours")
        stats["avg_clearance_hours"] = round(sum(hours_list) / len(hours_list), 2) if hours_list else 0
        stats["total_value_usd"] = round(stats["total_value_usd"], 2)
        stats["total_duty_usd"] = round(stats["total_duty_usd"], 2)
        result.append(stats)
    return result

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "deltalake-svc", "events_ingested": len(INGESTED_EVENTS)}

@app.get("/trade-stats")
def get_trade_stats(period: str = Query("monthly", enum=["daily", "weekly", "monthly", "quarterly"])) -> dict:
    events = _filter_by_period(INGESTED_EVENTS, period)
    time_series = _group_by_date(events)
    total_value = sum(e["declared_value_usd"] for e in events)
    total_duty  = sum(e["duty_amount_usd"] for e in events)
    total_count = len(events)
    avg_clearance = sum(e["clearance_hours"] for e in events) / max(total_count, 1)
    lane_dist = {"GREEN": 0, "YELLOW": 0, "RED": 0}
    for e in events:
        lane_dist[e["clearance_lane"]] = lane_dist.get(e["clearance_lane"], 0) + 1
    return {
        "period": period,
        "summary": {
            "total_declarations": total_count,
            "total_value_usd": round(total_value, 2),
            "total_duty_usd": round(total_duty, 2),
            "avg_clearance_hours": round(avg_clearance, 2),
            "lane_distribution": lane_dist,
        },
        "time_series": time_series[-30:],  # last 30 data points
    }

@app.get("/hs-code-volume")
def get_hs_code_volume(period: str = Query("monthly", enum=["daily", "weekly", "monthly", "quarterly"])) -> dict:
    events = _filter_by_period(INGESTED_EVENTS, period)
    by_hs: dict[str, dict] = {}
    for e in events:
        ch = e["hs_chapter"]
        if ch not in by_hs:
            by_hs[ch] = {
                "hs_chapter": ch,
                "description": HS_CHAPTERS.get(ch, "Unknown"),
                "declaration_count": 0,
                "total_value_usd": 0.0,
                "total_duty_usd": 0.0,
            }
        by_hs[ch]["declaration_count"] += 1
        by_hs[ch]["total_value_usd"] += e["declared_value_usd"]
        by_hs[ch]["total_duty_usd"] += e["duty_amount_usd"]
    result = sorted(by_hs.values(), key=lambda x: x["declaration_count"], reverse=True)
    for r in result:
        r["total_value_usd"] = round(r["total_value_usd"], 2)
        r["total_duty_usd"] = round(r["total_duty_usd"], 2)
    return {"hs_volumes": result, "total_chapters": len(result), "period": period}

@app.get("/trader-metrics")
def get_trader_metrics(period: str = Query("monthly", enum=["daily", "weekly", "monthly", "quarterly"]), limit: int = Query(20, ge=1, le=100)) -> dict:
    events = _filter_by_period(INGESTED_EVENTS, period)
    by_trader: dict[str, dict] = {}
    for e in events:
        tid = e["trader_id"]
        if tid not in by_trader:
            by_trader[tid] = {
                "trader_id": tid,
                "declaration_count": 0,
                "total_value_usd": 0.0,
                "total_duty_usd": 0.0,
                "clearance_hours": [],
                "green_count": 0, "yellow_count": 0, "red_count": 0,
            }
        t = by_trader[tid]
        t["declaration_count"] += 1
        t["total_value_usd"] += e["declared_value_usd"]
        t["total_duty_usd"] += e["duty_amount_usd"]
        t["clearance_hours"].append(e["clearance_hours"])
        t[f"{e['clearance_lane'].lower()}_count"] += 1
    result = []
    for t in by_trader.values():
        hours = t.pop("clearance_hours")
        t["avg_clearance_hours"] = round(sum(hours) / len(hours), 2) if hours else 0
        t["green_lane_rate"] = round(t["green_count"] / max(t["declaration_count"], 1), 3)
        t["total_value_usd"] = round(t["total_value_usd"], 2)
        t["total_duty_usd"] = round(t["total_duty_usd"], 2)
        result.append(t)
    result.sort(key=lambda x: x["declaration_count"], reverse=True)
    return {"traders": result[:limit], "total_traders": len(result), "period": period}

@app.get("/route-flow")
def get_route_flow(period: str = Query("monthly", enum=["daily", "weekly", "monthly", "quarterly"])) -> dict:
    events = _filter_by_period(INGESTED_EVENTS, period)
    by_route: dict[str, dict] = {}
    for e in events:
        key = f"{e['origin_country']}->{e['dest_country']}"
        if key not in by_route:
            by_route[key] = {
                "route": key,
                "origin": e["origin_country"],
                "destination": e["dest_country"],
                "declaration_count": 0,
                "total_value_usd": 0.0,
            }
        by_route[key]["declaration_count"] += 1
        by_route[key]["total_value_usd"] += e["declared_value_usd"]
    result = sorted(by_route.values(), key=lambda x: x["total_value_usd"], reverse=True)
    for r in result:
        r["total_value_usd"] = round(r["total_value_usd"], 2)
    return {"routes": result[:50], "total_routes": len(result), "period": period}

@app.get("/duty-revenue")
def get_duty_revenue(period: str = Query("monthly", enum=["daily", "weekly", "monthly", "quarterly"])) -> dict:
    events = _filter_by_period(INGESTED_EVENTS, period)
    time_series = []
    by_date: dict[str, float] = {}
    for e in events:
        by_date[e["date"]] = by_date.get(e["date"], 0.0) + e["duty_amount_usd"]
    for date, revenue in sorted(by_date.items()):
        time_series.append({"date": date, "duty_revenue_usd": round(revenue, 2)})
    total = sum(e["duty_amount_usd"] for e in events)
    return {
        "period": period,
        "total_duty_revenue_usd": round(total, 2),
        "time_series": time_series[-30:],
        "avg_daily_revenue_usd": round(total / max(len(by_date), 1), 2),
    }

@app.post("/ingest")
def ingest_events(req: IngestRequest) -> dict:
    for event in req.events:
        INGESTED_EVENTS.append({
            **event.model_dump(),
            "id": str(uuid.uuid4()),
            "status": "CLEARED",
        })
    return {"ingested": len(req.events), "total_events": len(INGESTED_EVENTS)}

@app.get("/stats")
def get_stats() -> dict:
    total_value = sum(e["declared_value_usd"] for e in INGESTED_EVENTS)
    total_duty  = sum(e["duty_amount_usd"] for e in INGESTED_EVENTS)
    return {
        "total_events": len(INGESTED_EVENTS),
        "total_trade_value_usd": round(total_value, 2),
        "total_duty_revenue_usd": round(total_duty, 2),
        "hs_chapters_tracked": len(HS_CHAPTERS),
        "origin_countries": len(ORIGIN_COUNTRIES),
        "destination_countries": len(DEST_COUNTRIES),
        "date_range_days": 90,
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


    uvicorn.run(app, host="0.0.0.0", port=8103)
