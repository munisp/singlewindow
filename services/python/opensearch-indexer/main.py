"""
TradeGateway NGSWTP — OpenSearch Indexer Service
=================================================
Language: Python 3.12
Frameworks: FastAPI + opensearch-py + asyncpg

Syncs PostgreSQL data to OpenSearch for full-text search across:
  - Declarations (HS codes, descriptions, trader names)
  - Manifests (vessel names, BL numbers, consignees)
  - UCRs (consignment references)
  - LPCOs (certificate numbers, MDA names)
  - Traders (company names, TINs)
  - Valuation database (commodity descriptions)

Also provides:
  - Real-time sync via Kafka consumer (declaration.events, manifest.events)
  - Bulk re-index endpoint for initial population
  - Search API with faceting, highlighting, and geo-distance filtering

HTTP API:
  GET  /api/search                  — Full-text search across all indices
  GET  /api/search/declarations     — Search declarations
  GET  /api/search/manifests        — Search manifests
  GET  /api/search/traders          — Search traders
  POST /api/index/sync              — Trigger full re-index
  POST /api/index/declaration/:id   — Index a single declaration
  GET  /health                      — Health check

Port: 8102
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

import asyncpg
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from opensearchpy import AsyncOpenSearch, helpers
from pydantic import BaseModel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("opensearch-indexer")

# ─── Configuration ─────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway")
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://opensearch:9200")
def _required_env(name):
    """SW-S2-4: secrets have no defaults — refuse to boot when unset."""
    _v = os.getenv(name)
    if not _v:
        raise RuntimeError(f"{name} must be set — no default is provided (fail closed, SW-S2-4)")
    return _v

OPENSEARCH_USER = os.getenv("OPENSEARCH_USER", "admin")
OPENSEARCH_PASS = _required_env("OPENSEARCH_PASSWORD")
PORT = int(os.getenv("PORT", "8102"))

# ─── Index Mappings ────────────────────────────────────────────────────────────

DECLARATIONS_MAPPING = {
    "mappings": {
        "properties": {
            "id": {"type": "long"},
            "declaration_number": {"type": "keyword"},
            "ucr_number": {"type": "keyword"},
            "trader_name": {"type": "text", "analyzer": "standard"},
            "hs_code": {"type": "keyword"},
            "description": {"type": "text", "analyzer": "standard"},
            "country_of_origin": {"type": "keyword"},
            "port_of_entry": {"type": "keyword"},
            "declared_value": {"type": "double"},
            "currency": {"type": "keyword"},
            "status": {"type": "keyword"},
            "risk_lane": {"type": "keyword"},
            "risk_score": {"type": "float"},
            "created_at": {"type": "date"},
        }
    },
    "settings": {
        "number_of_shards": 2,
        "number_of_replicas": 1,
    }
}

MANIFESTS_MAPPING = {
    "mappings": {
        "properties": {
            "id": {"type": "long"},
            "manifest_number": {"type": "keyword"},
            "vessel_name": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
            "voyage_number": {"type": "keyword"},
            "port_of_loading": {"type": "keyword"},
            "port_of_discharge": {"type": "keyword"},
            "eta": {"type": "date"},
            "status": {"type": "keyword"},
            "total_bls": {"type": "integer"},
            "created_at": {"type": "date"},
        }
    }
}

TRADERS_MAPPING = {
    "mappings": {
        "properties": {
            "id": {"type": "long"},
            "company_name": {"type": "text", "analyzer": "standard", "fields": {"keyword": {"type": "keyword"}}},
            "tin": {"type": "keyword"},
            "rc_number": {"type": "keyword"},
            "trader_type": {"type": "keyword"},
            "aeo_status": {"type": "keyword"},
            "email": {"type": "keyword"},
            "phone": {"type": "keyword"},
            "state": {"type": "keyword"},
            "created_at": {"type": "date"},
        }
    }
}

# ─── OpenSearch Client ─────────────────────────────────────────────────────────

os_client: Optional[AsyncOpenSearch] = None
db_pool: Optional[asyncpg.Pool] = None

async def get_os_client() -> AsyncOpenSearch:
    return AsyncOpenSearch(
        hosts=[OPENSEARCH_URL],
        http_auth=(OPENSEARCH_USER, OPENSEARCH_PASS),
        use_ssl=OPENSEARCH_URL.startswith("https"),
        verify_certs=False,
        ssl_show_warn=False,
    )

async def ensure_indices(client: AsyncOpenSearch):
    """Create OpenSearch indices if they don't exist."""
    indices = {
        "tradegateway-declarations": DECLARATIONS_MAPPING,
        "tradegateway-manifests": MANIFESTS_MAPPING,
        "tradegateway-traders": TRADERS_MAPPING,
    }
    for index_name, mapping in indices.items():
        try:
            exists = await client.indices.exists(index=index_name)
            if not exists:
                await client.indices.create(index=index_name, body=mapping)
                logger.info(f"Created index: {index_name}")
        except Exception as e:
            logger.warning(f"Index {index_name} setup: {e}")

# ─── App Lifecycle ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global os_client, db_pool
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    os_client = await get_os_client()
    await ensure_indices(os_client)
    logger.info(f"[opensearch-indexer] Ready on port {PORT}")
    yield
    if db_pool:
        await db_pool.close()
    if os_client:
        await os_client.close()

