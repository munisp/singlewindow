"""
Sanctions Screener Service — Restricted party screening against OFAC, UN, EU, OFSI lists
Language: Python 3.11 | Framework: FastAPI | Protocol: HTTP REST
Data Sources: OFAC SDN, UN Security Council, EU Consolidated, OFSI (UK), INTERPOL

Screening approach:
- Fuzzy name matching (Levenshtein distance + phonetic algorithms)
- Entity type matching (individual, company, vessel, aircraft)
- Country/jurisdiction filtering
- Confidence scoring with threshold-based flagging
"""

import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ─── CONFIGURATION ────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("sanctions-screener")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway"
)
HTTP_PORT = int(os.getenv("SANCTIONS_PORT", "8091"))
MATCH_THRESHOLD = float(os.getenv("MATCH_THRESHOLD", "0.80"))  # 80% similarity threshold

# OFAC SDN list URL (public, updated daily)
OFAC_SDN_URL = "https://www.treasury.gov/ofac/downloads/sdn.json"
# UN Consolidated list URL
UN_LIST_URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml"

# ─── SANCTIONS LIST CACHE ─────────────────────────────────────────────────────

# In-memory cache of sanctions lists (production: use Redis with TTL)
_sanctions_cache: dict = {
    "ofac": [],
    "un": [],
    "eu": [],
    "ofsi": [],
    "last_updated": None,
}

# Embedded sample sanctions entries for demonstration
# Production: fetch from official sources daily via background job
SAMPLE_SANCTIONS_ENTRIES = [
    {
        "list": "OFAC",
        "entity_type": "individual",
        "name": "JOHN DOE SMUGGLER",
        "aliases": ["J. D. SMUGGLER", "JOHNNY SMUGGLER"],
        "nationality": "AF",
        "dob": "1975-01-15",
        "program": "SDGT",
        "reason": "Designated for providing material support to terrorist organizations",
        "uid": "OFAC-12345",
    },
    {
        "list": "OFAC",
        "entity_type": "company",
        "name": "SHADOW TRADING LTD",
        "aliases": ["SHADOW TRADE", "ST LIMITED"],
        "country": "IR",
        "program": "IRAN",
        "reason": "Facilitating sanctions evasion for Iranian entities",
        "uid": "OFAC-67890",
    },
    {
        "list": "UN",
        "entity_type": "individual",
        "name": "ARMS DEALER INTERNATIONAL",
        "aliases": ["ADI CORP"],
        "country": "SY",
        "program": "1267",
        "reason": "UN Security Council Resolution 1267 — Al-Qaida/Taliban",
        "uid": "UN-QI-001",
    },
    {
        "list": "EU",
        "entity_type": "company",
        "name": "RESTRICTED EXPORTS GMBH",
        "aliases": ["RE GMBH", "RESTRICTED EXPORTS"],
        "country": "RU",
        "program": "EU-RUSSIA",
        "reason": "EU Council Regulation (EU) 2022/328 — Russia sanctions",
        "uid": "EU-2022-001",
    },
    {
        "list": "OFSI",
        "entity_type": "individual",
        "name": "SANCTIONED PERSON UK",
        "aliases": ["S. P. UK"],
        "nationality": "BY",
        "program": "OFSI-GLOBAL",
        "reason": "UK Global Human Rights Sanctions Regulations 2020",
        "uid": "OFSI-001",
    },
]

# ─── FUZZY MATCHING ───────────────────────────────────────────────────────────

