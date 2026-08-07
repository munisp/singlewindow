"""
TradeGateway Python Benchmark Server
=====================================
Exposes PEP screening, AI risk scoring, NAICOM reporting,
and SAR DLQ endpoints for load testing.
"""

import asyncio
import hashlib
import json
import math
import os
import time
import uuid
from typing import Optional

import asyncpg
from aiohttp import web

# ─── Global State ─────────────────────────────────────────────────────────────

request_count = 0
error_count = 0
db_pool: Optional[asyncpg.Pool] = None

PEP_DATABASE = {
    "JOHN DOE ENTERPRISES": {"risk_score": 95.0, "pep_type": "DOMESTIC_PEP"},
    "GLOBAL TRADE LTD": {"risk_score": 88.0, "pep_type": "FOREIGN_PEP"},
    "CORRUPT OFFICIALS INC": {"risk_score": 99.0, "pep_type": "DOMESTIC_PEP"},
    "SANCTIONED ENTITY SA": {"risk_score": 100.0, "pep_type": "SANCTIONS"},
}

# ─── Business Logic ───────────────────────────────────────────────────────────

def fuzzy_similarity(a: str, b: str) -> float:
    if a == b:
        return 1.0
    la, lb = len(a), len(b)
    if la == 0 or lb == 0:
        return 0.0
    dp = [[0] * (lb + 1) for _ in range(la + 1)]
    for i in range(la + 1):
        dp[i][0] = i
    for j in range(lb + 1):
        dp[0][j] = j
    for i in range(1, la + 1):
        for j in range(1, lb + 1):
            cost = 0 if a[i-1] == b[j-1] else 1
            dp[i][j] = min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost)
    return 1.0 - dp[la][lb] / max(la, lb)


def screen_pep(entity_name: str, amount: float) -> dict:
    normalized = entity_name.upper().strip()
    pep_matched = False
    risk_score = 0.0
    match_details = {}

    if normalized in PEP_DATABASE:
        pep_matched = True
        match_details = PEP_DATABASE[normalized]
        risk_score = match_details["risk_score"]

    if not pep_matched:
        for pep_name, pep_data in PEP_DATABASE.items():
            sim = fuzzy_similarity(normalized, pep_name)
            if sim > 0.75:
                pep_matched = True
                match_details = {**pep_data, "similarity": sim, "method": "FUZZY"}
                risk_score = pep_data["risk_score"] * sim
                break

    # Structuring detection
    if 4_500_000 <= amount < 5_000_000:
        risk_score = max(risk_score, 60.0)
        match_details["structuring_flag"] = True

    return {
        "pep_matched": pep_matched,
        "risk_score": risk_score,
        "match_details": match_details,
    }


def score_risk(declaration: dict) -> dict:
    country_risk = {"CN": 0.3, "AE": 0.5, "US": 0.1, "NG": 0.1}.get(
        declaration.get("country_of_origin", ""), 0.2
    )
    cif_value = declaration.get("cif_value", 0)
    duty_rate = declaration.get("duty_rate", 0)
    hs_code = declaration.get("hs_code", "")

    score = country_risk * 30
    score += 20 if cif_value > 10_000_000 else 0
    score += 25 if hs_code[:4] in ["0201", "2710", "9301"] else 0
    score += min(duty_rate * 100, 15)
    score += 10 if int(hs_code[:2]) in [93, 27, 2] else 0

    return {
        "risk_score": min(score, 100.0),
        "risk_lane": "red" if score > 70 else ("yellow" if score > 30 else "green"),
        "country_risk": country_risk,
        "high_value": cif_value > 10_000_000,
    }


def calculate_landing_cost(cif_value: float, hs_code: str) -> dict:
    rates = {
        "84": 0.05, "85": 0.05, "87": 0.35, "27": 0.05,
        "30": 0.00, "02": 0.20, "10": 0.05, "52": 0.20,
    }
    duty_rate = rates.get(hs_code[:2], 0.10)
    import_duty = cif_value * duty_rate
    ciss = cif_value * 0.01
    etl = cif_value * 0.005
    nta = cif_value * 0.005
    landing_cost = cif_value + import_duty + ciss + etl + nta
    import_vat = landing_cost * 0.075

    return {
        "cif_value": cif_value,
        "duty_rate": duty_rate,
        "import_duty": import_duty,
        "ciss": ciss,
        "etl": etl,
        "nta": nta,
        "landing_cost": landing_cost,
        "import_vat": import_vat,
    }


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi, dlambda = math.radians(lat2-lat1), math.radians(lon2-lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return 2 * R * math.asin(math.sqrt(a))


# ─── HTTP Handlers ────────────────────────────────────────────────────────────

async def handle_health(request):
    return web.json_response({"status": "ok", "service": "tradegateway-python-benchmark"})


async def handle_stats(request):
    return web.json_response({
        "total_requests": request_count,
        "total_errors": error_count,
        "error_rate_pct": (error_count / request_count * 100) if request_count > 0 else 0,
    })


async def handle_pep_screen(request):
    global request_count, error_count
    request_count += 1
    start = time.perf_counter()
    try:
        data = await request.json()
        entity_name = data.get("entity_name", "")
        amount = float(data.get("amount", 0))

        result = screen_pep(entity_name, amount)
        result["latency_us"] = int((time.perf_counter() - start) * 1_000_000)

        # Persist to DB if available
        if db_pool:
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO pep_screening_log (entity_name, risk_score, pep_matched)
                    VALUES ($1, $2, $3)
                """, entity_name, result["risk_score"], result["pep_matched"])

        return web.json_response(result)
    except Exception as e:
        error_count += 1
        return web.json_response({"error": str(e)}, status=400)


async def handle_risk_score(request):
    global request_count, error_count
    request_count += 1
    start = time.perf_counter()
    try:
        data = await request.json()
        result = score_risk(data)
        result["latency_us"] = int((time.perf_counter() - start) * 1_000_000)
        return web.json_response(result)
    except Exception as e:
        error_count += 1
        return web.json_response({"error": str(e)}, status=400)


async def handle_landing_cost(request):
    global request_count, error_count
    request_count += 1
    start = time.perf_counter()
    try:
        data = await request.json()
        cif_value = float(data.get("cif_value", 0))
        hs_code = data.get("hs_code", "8471")
        result = calculate_landing_cost(cif_value, hs_code)
        result["latency_us"] = int((time.perf_counter() - start) * 1_000_000)
        return web.json_response(result)
    except Exception as e:
        error_count += 1
        return web.json_response({"error": str(e)}, status=400)


async def handle_sar_submit(request):
    global request_count, error_count
    request_count += 1
    start = time.perf_counter()
    try:
        data = await request.json()
        sar_ref = f"SAR-BENCH-{uuid.uuid4().hex[:8].upper()}"

        if db_pool:
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO nfiu_sar_queue (sar_reference, trader_id, transaction_amount, suspicious_activity)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (sar_reference) DO NOTHING
                """, sar_ref,
                    data.get("trader_id", "bench-trader"),
                    float(data.get("amount", 1000000)),
                    data.get("activity", "Benchmark test"))

        return web.json_response({
            "sar_reference": sar_ref,
            "status": "queued",
            "latency_us": int((time.perf_counter() - start) * 1_000_000),
        })
    except Exception as e:
        error_count += 1
        return web.json_response({"error": str(e)}, status=400)


