"""
wazuh-svc — Wazuh SIEM/XDR Integration Service (Sprint 54)
Port: 8108
Connects to Wazuh REST API to ingest security events, correlate them with
TradeGateway declarations and trader accounts, and manage incident lifecycle.
"""

from __future__ import annotations
from contextlib import asynccontextmanager

import hashlib
import json
import os
import random
import time
import uuid
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


# ─── Application Lifespan ───────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan: activates full middleware bundle on startup."""
    async with middleware_lifespan():
        yield

app = FastAPI(title="wazuh-svc", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

WAZUH_BASE_URL = os.getenv("WAZUH_BASE_URL", "https://wazuh-manager:55000")
WAZUH_USER = os.getenv("WAZUH_USER", "wazuh")
WAZUH_PASSWORD = os.getenv("WAZUH_PASSWORD", "wazuh")

# ─── MITRE ATT&CK Tactic/Technique mapping ──────────────────────────────────

RULE_MITRE_MAP: dict[str, dict[str, str]] = {
    "1002": {"tactic": "Execution", "technique": "T1059", "name": "Command and Scripting Interpreter"},
    "5501": {"tactic": "Credential Access", "technique": "T1110", "name": "Brute Force"},
    "5503": {"tactic": "Credential Access", "technique": "T1110.001", "name": "Password Guessing"},
    "5551": {"tactic": "Credential Access", "technique": "T1110.003", "name": "Password Spraying"},
    "5710": {"tactic": "Lateral Movement", "technique": "T1021.004", "name": "Remote Services: SSH"},
    "5712": {"tactic": "Initial Access", "technique": "T1078", "name": "Valid Accounts"},
    "5720": {"tactic": "Credential Access", "technique": "T1110", "name": "Brute Force"},
    "5760": {"tactic": "Defense Evasion", "technique": "T1070", "name": "Indicator Removal"},
    "80700": {"tactic": "Impact", "technique": "T1485", "name": "Data Destruction"},
    "80731": {"tactic": "Collection", "technique": "T1005", "name": "Data from Local System"},
    "550": {"tactic": "Defense Evasion", "technique": "T1222", "name": "File and Directory Permissions Modification"},
    "554": {"tactic": "Persistence", "technique": "T1543", "name": "Create or Modify System Process"},
    "591": {"tactic": "Exfiltration", "technique": "T1048", "name": "Exfiltration Over Alternative Protocol"},
    "31103": {"tactic": "Discovery", "technique": "T1046", "name": "Network Service Scanning"},
    "31151": {"tactic": "Reconnaissance", "technique": "T1595", "name": "Active Scanning"},
}

SEVERITY_LEVELS = {
    range(1, 4): "low",
    range(4, 8): "medium",
    range(8, 13): "high",
    range(13, 16): "critical",
}

# ─── In-memory stores (replace with DB in production) ───────────────────────

_alerts: list[dict] = []
_incidents: dict[str, dict] = {}
_agents: list[dict] = []
_initialized = False


def _get_severity(level: int) -> str:
    for r, s in SEVERITY_LEVELS.items():
        if level in r:
            return s
    return "low"


def _tag_mitre(rule_id: str) -> dict[str, str] | None:
    return RULE_MITRE_MAP.get(rule_id)


def _correlate_declaration(alert: dict) -> str | None:
    """Extract declaration ID from alert data if present."""
    data = alert.get("data", {})
    # Check common fields where declaration IDs might appear
    for field in ["srcip", "dstip", "url", "data", "extra_data"]:
        val = str(data.get(field, ""))
        if val.startswith("DECL-") or val.startswith("TG-"):
            return val
    return None


def _seed_demo_data() -> None:
    global _initialized, _alerts, _agents
    if _initialized:
        return
    _initialized = True

    now = datetime.now(timezone.utc)

    # Seed agents
    _agents = [
        {"id": f"00{i}", "name": f"tg-node-{i:02d}", "ip": f"10.0.{i}.1",
         "os": "Ubuntu 22.04", "status": "active" if i < 4 else "disconnected",
         "last_keepalive": (now - timedelta(minutes=random.randint(1, 30))).isoformat()}
        for i in range(1, 7)
    ]

    # Seed alerts
    rule_ids = list(RULE_MITRE_MAP.keys())
    for i in range(50):
        rule_id = random.choice(rule_ids)
        level = random.randint(1, 15)
        mitre = _tag_mitre(rule_id)
        alert = {
            "id": f"alert-{i+1:04d}",
            "timestamp": (now - timedelta(hours=random.randint(0, 72))).isoformat(),
            "agent": random.choice(_agents),
            "rule": {
                "id": rule_id,
                "level": level,
                "description": mitre["name"] if mitre else f"Security rule {rule_id}",
                "groups": ["authentication", "syslog"] if level > 7 else ["syslog"],
            },
            "severity": _get_severity(level),
            "mitre": mitre,
            "data": {
                "srcip": f"192.168.{random.randint(1,254)}.{random.randint(1,254)}",
                "dstip": f"10.0.{random.randint(1,5)}.{random.randint(1,254)}",
                "protocol": random.choice(["TCP", "UDP", "HTTP", "HTTPS"]),
            },
            "declaration_id": f"DECL-{random.randint(10000, 99999)}" if random.random() < 0.3 else None,
            "trader_id": f"trader-{random.randint(1, 20):03d}" if random.random() < 0.25 else None,
            "incident_id": None,
            "acknowledged": random.random() < 0.4,
        }
        _alerts.append(alert)

    # Seed incidents
    statuses = ["open", "investigating", "contained", "resolved"]
    for i in range(8):
        inc_id = str(uuid.uuid4())
        related = random.sample([a["id"] for a in _alerts], k=random.randint(1, 4))
        for aid in related:
            for a in _alerts:
                if a["id"] == aid:
                    a["incident_id"] = inc_id
        _incidents[inc_id] = {
            "id": inc_id,
            "title": f"Security Incident #{i+1:03d}",
            "status": statuses[i % 4],
            "severity": random.choice(["medium", "high", "critical"]),
            "created_at": (now - timedelta(hours=random.randint(1, 48))).isoformat(),
            "updated_at": now.isoformat(),
            "assigned_to": f"analyst-{random.randint(1, 5):02d}",
            "alert_ids": related,
            "description": "Automated incident created from correlated security alerts.",
            "mitre_tactics": list({a.get("mitre", {}).get("tactic") for a in _alerts if a["id"] in related and a.get("mitre")}),
            "resolution_notes": "Ongoing investigation." if i % 4 != 3 else "Resolved: false positive confirmed.",
        }


# ─── Models ──────────────────────────────────────────────────────────────────

class CreateIncidentRequest(BaseModel):
    title: str
    severity: str = "medium"
    alert_ids: list[str] = Field(default_factory=list)
    description: str = ""
    assigned_to: str = ""


class UpdateIncidentRequest(BaseModel):
    status: str | None = None
    severity: str | None = None
    assigned_to: str | None = None
    description: str | None = None
    resolution_notes: str | None = None


class IngestAlertRequest(BaseModel):
    rule_id: str
    level: int
    description: str
    agent_id: str
    agent_name: str
    src_ip: str = ""
    dst_ip: str = ""
    declaration_id: str | None = None
    trader_id: str | None = None
    extra_data: dict[str, Any] = Field(default_factory=dict)


# ─── Routes ──────────────────────────────────────────────────────────────────



@app.get("/health")
async def health():
    return {"status": "ok", "service": "wazuh-svc", "alerts": len(_alerts), "incidents": len(_incidents)}


@app.get("/alerts")
async def get_alerts(
    severity: str | None = None,
    acknowledged: bool | None = None,
    declaration_id: str | None = None,
    trader_id: str | None = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
):
    _seed_demo_data()
    results = list(_alerts)
    if severity:
        results = [a for a in results if a["severity"] == severity]
    if acknowledged is not None:
        results = [a for a in results if a["acknowledged"] == acknowledged]
    if declaration_id:
        results = [a for a in results if a.get("declaration_id") == declaration_id]
    if trader_id:
        results = [a for a in results if a.get("trader_id") == trader_id]
    results.sort(key=lambda a: a["timestamp"], reverse=True)
    return {"total": len(results), "alerts": results[offset: offset + limit]}


@app.post("/alerts/ingest")
async def ingest_alert(req: IngestAlertRequest):
    _seed_demo_data()
    mitre = _tag_mitre(req.rule_id)
    alert = {
        "id": f"alert-{uuid.uuid4().hex[:8]}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "agent": {"id": req.agent_id, "name": req.agent_name, "ip": req.src_ip},
        "rule": {"id": req.rule_id, "level": req.level, "description": req.description, "groups": []},
        "severity": _get_severity(req.level),
        "mitre": mitre,
        "data": {"srcip": req.src_ip, "dstip": req.dst_ip, **req.extra_data},
        "declaration_id": req.declaration_id,
        "trader_id": req.trader_id,
        "incident_id": None,
        "acknowledged": False,
    }
    _alerts.append(alert)
    return alert


@app.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str):
    for a in _alerts:
        if a["id"] == alert_id:
            a["acknowledged"] = True
            return a
    raise HTTPException(status_code=404, detail="Alert not found")


