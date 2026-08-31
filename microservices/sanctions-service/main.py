"""
sanctions-service — TradeGateway NGSWTP (SW-8/SW-M6 remediated)
Screens traders and consignees against the REAL public sanctions lists
loaded at boot (see list_loader.py):
  - OFAC SDN List (CSV)            — when loaded
  - UN Security Council Consolidated List (XML) — when loaded
Only lists that ACTUALLY loaded are claimed (see /health listsLoaded).
Screening REFUSES (503) when no list is available or lists are stale —
a screening service without lists must never answer "clear".

Uses fuzzy matching (Jaro-Winkler) with configurable match threshold.
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

from list_loader import SanctionsListRegistry, build_registry_from_env

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [sanctions-service] %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "")  # no default with credentials (SW-S2-4)
PORT = int(os.getenv("PORT", "8087"))
MATCH_THRESHOLD = float(os.getenv("MATCH_THRESHOLD", "0.85"))
MAX_LIST_AGE_HOURS = float(os.getenv("SANCTIONS_MAX_AGE_HOURS", "24"))

# ── Real sanctions lists (SW-8) — the 5-name hardcoded stub was REMOVED. ──────
LIST_REGISTRY = SanctionsListRegistry()

# ── Database ──────────────────────────────────────────────────────────────────
_db_conn: Optional[psycopg2.extensions.connection] = None


def get_db():
    global _db_conn
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured")
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
    """Screen a name against every REAL loaded sanctions list."""
    normalized = normalize(name)
    hits = []

    for entry in LIST_REGISTRY.all_entries():
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
    loaded = build_registry_from_env()
    LIST_REGISTRY._lists = loaded._lists
    LIST_REGISTRY._errors = loaded._errors
    status = LIST_REGISTRY.status()
    logger.info(f"[sanctions-service] Lists loaded: {status['listsLoaded']} version={status['listVersion']}")
    if status["loadErrors"]:
        logger.error(f"[sanctions-service] List load errors (fail closed for missing lists): {status['loadErrors']}")
    if not LIST_REGISTRY.is_available():
        logger.error("[sanctions-service] NO sanctions lists available — screening endpoints will return 503")
    logger.info(f"[sanctions-service] Match threshold: {MATCH_THRESHOLD}")
    yield


app = FastAPI(
    title="TradeGateway Sanctions Screening",
    description="Sanctions screening against the real OFAC SDN and UN SC consolidated lists actually loaded at boot (see /health)",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health():
    available = LIST_REGISTRY.is_available()
    return {
        "status": "ok" if available else "degraded",
        "service": "sanctions-service",
        "version": "2.0.0",
        "screeningAvailable": available,
        "matchThreshold": MATCH_THRESHOLD,
        **LIST_REGISTRY.status(),
        "time": datetime.now(timezone.utc).isoformat(),
    }


def _require_screening_available():
    """Fail closed: no screening without real, fresh lists (SW-8)."""
    if not LIST_REGISTRY.is_available():
        raise HTTPException(
            status_code=503,
            detail={
                "error": "SCREENING_UNAVAILABLE",
                "reason": "no_sanctions_lists_loaded",
                "loadErrors": LIST_REGISTRY.errors,
                "action": "route to manual review — do NOT treat as clear",
            },
        )
    if LIST_REGISTRY.is_stale(MAX_LIST_AGE_HOURS):
        raise HTTPException(
            status_code=503,
            detail={
                "error": "SCREENING_UNAVAILABLE",
                "reason": f"sanctions_lists_stale (older than {MAX_LIST_AGE_HOURS}h)",
                "listVersion": LIST_REGISTRY.list_version(),
                "action": "route to manual review — do NOT treat as clear",
            },
        )


@app.post("/api/sanctions/screen", response_model=ScreeningResult)
async def screen_declaration(request: ScreeningRequest):
    """Screen a declaration against the real loaded sanctions lists."""
    _require_screening_available()
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
            # SW-8: a failed DB lookup must NEVER silently become hit:false —
            # that is how sanctioned entities get cleared. Fail the request.
            logger.error(f"DB lookup failed — refusing to screen without entity names: {e}")
            raise HTTPException(
                status_code=500,
                detail={"error": "ENTITY_LOOKUP_FAILED", "reason": str(e),
                        "action": "route to manual review — do NOT treat as clear"},
            )

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

    # Record screening result WITH the exact list version screened against.
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
    list_version = LIST_REGISTRY.list_version()
    logger.info(f"[sanctions-service] list_version={list_version} declaration={request.declarationId}")

    return ScreeningResult(
        declarationId=request.declarationId,
        hit=hit,
        listName=top_match["list"] if top_match else None,
        matchScore=top_match["matchScore"] if top_match else None,
        matches=[{**m, "listVersion": list_version} for m in unique_matches],
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
                "entriesLoaded": sum(LIST_REGISTRY.status()["entryCounts"].values()),
                "listVersion": LIST_REGISTRY.list_version(),
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
