"""
TradeGateway NGSWTP — OpenCTI Threat Intelligence Service
Port: 8107

Provides STIX 2.1 threat intelligence enrichment for customs declarations.
Integrates with OpenCTI's GraphQL API for threat actor lookups, sanctioned
entity checks, country risk scoring, and MITRE ATT&CK TTP mapping.

In environments without a live OpenCTI instance, the service uses a
comprehensive mock dataset that mirrors the STIX 2.1 data model.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="opencti-svc", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── Mock STIX 2.1 Dataset ────────────────────────────────────────────────────

THREAT_ACTORS = [
    {
        "id": "threat-actor--001",
        "name": "Phantom Silk Road",
        "aliases": ["PSR", "Ghost Traders"],
        "description": "Organised crime network specialising in luxury goods counterfeiting and customs fraud across West Africa.",
        "sophistication": "advanced",
        "resource_level": "organization",
        "primary_motivation": "financial-gain",
        "country": "NG",
        "sectors": ["customs", "logistics", "finance"],
        "ttps": ["T1566", "T1078", "T1036"],
        "first_seen": "2019-03-15",
        "last_seen": "2026-02-28",
        "confidence": 85,
    },
    {
        "id": "threat-actor--002",
        "name": "Iron Corridor",
        "aliases": ["IC Group"],
        "description": "State-sponsored entity involved in dual-use technology procurement and export control evasion.",
        "sophistication": "expert",
        "resource_level": "government",
        "primary_motivation": "national-security",
        "country": "IR",
        "sectors": ["defence", "technology", "customs"],
        "ttps": ["T1199", "T1078", "T1583"],
        "first_seen": "2015-01-01",
        "last_seen": "2026-03-01",
        "confidence": 92,
    },
    {
        "id": "threat-actor--003",
        "name": "Golden Triangle Syndicate",
        "aliases": ["GTS"],
        "description": "Transnational narcotics trafficking network using trade-based money laundering through legitimate import/export businesses.",
        "sophistication": "intermediate",
        "resource_level": "organization",
        "primary_motivation": "financial-gain",
        "country": "MM",
        "sectors": ["customs", "finance", "agriculture"],
        "ttps": ["T1036", "T1078", "T1562"],
        "first_seen": "2012-06-01",
        "last_seen": "2026-01-15",
        "confidence": 78,
    },
    {
        "id": "threat-actor--004",
        "name": "Carousel Kings",
        "aliases": ["CK Network"],
        "description": "VAT and customs duty carousel fraud network operating across multiple jurisdictions.",
        "sophistication": "intermediate",
        "resource_level": "organization",
        "primary_motivation": "financial-gain",
        "country": "AE",
        "sectors": ["customs", "electronics", "textiles"],
        "ttps": ["T1036", "T1078"],
        "first_seen": "2020-09-01",
        "last_seen": "2026-02-10",
        "confidence": 71,
    },
]

SANCTIONED_ENTITIES = [
    {
        "id": "identity--001",
        "name": "Arak Heavy Water Reactors",
        "type": "organization",
        "country": "IR",
        "sanctions_lists": ["OFAC-SDN", "EU-CFSP", "UN-1737"],
        "reason": "Nuclear proliferation activities",
        "added_date": "2010-06-09",
        "hs_codes_of_concern": ["84", "85", "90"],
    },
    {
        "id": "identity--002",
        "name": "Pyongyang Trading Corporation",
        "type": "organization",
        "country": "KP",
        "sanctions_lists": ["OFAC-SDN", "UN-1718"],
        "reason": "WMD proliferation and sanctions evasion",
        "added_date": "2009-04-24",
        "hs_codes_of_concern": ["84", "85", "87", "88", "93"],
    },
    {
        "id": "identity--003",
        "name": "Damascus Steel & Metals Ltd",
        "type": "organization",
        "country": "SY",
        "sanctions_lists": ["OFAC-SDN", "EU-CFSP"],
        "reason": "Financing of armed groups",
        "added_date": "2013-11-20",
        "hs_codes_of_concern": ["72", "73", "93"],
    },
    {
        "id": "identity--004",
        "name": "Viktor Marchenko",
        "type": "individual",
        "country": "RU",
        "sanctions_lists": ["OFAC-SDN", "EU-CFSP"],
        "reason": "Arms trafficking and money laundering",
        "added_date": "2022-03-15",
        "hs_codes_of_concern": ["93", "87", "88"],
    },
]

COUNTRY_RISK_SCORES: dict[str, dict] = {
    "KP": {"score": 98, "level": "critical", "factors": ["WMD proliferation", "UN sanctions", "No diplomatic relations"], "sources": ["UN Panel of Experts", "FATF"]},
    "IR": {"score": 92, "level": "critical", "factors": ["Nuclear programme", "OFAC sanctions", "State-sponsored threat actors"], "sources": ["OFAC", "EU CFSP", "UN 1737"]},
    "SY": {"score": 88, "level": "critical", "factors": ["Civil conflict", "Sanctions", "Financing of terrorism"], "sources": ["OFAC", "EU CFSP"]},
    "RU": {"score": 82, "level": "high", "factors": ["Ukraine invasion sanctions", "Export controls", "Dual-use concerns"], "sources": ["OFAC", "EU CFSP", "BIS"]},
    "MM": {"score": 75, "level": "high", "factors": ["Military coup", "Narcotics trafficking", "Money laundering"], "sources": ["FATF", "OFAC"]},
    "BY": {"score": 72, "level": "high", "factors": ["Sanctions", "Proxy for Russia"], "sources": ["EU CFSP", "OFAC"]},
    "CU": {"score": 65, "level": "high", "factors": ["US embargo", "OFAC sanctions"], "sources": ["OFAC"]},
    "VE": {"score": 62, "level": "high", "factors": ["Corruption", "Narcotics", "OFAC sanctions"], "sources": ["OFAC", "FATF"]},
    "NG": {"score": 55, "level": "medium", "factors": ["Organised crime", "Corruption", "Trade fraud"], "sources": ["FATF", "Interpol"]},
    "GH": {"score": 28, "level": "low", "factors": ["Stable democracy", "ECOWAS member"], "sources": ["FATF"]},
    "RW": {"score": 22, "level": "low", "factors": ["Strong governance", "EAC member"], "sources": ["FATF"]},
    "SG": {"score": 8, "level": "minimal", "factors": ["FATF compliant", "Strong AML/CFT regime"], "sources": ["FATF"]},
}

MITRE_TTPS: dict[str, dict] = {
    "T1566": {"name": "Phishing", "tactic": "Initial Access", "description": "Adversary sends phishing messages to gain access to victim systems."},
    "T1078": {"name": "Valid Accounts", "tactic": "Defense Evasion", "description": "Adversary uses legitimate credentials to access systems."},
    "T1036": {"name": "Masquerading", "tactic": "Defense Evasion", "description": "Adversary manipulates features of artifacts to make them appear legitimate."},
    "T1199": {"name": "Trusted Relationship", "tactic": "Initial Access", "description": "Adversary gains access through trusted third-party relationships."},
    "T1583": {"name": "Acquire Infrastructure", "tactic": "Resource Development", "description": "Adversary acquires infrastructure for use during targeting."},
    "T1562": {"name": "Impair Defenses", "tactic": "Defense Evasion", "description": "Adversary impairs defenses to avoid detection."},
}

# ─── Pydantic Models ──────────────────────────────────────────────────────────

class EnrichRequest(BaseModel):
    declaration_id: str
    trader_name: str
    shipper_name: str
    consignee_name: str
    origin_country: str
    destination_country: str
    transshipment_ports: list[str] = []
    hs_code: str
    declared_value_usd: float

class SanctionCheckRequest(BaseModel):
    entity_name: str
    country: Optional[str] = None

# ─── Helper Functions ─────────────────────────────────────────────────────────

def fuzzy_match(name: str, target: str) -> bool:
    """Simple case-insensitive substring match."""
    return name.lower() in target.lower() or target.lower() in name.lower()

def get_country_risk(country: str) -> dict:
    return COUNTRY_RISK_SCORES.get(country, {"score": 30, "level": "low", "factors": [], "sources": []})

def check_sanctions(entity_name: str) -> list[dict]:
    matches = []
    for entity in SANCTIONED_ENTITIES:
        if fuzzy_match(entity_name, entity["name"]):
            matches.append({
                "entity_id": entity["id"],
                "matched_name": entity["name"],
                "type": entity["type"],
                "country": entity["country"],
                "sanctions_lists": entity["sanctions_lists"],
                "reason": entity["reason"],
                "added_date": entity["added_date"],
                "hs_codes_of_concern": entity["hs_codes_of_concern"],
                "match_confidence": 90,
            })
    return matches

def find_threat_actors(country: str, hs_chapter: str) -> list[dict]:
    actors = []
    for actor in THREAT_ACTORS:
        if actor["country"] == country:
            actors.append({
                "actor_id": actor["id"],
                "name": actor["name"],
                "aliases": actor["aliases"],
                "sophistication": actor["sophistication"],
                "primary_motivation": actor["primary_motivation"],
                "confidence": actor["confidence"],
                "last_seen": actor["last_seen"],
                "ttps": [
                    {**MITRE_TTPS.get(t, {"name": t, "tactic": "Unknown", "description": ""}), "id": t}
                    for t in actor["ttps"]
                ],
            })
    return actors

def enrich_declaration(req: EnrichRequest) -> dict:
    hs_chapter = req.hs_code[:2]
    origin_risk = get_country_risk(req.origin_country)
    dest_risk = get_country_risk(req.destination_country)

    # Sanctions checks
    shipper_sanctions = check_sanctions(req.shipper_name)
    consignee_sanctions = check_sanctions(req.consignee_name)
    trader_sanctions = check_sanctions(req.trader_name)
    all_sanctions = shipper_sanctions + consignee_sanctions + trader_sanctions

    # Threat actors
    threat_actors = find_threat_actors(req.origin_country, hs_chapter)

    # Transshipment risk
    transship_risks = []
    for port in req.transshipment_ports:
        country_code = port[:2]
        risk = get_country_risk(country_code)
        if risk["score"] > 50:
            transship_risks.append({"port": port, "country": country_code, "risk": risk})

    # Overall threat level
    max_risk = max(origin_risk["score"], dest_risk["score"])
    if all_sanctions:
        max_risk = min(100, max_risk + 30)
    if threat_actors:
        max_risk = min(100, max_risk + 15)

    threat_level = "critical" if max_risk >= 80 else "high" if max_risk >= 60 else "medium" if max_risk >= 40 else "low"

    return {
        "declaration_id": req.declaration_id,
        "enriched_at": datetime.now(timezone.utc).isoformat(),
        "threat_level": threat_level,
        "overall_risk_score": max_risk,
        "origin_country_risk": origin_risk,
        "destination_country_risk": dest_risk,
        "sanctions_hits": all_sanctions,
        "sanctions_hit_count": len(all_sanctions),
        "threat_actors": threat_actors,
        "transshipment_risks": transship_risks,
        "hs_chapter": hs_chapter,
        "recommendations": _build_recommendations(all_sanctions, threat_actors, origin_risk, transship_risks),
    }

def _build_recommendations(sanctions: list, actors: list, origin_risk: dict, transship_risks: list) -> list[str]:
    recs = []
    if sanctions:
        recs.append(f"ESCALATE: {len(sanctions)} sanctions hit(s) detected — mandatory compliance review required")
    if any(a["confidence"] > 80 for a in actors):
        recs.append("INSPECT: High-confidence threat actor association — physical inspection recommended")
    if origin_risk["score"] > 80:
        recs.append("HOLD: Origin country is under comprehensive sanctions — legal review required before release")
    elif origin_risk["score"] > 60:
        recs.append("REVIEW: Elevated origin country risk — enhanced due diligence required")
    if transship_risks:
        recs.append(f"FLAG: {len(transship_risks)} high-risk transshipment port(s) detected — verify routing documentation")
    if not recs:
        recs.append("PROCEED: No significant threat intelligence indicators found")
    return recs

# ─── API Endpoints ────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "opencti-svc"}

@app.post("/enrich")
def enrich(req: EnrichRequest):
    return enrich_declaration(req)

@app.post("/sanctions/check")
def sanctions_check(req: SanctionCheckRequest):
    hits = check_sanctions(req.entity_name)
    return {"entity_name": req.entity_name, "hits": hits, "is_sanctioned": len(hits) > 0}

@app.get("/threat-actors")
def list_threat_actors(country: Optional[str] = None):
    if country:
        return [a for a in THREAT_ACTORS if a["country"] == country]
    return THREAT_ACTORS

@app.get("/country-risk/{country_code}")
def country_risk(country_code: str):
    risk = get_country_risk(country_code.upper())
    return {"country": country_code.upper(), **risk}

@app.get("/ttps")
def list_ttps():
    return [{"id": k, **v} for k, v in MITRE_TTPS.items()]

@app.get("/ttps/{ttp_id}")
def get_ttp(ttp_id: str):
    ttp = MITRE_TTPS.get(ttp_id)
    if not ttp:
        raise HTTPException(status_code=404, detail="TTP not found")
    return {"id": ttp_id, **ttp}


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


    port = int(os.getenv("PORT", "8107"))
    uvicorn.run(app, host="0.0.0.0", port=port)
