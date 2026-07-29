"""
TradeGateway NGSWTP — HS Code Classifier Service
Language: Python 3.11
Framework: FastAPI
Role: Classifies goods descriptions to WCO Harmonised System (HS) codes.
      Uses a combination of:
      1. LLM-based classification (via Ollama/Qwen2.5) for natural language descriptions
      2. Keyword-based rule engine for common goods categories
      3. Fuzzy matching against WCO HS nomenclature database

Integration:
  - Calls Ollama proxy for LLM-based classification
  - Caches results in Redis (TTL: 24 hours — HS codes are stable)
  - Reports metrics to Prometheus

Port: 8093 (HTTP)
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import httpx
import redis
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from pydantic import BaseModel, Field

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("hs-classifier")

# ─── Configuration ────────────────────────────────────────────────────────────
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
PORT = int(os.getenv("PORT", "8093"))
CACHE_TTL = int(os.getenv("CACHE_TTL", "86400"))  # 24 hours

# ─── Prometheus Metrics ───────────────────────────────────────────────────────
REQUESTS_TOTAL = Counter("hs_classifier_requests_total", "Total HS classification requests", ["source"])
CLASSIFICATION_DURATION = Histogram(
    "hs_classifier_duration_seconds",
    "HS classification duration",
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0],
)

# ─── WCO Chapter descriptions ─────────────────────────────────────────────────
WCO_CHAPTERS = {
    "01": "Live animals",
    "02": "Meat and edible meat offal",
    "03": "Fish and crustaceans",
    "04": "Dairy produce; birds' eggs; natural honey",
    "05": "Products of animal origin, NES",
    "06": "Live trees and other plants",
    "07": "Edible vegetables and certain roots and tubers",
    "08": "Edible fruit and nuts",
    "09": "Coffee, tea, maté and spices",
    "10": "Cereals",
    "11": "Products of the milling industry",
    "12": "Oil seeds and oleaginous fruits",
    "13": "Lac; gums, resins and other vegetable saps",
    "14": "Vegetable plaiting materials",
    "15": "Animal or vegetable fats and oils",
    "16": "Preparations of meat, fish or crustaceans",
    "17": "Sugars and sugar confectionery",
    "18": "Cocoa and cocoa preparations",
    "19": "Preparations of cereals, flour, starch or milk",
    "20": "Preparations of vegetables, fruit, nuts",
    "21": "Miscellaneous edible preparations",
    "22": "Beverages, spirits and vinegar",
    "23": "Residues and waste from the food industries",
    "24": "Tobacco and manufactured tobacco substitutes",
    "25": "Salt; sulphur; earths and stone",
    "26": "Ores, slag and ash",
    "27": "Mineral fuels, mineral oils and products",
    "28": "Inorganic chemicals",
    "29": "Organic chemicals",
    "30": "Pharmaceutical products",
    "31": "Fertilisers",
    "32": "Tanning or dyeing extracts",
    "33": "Essential oils and resinoids; perfumery",
    "34": "Soap, organic surface-active agents",
    "35": "Albuminoidal substances; modified starches; glues",
    "36": "Explosives; pyrotechnic products",
    "37": "Photographic or cinematographic goods",
    "38": "Miscellaneous chemical products",
    "39": "Plastics and articles thereof",
    "40": "Rubber and articles thereof",
    "41": "Raw hides and skins and leather",
    "42": "Articles of leather; saddlery and harness",
    "43": "Furskins and artificial fur",
    "44": "Wood and articles of wood",
    "45": "Cork and articles of cork",
    "46": "Manufactures of straw, esparto or other plaiting materials",
    "47": "Pulp of wood or of other fibrous cellulosic material",
    "48": "Paper and paperboard",
    "49": "Printed books, newspapers, pictures",
    "50": "Silk",
    "51": "Wool, fine or coarse animal hair",
    "52": "Cotton",
    "53": "Other vegetable textile fibres",
    "54": "Man-made filaments",
    "55": "Man-made staple fibres",
    "56": "Wadding, felt and nonwovens",
    "57": "Carpets and other textile floor coverings",
    "58": "Special woven fabrics",
    "59": "Impregnated, coated, covered or laminated textile fabrics",
    "60": "Knitted or crocheted fabrics",
    "61": "Articles of apparel and clothing accessories, knitted or crocheted",
    "62": "Articles of apparel and clothing accessories, not knitted or crocheted",
    "63": "Other made-up textile articles",
    "64": "Footwear, gaiters and the like",
    "65": "Headgear and parts thereof",
    "66": "Umbrellas, sun umbrellas, walking-sticks",
    "67": "Prepared feathers and down",
    "68": "Articles of stone, plaster, cement, asbestos, mica",
    "69": "Ceramic products",
    "70": "Glass and glassware",
    "71": "Natural or cultured pearls, precious or semi-precious stones",
    "72": "Iron and steel",
    "73": "Articles of iron or steel",
    "74": "Copper and articles thereof",
    "75": "Nickel and articles thereof",
    "76": "Aluminium and articles thereof",
    "78": "Lead and articles thereof",
    "79": "Zinc and articles thereof",
    "80": "Tin and articles thereof",
    "81": "Other base metals; cermets; articles thereof",
    "82": "Tools, implements, cutlery, spoons and forks",
    "83": "Miscellaneous articles of base metal",
    "84": "Nuclear reactors, boilers, machinery and mechanical appliances",
    "85": "Electrical machinery and equipment",
    "86": "Railway or tramway locomotives, rolling-stock",
    "87": "Vehicles other than railway or tramway rolling-stock",
    "88": "Aircraft, spacecraft, and parts thereof",
    "89": "Ships, boats and floating structures",
    "90": "Optical, photographic, cinematographic, measuring instruments",
    "91": "Clocks and watches and parts thereof",
    "92": "Musical instruments",
    "93": "Arms and ammunition; parts and accessories thereof",
    "94": "Furniture; bedding, mattresses, mattress supports",
    "95": "Toys, games and sports requisites",
    "96": "Miscellaneous manufactured articles",
    "97": "Works of art, collectors' pieces and antiques",
    "99": "Special classification provisions",
}

# Keyword-based classification rules (chapter → keywords)
KEYWORD_RULES: list[tuple[str, list[str]]] = [
    ("84", ["laptop", "computer", "server", "processor", "cpu", "motherboard", "hard drive", "ssd"]),
    ("85", ["phone", "smartphone", "tablet", "television", "tv", "monitor", "charger", "battery", "cable", "wire"]),
    ("87", ["car", "vehicle", "truck", "motorcycle", "bus", "automobile", "van"]),
    ("30", ["medicine", "drug", "pharmaceutical", "tablet", "capsule", "injection", "vaccine", "antibiotic"]),
    ("22", ["beer", "wine", "spirits", "whisky", "vodka", "rum", "alcohol", "beverage"]),
    ("24", ["cigarette", "tobacco", "cigar", "vape", "e-cigarette"]),
    ("93", ["gun", "rifle", "pistol", "ammunition", "weapon", "firearm", "bullet"]),
    ("61", ["shirt", "t-shirt", "dress", "trousers", "jeans", "jacket", "coat", "sweater", "blouse"]),
    ("64", ["shoe", "boot", "sandal", "sneaker", "footwear"]),
    ("08", ["apple", "orange", "banana", "mango", "pineapple", "grape", "fruit"]),
    ("07", ["tomato", "onion", "potato", "carrot", "vegetable", "pepper"]),
    ("10", ["rice", "wheat", "maize", "corn", "grain", "cereal"]),
    ("27", ["oil", "petroleum", "diesel", "gasoline", "fuel", "crude", "gas"]),
    ("72", ["steel", "iron", "rebar", "beam", "rod", "pipe"]),
    ("76", ["aluminium", "aluminum"]),
    ("39", ["plastic", "polymer", "polyethylene", "pvc", "polypropylene"]),
    ("94", ["furniture", "chair", "table", "desk", "sofa", "bed", "cabinet"]),
    ("49", ["book", "magazine", "newspaper", "printed", "publication"]),
    ("33", ["perfume", "cosmetic", "cream", "lotion", "shampoo", "soap"]),
]

def classify_by_keywords(description: str) -> Optional[tuple[str, float]]:
    """Classify goods description using keyword matching."""
    desc_lower = description.lower()
    for chapter, keywords in KEYWORD_RULES:
        for kw in keywords:
            if kw in desc_lower:
                return chapter, 0.75
    return None

# ─── Redis client ─────────────────────────────────────────────────────────────
_redis_client: Optional[redis.Redis] = None

def get_redis() -> Optional[redis.Redis]:
    global _redis_client
    if _redis_client is None:
        try:
            _redis_client = redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=2)
            _redis_client.ping()
        except Exception as e:
            logger.warning(f"Redis unavailable: {e}")
            _redis_client = None
    return _redis_client

# ─── Models ───────────────────────────────────────────────────────────────────
class ClassifyRequest(BaseModel):
    description: str = Field(..., min_length=3, max_length=2000)
    country_of_origin: Optional[str] = None
    additional_context: Optional[str] = None

class ClassifyResponse(BaseModel):
    description: str
    hs_code: str
    hs_chapter: str
    chapter_description: str
    confidence: float
    source: str  # "llm" | "keyword" | "cache"
    alternatives: list[dict]
    classified_at: str

# ─── LLM classification ───────────────────────────────────────────────────────
async def classify_via_llm(description: str, context: Optional[str] = None) -> Optional[tuple[str, float]]:
    """Classify goods description using Ollama LLM."""
    system_prompt = """You are a WCO Harmonised System (HS) code expert for customs classification.