async def handle_geo_distance(request):
    global request_count, error_count
    request_count += 1
    start = time.perf_counter()
    try:
        data = await request.json()
        lat1 = float(data.get("lat1", 6.4474))
        lon1 = float(data.get("lon1", 3.3903))
        lat2 = float(data.get("lat2", 4.7167))
        lon2 = float(data.get("lon2", 7.1500))

        distance = haversine_km(lat1, lon1, lat2, lon2)
        return web.json_response({
            "distance_km": round(distance, 3),
            "latency_us": int((time.perf_counter() - start) * 1_000_000),
        })
    except Exception as e:
        error_count += 1
        return web.json_response({"error": str(e)}, status=400)


async def handle_naicom_report(request):
    global request_count, error_count
    request_count += 1
    start = time.perf_counter()
    try:
        data = await request.json()
        premiums = float(data.get("total_premiums", 10_000_000))
        claims = float(data.get("total_claims", 3_000_000))

        loss_ratio = (claims / premiums * 100) if premiums > 0 else 0.0
        assets = premiums * 1.25
        liabilities = claims * 1.1
        net_premium = premiums * 0.85
        solvency_margin = ((assets - liabilities) / net_premium * 100) if net_premium > 0 else 150.0
        rbc = max(3_000_000_000, premiums * 0.18)

        return web.json_response({
            "loss_ratio_pct": round(loss_ratio, 4),
            "solvency_margin_pct": round(solvency_margin, 4),
            "risk_based_capital_ngn": rbc,
            "latency_us": int((time.perf_counter() - start) * 1_000_000),
        })
    except Exception as e:
        error_count += 1
        return web.json_response({"error": str(e)}, status=400)


# ─── Application Setup ────────────────────────────────────────────────────────

async def startup(app):
    global db_pool
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        try:
            db_pool = await asyncpg.create_pool(db_url, min_size=5, max_size=30)
            # Ensure tables exist
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS pep_screening_log (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        entity_name TEXT NOT NULL,
                        risk_score NUMERIC(5,2) NOT NULL,
                        pep_matched BOOLEAN DEFAULT FALSE,
                        screened_at TIMESTAMPTZ DEFAULT NOW()
                    );
                    CREATE TABLE IF NOT EXISTS nfiu_sar_queue (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        sar_reference VARCHAR(64) UNIQUE NOT NULL,
                        trader_id VARCHAR(128) NOT NULL,
                        transaction_amount NUMERIC(18,2) NOT NULL,
                        suspicious_activity TEXT NOT NULL,
                        status VARCHAR(16) DEFAULT 'pending',
                        retry_count INTEGER DEFAULT 0,
                        max_retries INTEGER DEFAULT 5,
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    );
                """)
            print("PostgreSQL connected")
        except Exception as e:
            print(f"Warning: PostgreSQL connection failed: {e}")


async def cleanup(app):
    if db_pool:
        await db_pool.close()


def create_app():
    app = web.Application()
    app.on_startup.append(startup)
    app.on_cleanup.append(cleanup)

    app.router.add_get("/health", handle_health)
    app.router.add_get("/v1/stats", handle_stats)
    app.router.add_post("/v1/pep/screen", handle_pep_screen)
    app.router.add_post("/v1/risk/score", handle_risk_score)
    app.router.add_post("/v1/ncs/landing-cost", handle_landing_cost)
    app.router.add_post("/v1/sar/submit", handle_sar_submit)
    app.router.add_post("/v1/geo/distance", handle_geo_distance)
    app.router.add_post("/v1/naicom/report", handle_naicom_report)

    return app


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8093"))
    print(f"Python benchmark server starting on :{port}")
    web.run_app(create_app(), host="0.0.0.0", port=port)
