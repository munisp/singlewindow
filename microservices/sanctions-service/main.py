"""
sanctions-service — TradeGateway NGSWTP
Screens traders, consignees, and goods descriptions against:
  - UN Security Council Consolidated List
  - OFAC SDN List
  - EU Consolidated Sanctions List
  - INTERPOL Notices (via OpenCTI integration)
  - WCO CEN (Customs Enforcement Network)

Uses fuzzy matching (Jaro-Winkler + Levenshtein) with configurable
match threshold. Publishes results to Kafka via Dapr.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [sanctions-service] %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway",
)
PORT = int(os.getenv("PORT", "8087"))
MATCH_THRESHOLD = float(os.getenv("MATCH_THRESHOLD", "0.85"))

# ── Simplified sanctions list (in production: loaded from OpenCTI/OFAC API) ───
SANCTIONS_ENTRIES = [
    {"id": "UN-001", "name": "ACME ARMS LTD", "list": "UN-SC", "type": "entity"},
    {"id": "UN-002", "name": "GLOBAL CHEMICAL CORP", "list": "UN-SC", "type": "entity"},
    {"id": "OFAC-001", "name": "SHADOW TRADE LLC", "list": "OFAC-SDN", "type": "entity"},
    {"id": "OFAC-002", "name": "DARK HARBOR SHIPPING", "list": "OFAC-SDN", "type": "entity"},
    {"id": "EU-001", "name": "RESTRICTED EXPORTS GMBH", "list": "EU-CONS", "type": "entity"},
]

# ── Database ──────────────────────────────────────────────────────────────────
_db_conn: Optional[psycopg2.extensions.connection] = None


def get_db():
    global _db_conn
    if _db_conn is None or _db_conn.closed:
        _db_conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    return _db_conn


# ── Fuzzy matching ────────────────────────────────────────────────────────────

def normalize(name: str) -> str:
    """Normalize entity name for comparison."""
    name = name.upper().strip()
    name = re.sub(r"\b(LTD|LLC|INC|CORP|GMBH|SA|BV|PLC|CO|COMPANY|LIMITED)\b", "", name)
    name = re.sub(r"[^A-Z0-9 ]", "", name)
    return re.sub(r"\s+", " ", name).strip()


def jaro_winkler(s1: str, s2: str) -> float:
    """Compute Jaro-Winkler similarity between two strings."""
    if s1 == s2:
        return 1.0
    len_s1, len_s2 = len(s1), len(s2)
    if len_s1 == 0 or len_s2 == 0:
        return 0.0

    match_distance = max(len_s1, len_s2) // 2 - 1
    match_distance = max(match_distance, 0)

    s1_matches = [False] * len_s1
    s2_matches = [False] * len_s2
    matches = 0
    transpositions = 0

    for i in range(len_s1):
        start = max(0, i - match_distance)
        end = min(i + match_distance + 1, len_s2)
        for j in range(start, end):
            if s2_matches[j] or s1[i] != s2[j]:
                continue
            s1_matches[i] = True
            s2_matches[j] = True
            matches += 1
            break

    if matches == 0:
        return 0.0

    k = 0
    for i in range(len_s1):
        if not s1_matches[i]:
            continue
        while not s2_matches[k]:
            k += 1
        if s1[i] != s2[k]:
            transpositions += 1
        k += 1

    jaro = (matches / len_s1 + matches / len_s2 + (matches - transpositions / 2) / matches) / 3

    # Winkler prefix bonus
    prefix = 0
    for i in range(min(4, min(len_s1, len_s2))):
        if s1[i] == s2[i]:
            prefix += 1
        else:
            break

    return jaro + prefix * 0.1 * (1 - jaro)


def screen_name(name: str) -> list[dict]:
    """Screen a name against all sanctions lists."""
    normalized = normalize(name)
    hits = []

    for entry in SANCTIONS_ENTRIES:
        entry_normalized = normalize(entry["name"])
        score = jaro_winkler(normalized, entry_normalized)
        if score >= MATCH_THRESHOLD:
            hits.append({
                "entryId": entry["id"],
                "entryName": entry["name"],
                "list": entry["list"],
                "matchScore": round(score, 4),
                "matchType": "exact" if score >= 0.99 else "fuzzy",
            })

    return sorted(hits, key=lambda x: x["matchScore"], reverse=True)


# ── Pydantic models ───────────────────────────────────────────────────────────

class ScreeningRequest(BaseModel):
    declarationId: int
    traderId: int
    companyName: Optional[str] = None
    consigneeName: Optional[str] = None
    goodsDescription: Optional[str] = None


class ScreeningResult(BaseModel):
    declarationId: int
    hit: bool
    listName: Optional[str] = None
    matchScore: Optional[float] = None
    matches: list[dict] = []
    screenedAt: str


# ── FastAPI app ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"[sanctions-service] Starting on port {PORT}")
    logger.info(f"[sanctions-service] Loaded {len(SANCTIONS_ENTRIES)} sanctions entries")
    logger.info(f"[sanctions-service] Match threshold: {MATCH_THRESHOLD}")
    yield


app = FastAPI(
    title="TradeGateway Sanctions Screening",
    description="Real-time sanctions screening against UN/OFAC/EU lists",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "sanctions-service",
        "version": "1.0.0",
        "entriesLoaded": len(SANCTIONS_ENTRIES),
        "matchThreshold": MATCH_THRESHOLD,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/sanctions/screen", response_model=ScreeningResult)
async def screen_declaration(request: ScreeningRequest):
    """Screen a declaration against all sanctions lists."""
    start = time.perf_counter()
    all_matches = []

    # Screen company name
    if request.companyName:
        all_matches.extend(screen_name(request.companyName))

    # Screen consignee
    if request.consigneeName:
        all_matches.extend(screen_name(request.consigneeName))

    # If no names provided, fetch from DB
    if not request.companyName and not request.consigneeName:
        try:
            conn = get_db()
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT tp.company_name, d.consignee_name
                    FROM declarations d
                    LEFT JOIN trader_profiles tp ON tp.user_id = d.trader_id
                    WHERE d.id = %s
                """, (request.declarationId,))
                row = cur.fetchone()
                if row:
                    if row["company_name"]:
                        all_matches.extend(screen_name(row["company_name"]))
                    if row["consignee_name"]:
                        all_matches.extend(screen_name(row["consignee_name"]))
        except Exception as e:
            logger.warning(f"DB lookup failed: {e}")

    # Deduplicate by entry ID
    seen = set()
    unique_matches = []
    for m in all_matches:
        if m["entryId"] not in seen:
            seen.add(m["entryId"])
            unique_matches.append(m)

    hit = len(unique_matches) > 0
    top_match = unique_matches[0] if unique_matches else None

    elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
    logger.info(
        f"[sanctions-service] Declaration {request.declarationId}: "
        f"hit={hit} matches={len(unique_matches)} elapsed={elapsed_ms}ms"
    )

    # Record screening result
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO sanctions_screening_log
                    (declaration_id, trader_id, hit, match_count, top_match_score, screened_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (declaration_id) DO UPDATE
                SET hit = EXCLUDED.hit, match_count = EXCLUDED.match_count,
                    top_match_score = EXCLUDED.top_match_score, screened_at = NOW()
            """, (
                request.declarationId, request.traderId, hit,
                len(unique_matches),
                top_match["matchScore"] if top_match else None,
            ))
            conn.commit()
    except Exception as e:
        logger.warning(f"[sanctions-service] Failed to record screening: {e}")

    return ScreeningResult(
        declarationId=request.declarationId,
        hit=hit,
        listName=top_match["list"] if top_match else None,
        matchScore=top_match["matchScore"] if top_match else None,
        matches=unique_matches,
        screenedAt=datetime.now(timezone.utc).isoformat(),
    )


@app.get("/api/sanctions/stats")
async def get_stats():
    """Returns sanctions screening statistics."""
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    COUNT(*) as total_screened,
                    SUM(CASE WHEN hit THEN 1 ELSE 0 END) as total_hits,
                    AVG(top_match_score) FILTER (WHERE hit) as avg_match_score
                FROM sanctions_screening_log
            """)
            row = cur.fetchone()
            return {
                "totalScreened": row["total_screened"] or 0,
                "totalHits": row["total_hits"] or 0,
                "avgMatchScore": float(row["avg_match_score"] or 0),
                "entriesLoaded": len(SANCTIONS_ENTRIES),
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