Given a goods description, return the most appropriate HS code (6 digits).
Respond with ONLY a JSON object: {"hs_code": "XXXXXX", "confidence": 0.XX, "reasoning": "brief explanation"}
Do not include any other text."""

    user_prompt = f"Classify this goods description: {description}"
    if context:
        user_prompt += f"\nAdditional context: {context}"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json={
                    "model": "qwen2.5:7b",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "stream": False,
                    "options": {"temperature": 0.1, "num_ctx": 2048},
                },
            )
            if res.status_code == 200:
                data = res.json()
                content = data.get("message", {}).get("content", "")
                # Parse JSON from response
                json_match = re.search(r'\{[^}]+\}', content, re.DOTALL)
                if json_match:
                    result = json.loads(json_match.group())
                    hs_code = str(result.get("hs_code", "")).replace(".", "").replace(" ", "")
                    if len(hs_code) >= 4:
                        confidence = float(result.get("confidence", 0.8))
                        return hs_code[:6].ljust(6, "0"), confidence
    except Exception as e:
        logger.warning(f"LLM classification failed: {e}")
    return None

# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("HS Classifier Service starting up...")
    yield
    logger.info("HS Classifier Service shutting down...")

# ─── FastAPI app ──────────────────────────────────────────────────────────────
app = FastAPI(
    title="TradeGateway HS Classifier Service",
    description="WCO Harmonised System code classification",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/healthz")
async def liveness():
    return {"status": "ok", "service": "hs-classifier"}

@app.get("/readyz")
async def readiness():
    return {"status": "ready", "redis": "ok" if get_redis() else "unavailable"}

@app.get("/metrics")
async def metrics():
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.post("/classify", response_model=ClassifyResponse)
async def classify(req: ClassifyRequest):
    start = time.perf_counter()

    # Check cache
    cache_key = f"hs:classify:{hash(req.description.lower())}"
    redis_client = get_redis()
    if redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached:
                REQUESTS_TOTAL.labels(source="cache").inc()
                return json.loads(cached)
        except Exception:
            pass

    # Try keyword classification first (fast)
    hs_code = None
    confidence = 0.0
    source = "keyword"

    keyword_result = classify_by_keywords(req.description)
    if keyword_result:
        chapter, confidence = keyword_result
        hs_code = chapter + "0000"  # Chapter-level code

    # Try LLM for better accuracy
    llm_result = await classify_via_llm(req.description, req.additional_context)
    if llm_result:
        hs_code, confidence = llm_result
        source = "llm"

    if not hs_code:
        # Default to chapter 99 (special provisions) with low confidence
        hs_code = "990000"
        confidence = 0.3
        source = "default"

    chapter = hs_code[:2]
    chapter_description = WCO_CHAPTERS.get(chapter, "Unknown chapter")

    duration_ms = (time.perf_counter() - start) * 1000
    CLASSIFICATION_DURATION.observe(duration_ms / 1000)
    REQUESTS_TOTAL.labels(source=source).inc()

    result = ClassifyResponse(
        description=req.description,
        hs_code=hs_code,
        hs_chapter=chapter,
        chapter_description=chapter_description,
        confidence=round(confidence, 4),
        source=source,
        alternatives=[],
        classified_at=datetime.now(timezone.utc).isoformat(),
    )

    # Cache result
    if redis_client:
        try:
            redis_client.setex(cache_key, CACHE_TTL, result.model_dump_json())
        except Exception:
            pass

    return result

@app.post("/validate")
async def validate_hs_code(hs_code: str):
    """Validate an HS code format and return chapter description."""
    clean = hs_code.replace(".", "").replace(" ", "")
    if not re.match(r"^\d{4,10}$", clean):
        raise HTTPException(status_code=400, detail="Invalid HS code format")

    chapter = clean[:2]
    description = WCO_CHAPTERS.get(chapter)
    if not description:
        raise HTTPException(status_code=404, detail=f"Unknown HS chapter: {chapter}")

    return {
        "hs_code": clean,
        "chapter": chapter,
        "chapter_description": description,
        "valid": True,
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, workers=2, log_config=None)