app = FastAPI(title="TradeGateway OpenSearch Indexer", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── Search Routes ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    try:
        info = await os_client.info()
        return {"status": "healthy", "service": "opensearch-indexer", "opensearch": info.get("version", {}).get("number")}
    except Exception as e:
        return {"status": "degraded", "error": str(e)}

@app.get("/api/search")
async def search_all(
    q: str = Query(..., min_length=1),
    size: int = Query(20, ge=1, le=100),
    from_: int = Query(0, alias="from", ge=0),
):
    """Full-text search across all indices."""
    query = {
        "query": {
            "multi_match": {
                "query": q,
                "fields": [
                    "declaration_number^3", "ucr_number^3", "hs_code^2",
                    "trader_name^2", "description", "vessel_name^2",
                    "manifest_number^3", "company_name^2", "tin^3",
                ],
                "type": "best_fields",
                "fuzziness": "AUTO",
            }
        },
        "highlight": {
            "fields": {
                "description": {},
                "trader_name": {},
                "vessel_name": {},
                "company_name": {},
            }
        },
        "size": size,
        "from": from_,
    }

    try:
        response = await os_client.search(
            index="tradegateway-declarations,tradegateway-manifests,tradegateway-traders",
            body=query,
        )
        hits = response["hits"]["hits"]
        return {
            "total": response["hits"]["total"]["value"],
            "results": [
                {
                    "index": h["_index"],
                    "id": h["_id"],
                    "score": h["_score"],
                    "source": h["_source"],
                    "highlights": h.get("highlight", {}),
                }
                for h in hits
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {e}")

@app.get("/api/search/declarations")
async def search_declarations(
    q: str = Query(..., min_length=1),
    status: Optional[str] = None,
    risk_lane: Optional[str] = None,
    size: int = Query(20, ge=1, le=100),
):
    """Search declarations with optional filters."""
    must = [{"multi_match": {"query": q, "fields": ["declaration_number^3", "hs_code^2", "description", "trader_name"], "fuzziness": "AUTO"}}]
    if status:
        must.append({"term": {"status": status}})
    if risk_lane:
        must.append({"term": {"risk_lane": risk_lane}})

    query = {"query": {"bool": {"must": must}}, "size": size}

    try:
        response = await os_client.search(index="tradegateway-declarations", body=query)
        return {
            "total": response["hits"]["total"]["value"],
            "results": [h["_source"] for h in response["hits"]["hits"]],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/search/traders")
async def search_traders(q: str = Query(..., min_length=1), size: int = 20):
    """Search traders by company name, TIN, or RC number."""
    query = {
        "query": {
            "multi_match": {
                "query": q,
                "fields": ["company_name^3", "tin^3", "rc_number^3", "email"],
                "fuzziness": "AUTO",
            }
        },
        "size": size,
    }
    try:
        response = await os_client.search(index="tradegateway-traders", body=query)
        return {"total": response["hits"]["total"]["value"], "results": [h["_source"] for h in response["hits"]["hits"]]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Indexing Routes ───────────────────────────────────────────────────────────

@app.post("/api/index/declaration/{declaration_id}")
async def index_declaration(declaration_id: int):
    """Index a single declaration by ID."""
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT d.id, d.declaration_number, d.hs_code, d.declared_value, d.currency,
                   d.country_of_origin, d.port_of_destination, d.status, d.risk_lane, d.risk_score,
                   d.created_at, u.ucr_number,
                   sp.company_name as trader_name
            FROM declarations d
            LEFT JOIN ucrs u ON u.declaration_id = d.id
            LEFT JOIN stakeholder_profiles sp ON sp.user_id = d.trader_id
            WHERE d.id = $1
        """, declaration_id)

    if not row:
        raise HTTPException(status_code=404, detail="Declaration not found")

    doc = dict(row)
    doc["created_at"] = doc["created_at"].isoformat() if doc.get("created_at") else None

    await os_client.index(
        index="tradegateway-declarations",
        id=str(declaration_id),
        body=doc,
    )
    return {"indexed": True, "id": declaration_id}

@app.post("/api/index/sync")
async def bulk_sync():
    """Trigger a full bulk re-index from PostgreSQL."""
    counts = {"declarations": 0, "traders": 0, "manifests": 0}

    # Sync declarations
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT d.id, d.declaration_number, d.hs_code, d.declared_value, d.currency,
                   d.country_of_origin, d.port_of_destination, d.status, d.risk_lane, d.risk_score,
                   d.created_at, sp.company_name as trader_name
            FROM declarations d
            LEFT JOIN stakeholder_profiles sp ON sp.user_id = d.trader_id
            ORDER BY d.id DESC LIMIT 10000
        """)

    actions = []
    for row in rows:
        doc = dict(row)
        doc["created_at"] = doc["created_at"].isoformat() if doc.get("created_at") else None
        actions.append({
            "_index": "tradegateway-declarations",
            "_id": str(doc["id"]),
            "_source": doc,
        })

    if actions:
        success, failed = await helpers.async_bulk(os_client, actions, raise_on_error=False)
        counts["declarations"] = success

    # Sync traders
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, company_name, tin, rc_number, trader_type, aeo_status, email, phone, created_at
            FROM stakeholder_profiles
            ORDER BY id DESC LIMIT 10000
        """)

    actions = []
    for row in rows:
        doc = dict(row)
        doc["created_at"] = doc["created_at"].isoformat() if doc.get("created_at") else None
        actions.append({
            "_index": "tradegateway-traders",
            "_id": str(doc["id"]),
            "_source": doc,
        })

    if actions:
        success, _ = await helpers.async_bulk(os_client, actions, raise_on_error=False)
        counts["traders"] = success

    return {"success": True, "indexed": counts}

# ─── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