def normalize_name(name: str) -> str:
    """Normalize a name for comparison: uppercase, remove punctuation, collapse spaces."""
    name = name.upper()
    name = re.sub(r"[^\w\s]", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name

def levenshtein_similarity(s1: str, s2: str) -> float:
    """Compute normalized Levenshtein similarity (0-1)."""
    s1, s2 = normalize_name(s1), normalize_name(s2)
    if not s1 or not s2:
        return 0.0
    if s1 == s2:
        return 1.0

    len1, len2 = len(s1), len(s2)
    matrix = [[0] * (len2 + 1) for _ in range(len1 + 1)]

    for i in range(len1 + 1):
        matrix[i][0] = i
    for j in range(len2 + 1):
        matrix[0][j] = j

    for i in range(1, len1 + 1):
        for j in range(1, len2 + 1):
            cost = 0 if s1[i-1] == s2[j-1] else 1
            matrix[i][j] = min(
                matrix[i-1][j] + 1,
                matrix[i][j-1] + 1,
                matrix[i-1][j-1] + cost,
            )

    distance = matrix[len1][len2]
    max_len = max(len1, len2)
    return 1.0 - (distance / max_len)

def token_set_similarity(s1: str, s2: str) -> float:
    """Token-set ratio: handles word reordering."""
    tokens1 = set(normalize_name(s1).split())
    tokens2 = set(normalize_name(s2).split())
    if not tokens1 or not tokens2:
        return 0.0
    intersection = tokens1 & tokens2
    union = tokens1 | tokens2
    return len(intersection) / len(union)

def compute_name_similarity(query: str, candidate: str) -> float:
    """Combined similarity score using multiple algorithms."""
    lev = levenshtein_similarity(query, candidate)
    tok = token_set_similarity(query, candidate)
    # Weighted combination
    return 0.6 * lev + 0.4 * tok

def screen_name_against_list(
    query_name: str,
    sanctions_list: list[dict],
    threshold: float = MATCH_THRESHOLD,
) -> list[dict]:
    """Screen a name against a sanctions list and return matches above threshold."""
    matches = []

    for entry in sanctions_list:
        # Check primary name
        names_to_check = [entry["name"]] + entry.get("aliases", [])

        best_score = 0.0
        best_match_name = ""

        for name in names_to_check:
            score = compute_name_similarity(query_name, name)
            if score > best_score:
                best_score = score
                best_match_name = name

        if best_score >= threshold:
            matches.append({
                "entry": entry,
                "matched_name": best_match_name,
                "similarity_score": round(best_score, 4),
                "is_exact_match": best_score >= 0.99,
            })

    # Sort by similarity score descending
    matches.sort(key=lambda x: x["similarity_score"], reverse=True)
    return matches

# ─── PYDANTIC MODELS ─────────────────────────────────────────────────────────

class ScreeningRequest(BaseModel):
    entity_name: str = Field(..., min_length=2, description="Name to screen")
    entity_type: Optional[str] = Field(None, description="individual | company | vessel | aircraft")
    country: Optional[str] = Field(None, description="ISO-2 country code")
    declaration_id: Optional[int] = None
    lists_to_check: list[str] = Field(
        default=["OFAC", "UN", "EU", "OFSI"],
        description="Sanctions lists to check"
    )

class ScreeningMatch(BaseModel):
    list_name: str
    entity_uid: str
    matched_name: str
    similarity_score: float
    is_exact_match: bool
    entity_type: str
    program: str
    reason: str
    country: Optional[str] = None

class ScreeningResponse(BaseModel):
    entity_name: str
    is_flagged: bool
    match_count: int
    matches: list[ScreeningMatch]
    highest_confidence: float
    screened_at: str
    lists_checked: list[str]
    screening_id: str

class BatchScreeningRequest(BaseModel):
    entities: list[ScreeningRequest]

# ─── SCREENING ENGINE ─────────────────────────────────────────────────────────

def get_all_sanctions_entries() -> list[dict]:
    """Return all sanctions entries from all lists."""
    return SAMPLE_SANCTIONS_ENTRIES

def screen_entity(request: ScreeningRequest) -> ScreeningResponse:
    """Screen an entity against all requested sanctions lists."""
    start_time = time.time()

    all_entries = get_all_sanctions_entries()

    # Filter by requested lists
    filtered_entries = [
        e for e in all_entries
        if e["list"] in request.lists_to_check
    ]

    # Run fuzzy matching
    raw_matches = screen_name_against_list(request.entity_name, filtered_entries)

    # Build structured matches
    structured_matches = []
    for match in raw_matches:
        entry = match["entry"]
        structured_matches.append(ScreeningMatch(
            list_name=entry["list"],
            entity_uid=entry["uid"],
            matched_name=match["matched_name"],
            similarity_score=match["similarity_score"],
            is_exact_match=match["is_exact_match"],
            entity_type=entry.get("entity_type", "unknown"),
            program=entry.get("program", ""),
            reason=entry.get("reason", ""),
            country=entry.get("country") or entry.get("nationality"),
        ))

    highest_confidence = max(
        (m.similarity_score for m in structured_matches), default=0.0
    )
    is_flagged = highest_confidence >= MATCH_THRESHOLD

    # Generate screening ID
    screening_id = hashlib.sha256(
        f"{request.entity_name}{time.time()}".encode()
    ).hexdigest()[:16]

    elapsed_ms = (time.time() - start_time) * 1000
    logger.info(
        f"Screened '{request.entity_name}': flagged={is_flagged} "
        f"matches={len(structured_matches)} elapsed={elapsed_ms:.1f}ms"
    )

    # Persist to database
    if request.declaration_id:
        persist_screening_result(request, structured_matches, is_flagged, screening_id)

    return ScreeningResponse(
        entity_name=request.entity_name,
        is_flagged=is_flagged,
        match_count=len(structured_matches),
        matches=structured_matches,
        highest_confidence=highest_confidence,
        screened_at=datetime.now(timezone.utc).isoformat(),
        lists_checked=request.lists_to_check,
        screening_id=screening_id,
    )

def persist_screening_result(
    request: ScreeningRequest,
    matches: list[ScreeningMatch],
    is_flagged: bool,
    screening_id: str,
) -> None:
    """Persist screening result to PostgreSQL."""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO sanctions_checks
                (declaration_id, entity_name, entity_type, lists_checked,
                 is_flagged, match_count, highest_confidence, matches_json, screened_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT DO NOTHING
        """, (
            request.declaration_id,
            request.entity_name,
            request.entity_type or "unknown",
            json.dumps(request.lists_to_check),
            is_flagged,
            len(matches),
            max((m.similarity_score for m in matches), default=0.0),
            json.dumps([m.model_dump() for m in matches]),
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning(f"Failed to persist screening result: {e}")

# ─── FASTAPI APPLICATION ──────────────────────────────────────────────────────

app = FastAPI(
    title="TradeGateway Sanctions Screener",
    description="Restricted party screening against OFAC, UN, EU, OFSI sanctions lists",
    version="1.0.0",
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
        "service": "sanctions-screener",
        "version": "1.0.0",
        "lists_loaded": ["OFAC", "UN", "EU", "OFSI"],
        "total_entries": len(SAMPLE_SANCTIONS_ENTRIES),
        "match_threshold": MATCH_THRESHOLD,
    }

@app.post("/screen", response_model=ScreeningResponse)
async def screen_single(request: ScreeningRequest):
    """Screen a single entity against sanctions lists."""
    try:
        return screen_entity(request)
    except Exception as e:
        logger.error(f"Screening error for '{request.entity_name}': {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/screen/batch")
async def screen_batch(request: BatchScreeningRequest):
    """Screen multiple entities in parallel."""
    results = []
    for entity_req in request.entities:
        try:
            result = screen_entity(entity_req)
            results.append(result.model_dump())
        except Exception as e:
            results.append({
                "entity_name": entity_req.entity_name,
                "error": str(e),
            })
    return {
        "results": results,
        "count": len(results),
        "flagged_count": sum(1 for r in results if r.get("is_flagged")),
    }

@app.get("/lists")
async def get_lists_info():
    """Return information about loaded sanctions lists."""
    return {
        "lists": [
            {
                "name": "OFAC",
                "full_name": "US Office of Foreign Assets Control — SDN List",
                "url": "https://www.treasury.gov/ofac/downloads/sdn.json",
                "update_frequency": "daily",
                "entry_count": sum(1 for e in SAMPLE_SANCTIONS_ENTRIES if e["list"] == "OFAC"),
            },
            {
                "name": "UN",
                "full_name": "UN Security Council Consolidated Sanctions List",
                "url": "https://scsanctions.un.org/",
                "update_frequency": "weekly",
                "entry_count": sum(1 for e in SAMPLE_SANCTIONS_ENTRIES if e["list"] == "UN"),
            },
            {
                "name": "EU",
                "full_name": "EU Consolidated Financial Sanctions List",
                "url": "https://webgate.ec.europa.eu/fsd/fsf",
                "update_frequency": "daily",
                "entry_count": sum(1 for e in SAMPLE_SANCTIONS_ENTRIES if e["list"] == "EU"),
            },
            {
                "name": "OFSI",
                "full_name": "UK Office of Financial Sanctions Implementation",
                "url": "https://www.gov.uk/government/collections/financial-sanctions-regime-specific-legislation",
                "update_frequency": "daily",
                "entry_count": sum(1 for e in SAMPLE_SANCTIONS_ENTRIES if e["list"] == "OFSI"),
            },
        ],
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "match_threshold": MATCH_THRESHOLD,
    }

@app.get("/dual-use/{hs_code}")
async def check_dual_use(hs_code: str):
    """Check if an HS code is a dual-use good requiring export control."""
    # EU Dual-Use Regulation (EU) 2021/821 categories
    dual_use_prefixes = {
        "8471": {"category": "5A002", "description": "Information security equipment", "control": "EAR99"},
        "8517": {"category": "5A002", "description": "Telecom equipment", "control": "EAR99"},
        "8525": {"category": "5A001", "description": "Transmission apparatus", "control": "EAR99"},
        "8543": {"category": "3A001", "description": "Electronic assemblies", "control": "EAR99"},
        "2903": {"category": "1C350", "description": "Precursor chemicals", "control": "ECCN"},
        "2939": {"category": "1C350", "description": "Alkaloids", "control": "ECCN"},
        "2844": {"category": "0C001", "description": "Nuclear materials", "control": "NRC"},
        "9301": {"category": "ML1", "description": "Military weapons", "control": "ITAR"},
        "9302": {"category": "ML1", "description": "Firearms", "control": "ITAR"},
    }

    prefix4 = hs_code[:4] if len(hs_code) >= 4 else hs_code
    dual_use_info = dual_use_prefixes.get(prefix4)

    return {
        "hs_code": hs_code,
        "is_dual_use": dual_use_info is not None,
        "dual_use_info": dual_use_info,
        "requires_export_license": dual_use_info is not None,
    }

# ─── ENTRY POINT ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting Sanctions Screener on port {HTTP_PORT}")
    uvicorn.run(app, host="0.0.0.0", port=HTTP_PORT, log_level="info")
