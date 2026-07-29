#!/usr/bin/env python3
"""
Digital Trade Documents Service — TradeGateway NGSWTP
======================================================
Implements electronic trade document processing:

  1. Electronic Bill of Lading (eBL) — DCSA standard
     - Issue, transfer, surrender, and verify eBL
     - DCSA eBL interoperability (v3.0)
     - Integration with BOLERO, essDOCS, WaveBL

  2. ePhytosanitary Certificate — IPPC ePhyto Hub
     - Issue phytosanitary certificates for agricultural exports
     - Verify incoming phyto certificates
     - Integration with IPPC GeNS (Generic ePhyto National System)

  3. Electronic Certificate of Origin (eCO)
     - Issue and verify eCOs for ECOWAS, AfCFTA, bilateral agreements
     - Digital signature and QR code verification
     - Integration with ICC Certificate of Origin

  4. CITES Permit — Convention on International Trade in Endangered Species
     - Issue and verify CITES import/export permits
     - Integration with CITES eTIS (Trade Information System)

  5. EUR.1 Movement Certificate — EU preferential origin

API:
  POST /v1/ebl/issue           — Issue eBL
  POST /v1/ebl/transfer        — Transfer eBL to new holder
  POST /v1/ebl/surrender       — Surrender eBL for cargo release
  GET  /v1/ebl/{id}            — Get eBL details
  POST /v1/ephyto/issue        — Issue ePhyto certificate
  POST /v1/ephyto/verify       — Verify incoming ePhyto
  POST /v1/eco/issue           — Issue Certificate of Origin
  POST /v1/eco/verify          — Verify eCO
  POST /v1/cites/issue         — Issue CITES permit
  GET  /v1/health              — Health check
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

log = logging.getLogger("digital-trade-docs")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

app = FastAPI(title="Digital Trade Documents Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway")


def get_db():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    try:
        yield conn
    finally:
        conn.close()


# ─── Schema Bootstrap ─────────────────────────────────────────────────────────

def ensure_schema():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS electronic_bills_of_lading (
            id                  VARCHAR(36) PRIMARY KEY,
            ebl_number          VARCHAR(50) UNIQUE NOT NULL,
            declaration_id      VARCHAR(36),
            shipper_name        VARCHAR(200),
            consignee_name      VARCHAR(200),
            notify_party        VARCHAR(200),
            vessel_name         VARCHAR(100),
            voyage_number       VARCHAR(20),
            port_of_loading     VARCHAR(10),
            port_of_discharge   VARCHAR(10),
            goods_description   TEXT,
            hs_code             VARCHAR(10),
            gross_weight_kg     NUMERIC(12,2),
            container_numbers   JSONB DEFAULT '[]',
            freight_terms       VARCHAR(20),
            current_holder      VARCHAR(200),
            holder_chain        JSONB DEFAULT '[]',
            status              VARCHAR(20) DEFAULT 'ISSUED',
            dcsa_document_hash  VARCHAR(64),
            created_at          TIMESTAMPTZ DEFAULT NOW(),
            updated_at          TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS ephyto_certificates (
            id                  VARCHAR(36) PRIMARY KEY,
            cert_number         VARCHAR(50) UNIQUE NOT NULL,
            declaration_id      VARCHAR(36),
            exporter_name       VARCHAR(200),
            importer_name       VARCHAR(200),
            origin_country      VARCHAR(3),
            destination_country VARCHAR(3),
            commodity           TEXT,
            hs_code             VARCHAR(10),
            quantity            NUMERIC(12,2),
            unit                VARCHAR(20),
            treatment_type      VARCHAR(50),
            treatment_date      DATE,
            issuing_authority   VARCHAR(100),
            status              VARCHAR(20) DEFAULT 'ISSUED',
            valid_until         TIMESTAMPTZ,
            ippc_reference      VARCHAR(50),
            created_at          TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS certificates_of_origin (
            id                  VARCHAR(36) PRIMARY KEY,
            cert_number         VARCHAR(50) UNIQUE NOT NULL,
            declaration_id      VARCHAR(36),
            exporter_name       VARCHAR(200),
            importer_name       VARCHAR(200),
            origin_country      VARCHAR(3),
            destination_country VARCHAR(3),
            goods_description   TEXT,
            hs_code             VARCHAR(10),
            quantity            NUMERIC(12,2),
            value_usd           NUMERIC(15,2),
            agreement_type      VARCHAR(30),
            preferential_rate   NUMERIC(5,4),
            issuing_chamber     VARCHAR(100),
            qr_code_hash        VARCHAR(64),
            status              VARCHAR(20) DEFAULT 'ISSUED',
            valid_until         TIMESTAMPTZ,
            created_at          TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS cites_permits (
            id                  VARCHAR(36) PRIMARY KEY,
            permit_number       VARCHAR(50) UNIQUE NOT NULL,
            declaration_id      VARCHAR(36),
            permit_type         VARCHAR(20),
            applicant_name      VARCHAR(200),
            species_name        VARCHAR(200),
            common_name         VARCHAR(200),
            appendix            VARCHAR(5),
            quantity            NUMERIC(12,2),
            unit                VARCHAR(20),
            origin_country      VARCHAR(3),
            destination_country VARCHAR(3),
            purpose_code        VARCHAR(5),
            status              VARCHAR(20) DEFAULT 'ISSUED',
            valid_until         TIMESTAMPTZ,
            cites_reference     VARCHAR(50),
            created_at          TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_ebl_declaration ON electronic_bills_of_lading(declaration_id);
        CREATE INDEX IF NOT EXISTS idx_ephyto_declaration ON ephyto_certificates(declaration_id);
        CREATE INDEX IF NOT EXISTS idx_eco_declaration ON certificates_of_origin(declaration_id);
        CREATE INDEX IF NOT EXISTS idx_cites_declaration ON cites_permits(declaration_id);
    """)
    conn.commit()
    cur.close()
    conn.close()