@app.get("/incidents")
async def get_incidents(status: str | None = None, limit: int = 50, offset: int = 0):
    _seed_demo_data()
    results = list(_incidents.values())
    if status:
        results = [i for i in results if i["status"] == status]
    results.sort(key=lambda i: i["created_at"], reverse=True)
    return {"total": len(results), "incidents": results[offset: offset + limit]}


@app.get("/incidents/{incident_id}")
async def get_incident(incident_id: str):
    _seed_demo_data()
    inc = _incidents.get(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    return inc


@app.post("/incidents")
async def create_incident(req: CreateIncidentRequest):
    _seed_demo_data()
    now = datetime.now(timezone.utc).isoformat()
    inc_id = str(uuid.uuid4())
    # Link alerts
    mitre_tactics: set[str] = set()
    for aid in req.alert_ids:
        for a in _alerts:
            if a["id"] == aid:
                a["incident_id"] = inc_id
                if a.get("mitre") and a["mitre"].get("tactic"):
                    mitre_tactics.add(a["mitre"]["tactic"])
    incident = {
        "id": inc_id,
        "title": req.title,
        "status": "open",
        "severity": req.severity,
        "created_at": now,
        "updated_at": now,
        "assigned_to": req.assigned_to,
        "alert_ids": req.alert_ids,
        "description": req.description,
        "mitre_tactics": list(mitre_tactics),
        "resolution_notes": "",
    }
    _incidents[inc_id] = incident
    return incident


@app.patch("/incidents/{incident_id}")
async def update_incident(incident_id: str, req: UpdateIncidentRequest):
    _seed_demo_data()
    inc = _incidents.get(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    if req.status is not None:
        inc["status"] = req.status
    if req.severity is not None:
        inc["severity"] = req.severity
    if req.assigned_to is not None:
        inc["assigned_to"] = req.assigned_to
    if req.description is not None:
        inc["description"] = req.description
    if req.resolution_notes is not None:
        inc["resolution_notes"] = req.resolution_notes
    inc["updated_at"] = datetime.now(timezone.utc).isoformat()
    return inc


@app.get("/correlate/declaration/{declaration_id}")
async def correlate_declaration(declaration_id: str):
    _seed_demo_data()
    related = [a for a in _alerts if a.get("declaration_id") == declaration_id]
    return {"declaration_id": declaration_id, "alert_count": len(related), "alerts": related}


@app.get("/agents")
async def get_agents():
    _seed_demo_data()
    return {"total": len(_agents), "agents": _agents}


@app.get("/stats/mitre")
async def get_mitre_stats():
    _seed_demo_data()
    tactic_counts: dict[str, int] = {}
    technique_counts: dict[str, int] = {}
    for a in _alerts:
        m = a.get("mitre")
        if m:
            tactic_counts[m["tactic"]] = tactic_counts.get(m["tactic"], 0) + 1
            technique_counts[m["technique"]] = technique_counts.get(m["technique"], 0) + 1
    return {
        "total_alerts": len(_alerts),
        "total_incidents": len(_incidents),
        "by_severity": {s: sum(1 for a in _alerts if a["severity"] == s) for s in ["low", "medium", "high", "critical"]},
        "by_tactic": tactic_counts,
        "by_technique": technique_counts,
        "open_incidents": sum(1 for i in _incidents.values() if i["status"] == "open"),
    }



if __name__ == "__main__":
    import uvicorn

# ─── Middleware Integration ───────────────────────────────────────────────────
import threading as _threading
try:
    from middleware_integration import setup_middleware, start_consumer_thread, shutdown_middleware, middleware_lifespan
    _MIDDLEWARE_AVAILABLE = True
except ImportError:
    _MIDDLEWARE_AVAILABLE = False
    def setup_middleware(): pass
    def start_consumer_thread(): return None
    def shutdown_middleware(): pass
    @asynccontextmanager
    async def middleware_lifespan():
        yield


    uvicorn.run(app, host="0.0.0.0", port=8108)