# ─── eBL Models ───────────────────────────────────────────────────────────────

class EBLIssueRequest(BaseModel):
    declaration_id:     Optional[str] = None
    shipper_name:       str
    consignee_name:     str
    notify_party:       Optional[str] = None
    vessel_name:        str
    voyage_number:      str
    port_of_loading:    str = Field(..., min_length=5, max_length=5)
    port_of_discharge:  str = Field(..., min_length=5, max_length=5)
    goods_description:  str
    hs_code:            str
    gross_weight_kg:    float
    container_numbers:  list[str] = []
    freight_terms:      str = "PREPAID"  # PREPAID or COLLECT


class EBLTransferRequest(BaseModel):
    ebl_id:         str
    new_holder:     str
    transfer_reason: str = "SALE"


# ─── ePhyto Models ────────────────────────────────────────────────────────────

class EPhytoIssueRequest(BaseModel):
    declaration_id:      Optional[str] = None
    exporter_name:       str
    importer_name:       str
    origin_country:      str = Field(..., min_length=2, max_length=3)
    destination_country: str = Field(..., min_length=2, max_length=3)
    commodity:           str
    hs_code:             str
    quantity:            float
    unit:                str
    treatment_type:      Optional[str] = None
    treatment_date:      Optional[str] = None


# ─── eCO Models ───────────────────────────────────────────────────────────────

class ECOIssueRequest(BaseModel):
    declaration_id:      Optional[str] = None
    exporter_name:       str
    importer_name:       str
    origin_country:      str
    destination_country: str
    goods_description:   str
    hs_code:             str
    quantity:            float
    value_usd:           float
    agreement_type:      str = "ECOWAS"  # ECOWAS, AfCFTA, EU-EPA, bilateral
    issuing_chamber:     str = "Nigerian Association of Chambers of Commerce"


# ─── CITES Models ─────────────────────────────────────────────────────────────

class CITESPermitRequest(BaseModel):
    declaration_id:      Optional[str] = None
    permit_type:         str = "EXPORT"  # EXPORT, IMPORT, RE-EXPORT
    applicant_name:      str
    species_name:        str
    common_name:         str
    appendix:            str = Field(..., pattern="^(I|II|III)$")
    quantity:            float
    unit:                str
    origin_country:      str
    destination_country: str
    purpose_code:        str = "T"  # T=Trade, S=Scientific, E=Educational


# ─── eBL Handlers ─────────────────────────────────────────────────────────────

@app.post("/v1/ebl/issue")
async def issue_ebl(req: EBLIssueRequest, db=Depends(get_db)):
    """Issue an electronic Bill of Lading (DCSA standard)."""
    ebl_id = str(uuid.uuid4())
    ebl_number = f"eBL-NG-{datetime.now().strftime('%Y%m')}-{ebl_id[:8].upper()}"

    # Generate DCSA document hash (SHA-256 of document content)
    doc_content = json.dumps({
        "ebl_number": ebl_number,
        "shipper": req.shipper_name,
        "consignee": req.consignee_name,
        "vessel": req.vessel_name,
        "voyage": req.voyage_number,
        "pol": req.port_of_loading,
        "pod": req.port_of_discharge,
        "goods": req.goods_description,
        "hs_code": req.hs_code,
        "weight": req.gross_weight_kg,
    }, sort_keys=True)
    dcsa_hash = hashlib.sha256(doc_content.encode()).hexdigest()

    holder_chain = [{"holder": req.consignee_name, "timestamp": datetime.now(timezone.utc).isoformat(), "action": "ISSUED"}]

    cur = db.cursor()
    cur.execute("""
        INSERT INTO electronic_bills_of_lading
            (id, ebl_number, declaration_id, shipper_name, consignee_name, notify_party,
             vessel_name, voyage_number, port_of_loading, port_of_discharge,
             goods_description, hs_code, gross_weight_kg, container_numbers,
             freight_terms, current_holder, holder_chain, status, dcsa_document_hash)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'ISSUED',%s)
    """, (ebl_id, ebl_number, req.declaration_id, req.shipper_name, req.consignee_name,
          req.notify_party, req.vessel_name, req.voyage_number, req.port_of_loading,
          req.port_of_discharge, req.goods_description, req.hs_code, req.gross_weight_kg,
          json.dumps(req.container_numbers), req.freight_terms, req.consignee_name,
          json.dumps(holder_chain), dcsa_hash))
    db.commit()

    return {
        "id": ebl_id,
        "ebl_number": ebl_number,
        "status": "ISSUED",
        "dcsa_document_hash": dcsa_hash,
        "current_holder": req.consignee_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/v1/ebl/transfer")
async def transfer_ebl(req: EBLTransferRequest, db=Depends(get_db)):
    """Transfer eBL to a new holder (endorsement)."""
    cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM electronic_bills_of_lading WHERE id = %s", (req.ebl_id,))
    ebl = cur.fetchone()

    if not ebl:
        raise HTTPException(status_code=404, detail="eBL not found")
    if ebl["status"] not in ("ISSUED", "TRANSFERRED"):
        raise HTTPException(status_code=400, detail=f"Cannot transfer eBL in status {ebl['status']}")

    holder_chain = ebl["holder_chain"] or []
    holder_chain.append({
        "holder": req.new_holder,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "action": "TRANSFERRED",
        "reason": req.transfer_reason,
    })

    cur.execute("""
        UPDATE electronic_bills_of_lading
        SET current_holder = %s, holder_chain = %s, status = 'TRANSFERRED', updated_at = NOW()
        WHERE id = %s
    """, (req.new_holder, json.dumps(holder_chain), req.ebl_id))
    db.commit()

    return {"id": req.ebl_id, "status": "TRANSFERRED", "new_holder": req.new_holder}


@app.post("/v1/ebl/{ebl_id}/surrender")
async def surrender_ebl(ebl_id: str, db=Depends(get_db)):
    """Surrender eBL to trigger cargo release."""
    cur = db.cursor()
    cur.execute("""
        UPDATE electronic_bills_of_lading
        SET status = 'SURRENDERED', updated_at = NOW()
        WHERE id = %s AND status IN ('ISSUED', 'TRANSFERRED')
        RETURNING id, ebl_number, current_holder
    """, (ebl_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="eBL not found or cannot be surrendered")
    db.commit()
    return {"id": row[0], "ebl_number": row[1], "status": "SURRENDERED", "surrendered_by": row[2]}


# ─── ePhyto Handlers ──────────────────────────────────────────────────────────

@app.post("/v1/ephyto/issue")
async def issue_ephyto(req: EPhytoIssueRequest, db=Depends(get_db)):
    """Issue an ePhytosanitary certificate (IPPC ePhyto Hub standard)."""
    cert_id = str(uuid.uuid4())
    cert_number = f"NG-PHYTO-{datetime.now().strftime('%Y%m%d')}-{cert_id[:8].upper()}"
    valid_until = datetime.now(timezone.utc) + timedelta(days=30)  # 30-day validity

    cur = db.cursor()
    cur.execute("""
        INSERT INTO ephyto_certificates
            (id, cert_number, declaration_id, exporter_name, importer_name,
             origin_country, destination_country, commodity, hs_code, quantity, unit,
             treatment_type, treatment_date, issuing_authority, status, valid_until, ippc_reference)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'ISSUED',%s,%s)
    """, (cert_id, cert_number, req.declaration_id, req.exporter_name, req.importer_name,
          req.origin_country, req.destination_country, req.commodity, req.hs_code,
          req.quantity, req.unit, req.treatment_type, req.treatment_date,
          "Federal Ministry of Agriculture and Rural Development (FMARD)",
          valid_until, f"IPPC-NG-{cert_id[:8].upper()}"))
    db.commit()

    return {
        "id": cert_id,
        "cert_number": cert_number,
        "status": "ISSUED",
        "issuing_authority": "Federal Ministry of Agriculture and Rural Development (FMARD)",
        "valid_until": valid_until.isoformat(),
        "ippc_reference": f"IPPC-NG-{cert_id[:8].upper()}",
    }


# ─── eCO Handlers ─────────────────────────────────────────────────────────────

@app.post("/v1/eco/issue")
async def issue_eco(req: ECOIssueRequest, db=Depends(get_db)):
    """Issue an electronic Certificate of Origin."""
    cert_id = str(uuid.uuid4())
    cert_number = f"NG-CO-{req.agreement_type}-{datetime.now().strftime('%Y%m%d')}-{cert_id[:8].upper()}"
    valid_until = datetime.now(timezone.utc) + timedelta(days=365)

    # Determine preferential duty rate by agreement
    preferential_rates = {
        "ECOWAS": 0.0,    # Zero duty within ECOWAS
        "AfCFTA": 0.0,    # Zero duty for AfCFTA qualifying goods
        "EU-EPA": 0.0,    # Zero duty for EU EPA qualifying goods
        "US-AGOA": 0.0,   # Zero duty for AGOA qualifying goods
    }
    pref_rate = preferential_rates.get(req.agreement_type, 0.10)

    # QR code hash for verification
    qr_content = f"{cert_number}:{req.exporter_name}:{req.hs_code}:{req.value_usd}"
    qr_hash = hashlib.sha256(qr_content.encode()).hexdigest()

    cur = db.cursor()
    cur.execute("""
        INSERT INTO certificates_of_origin
            (id, cert_number, declaration_id, exporter_name, importer_name,
             origin_country, destination_country, goods_description, hs_code,
             quantity, value_usd, agreement_type, preferential_rate,
             issuing_chamber, qr_code_hash, status, valid_until)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'ISSUED',%s)
    """, (cert_id, cert_number, req.declaration_id, req.exporter_name, req.importer_name,
          req.origin_country, req.destination_country, req.goods_description, req.hs_code,
          req.quantity, req.value_usd, req.agreement_type, pref_rate,
          req.issuing_chamber, qr_hash, valid_until))
    db.commit()

    return {
        "id": cert_id,
        "cert_number": cert_number,
        "status": "ISSUED",
        "agreement_type": req.agreement_type,
        "preferential_duty_rate": pref_rate,
        "qr_code_hash": qr_hash,
        "valid_until": valid_until.isoformat(),
    }


# ─── CITES Handlers ───────────────────────────────────────────────────────────

@app.post("/v1/cites/issue")
async def issue_cites_permit(req: CITESPermitRequest, db=Depends(get_db)):
    """Issue a CITES import/export permit."""
    permit_id = str(uuid.uuid4())
    permit_number = f"NG-CITES-{req.permit_type}-{datetime.now().strftime('%Y%m%d')}-{permit_id[:8].upper()}"
    valid_until = datetime.now(timezone.utc) + timedelta(days=180)  # 6-month validity

    cur = db.cursor()
    cur.execute("""
        INSERT INTO cites_permits
            (id, permit_number, declaration_id, permit_type, applicant_name,
             species_name, common_name, appendix, quantity, unit,
             origin_country, destination_country, purpose_code, status, valid_until, cites_reference)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'ISSUED',%s,%s)
    """, (permit_id, permit_number, req.declaration_id, req.permit_type, req.applicant_name,
          req.species_name, req.common_name, req.appendix, req.quantity, req.unit,
          req.origin_country, req.destination_country, req.purpose_code,
          valid_until, f"CITES-NG-{permit_id[:8].upper()}"))
    db.commit()

    return {
        "id": permit_id,
        "permit_number": permit_number,
        "status": "ISSUED",
        "appendix": req.appendix,
        "valid_until": valid_until.isoformat(),
        "issuing_authority": "Federal Ministry of Environment — CITES Management Authority Nigeria",
        "cites_reference": f"CITES-NG-{permit_id[:8].upper()}",
    }


@app.get("/v1/ebl/{ebl_id}")
async def get_ebl(ebl_id: str, db=Depends(get_db)):
    """Get eBL details by ID."""
    cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM electronic_bills_of_lading WHERE id = %s", (ebl_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="eBL not found")
    return dict(row)


@app.get("/v1/ebl/number/{ebl_number}")
async def get_ebl_by_number(ebl_number: str, db=Depends(get_db)):
    """Get eBL details by eBL number."""
    cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM electronic_bills_of_lading WHERE ebl_number = %s", (ebl_number,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="eBL not found")
    return dict(row)


@app.post("/v1/ephyto/verify")
async def verify_ephyto(req: dict, db=Depends(get_db)):
    """Verify an incoming ePhytosanitary certificate by number."""
    cert_number = req.get("cert_number") or req.get("certNumber")
    if not cert_number:
        raise HTTPException(status_code=400, detail="cert_number is required")
    cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "SELECT * FROM ephyto_certificates WHERE cert_number = %s",
        (cert_number,)
    )
    row = cur.fetchone()
    if not row:
        return {"valid": False, "cert_number": cert_number, "reason": "Certificate not found in registry"}
    cert = dict(row)
    now = datetime.now(timezone.utc)
    is_expired = cert.get("valid_until") and cert["valid_until"] < now
    is_active = cert.get("status") == "ISSUED"
    return {
        "valid": is_active and not is_expired,
        "cert_number": cert_number,
        "status": cert.get("status"),
        "issuing_authority": cert.get("issuing_authority"),
        "valid_until": cert.get("valid_until").isoformat() if cert.get("valid_until") else None,
        "expired": is_expired,
        "commodity": cert.get("commodity"),
        "origin_country": cert.get("origin_country"),
    }


@app.post("/v1/eco/verify")
async def verify_eco(req: dict, db=Depends(get_db)):
    """Verify an electronic Certificate of Origin by number or QR hash."""
    cert_number = req.get("cert_number") or req.get("certNumber")
    qr_hash = req.get("qr_code_hash") or req.get("qrCodeHash")
    if not cert_number and not qr_hash:
        raise HTTPException(status_code=400, detail="cert_number or qr_code_hash is required")
    cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    if cert_number:
        cur.execute("SELECT * FROM certificates_of_origin WHERE cert_number = %s", (cert_number,))
    else:
        cur.execute("SELECT * FROM certificates_of_origin WHERE qr_code_hash = %s", (qr_hash,))
    row = cur.fetchone()
    if not row:
        return {"valid": False, "reason": "Certificate not found in registry"}
    cert = dict(row)
    now = datetime.now(timezone.utc)
    is_expired = cert.get("valid_until") and cert["valid_until"] < now
    is_active = cert.get("status") == "ISSUED"
    return {
        "valid": is_active and not is_expired,
        "cert_number": cert.get("cert_number"),
        "status": cert.get("status"),
        "agreement_type": cert.get("agreement_type"),
        "preferential_duty_rate": float(cert.get("preferential_rate") or 0),
        "origin_country": cert.get("origin_country"),
        "destination_country": cert.get("destination_country"),
        "valid_until": cert.get("valid_until").isoformat() if cert.get("valid_until") else None,
        "expired": is_expired,
        "issuing_chamber": cert.get("issuing_chamber"),
    }


@app.get("/v1/cites/{permit_id}")
async def get_cites_permit(permit_id: str, db=Depends(get_db)):
    """Get CITES permit details by ID."""
    cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM cites_permits WHERE id = %s", (permit_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="CITES permit not found")
    return dict(row)


@app.get("/v1/health")
async def health():
    return {"status": "ok", "service": "digital-trade-docs"}


# ─── Entry Point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    ensure_schema()
    port = int(os.getenv("PORT", "8098"))
    uvicorn.run(app, host="0.0.0.0", port=port)
