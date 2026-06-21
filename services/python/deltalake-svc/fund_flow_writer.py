"""
fund_flow_writer.py — Delta Lake Fund Flow Persistence Module
Provides idempotent Parquet writes for all 20 fund-flow scenarios.
Integrated into main.py via the /fund-flow/write endpoint.
Redis is used for idempotency guards (SET NX with TTL).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import pyarrow as pa
import pyarrow.parquet as pq
import redis
from fastapi import HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("fund_flow_writer")

DELTA_LAKE_PATH = os.getenv("DELTA_LAKE_PATH", "/data/delta-lake")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
IDEMPOTENCY_TTL = int(os.getenv("IDEMPOTENCY_TTL_SECONDS", "86400"))

# ─── REDIS CLIENT ─────────────────────────────────────────────────────────────

_redis: Optional[redis.Redis] = None

def get_redis() -> Optional[redis.Redis]:
    global _redis
    if _redis is None:
        try:
            _redis = redis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=2)
            _redis.ping()
        except Exception as e:
            logger.warning(f"Redis unavailable: {e} — idempotency guards disabled")
            _redis = None
    return _redis

# ─── SCHEMAS ──────────────────────────────────────────────────────────────────

# Maps scenario name → (table, partition_key_field)
SCENARIO_TABLE_MAP: Dict[str, tuple[str, str]] = {
    "import_duty":           ("duty_collections",      "date"),
    "export_levy":           ("duty_collections",      "date"),
    "duty_drawback":         ("drawback_claims",       "date"),
    "penalty_levy":          ("penalty_levies",        "date"),
    "bond_lodgement":        ("bond_guarantees",       "date"),
    "bond_release":          ("bond_guarantees",       "date"),
    "bond_forfeiture":       ("bond_guarantees",       "date"),
    "transit_lodgement":     ("transit_guarantees",    "date"),
    "transit_release":       ("transit_guarantees",    "date"),
    "aeo_fee":               ("aeo_fees",              "date"),
    "freezone_entry_fee":    ("freezone_admissions",   "date"),
    "warehouse_storage_fee": ("warehouse_fees",        "date"),
    "ex_bond_duty":          ("duty_collections",      "date"),
    "audit_recovery":        ("audit_recoveries",      "date"),
    "overpayment_refund":    ("audit_recoveries",      "date"),
    "oga_permit_fee":        ("oga_permit_fees",       "date"),
    "sanctions_reversal":    ("sanctions_events",      "date"),
    "batch_settlement":      ("batch_settlements",     "date"),
    "revenue_reconciliation":("revenue_reconciliation","date"),
    "account_provisioning":  ("account_provisioning",  "date"),
}

# ─── MODELS ───────────────────────────────────────────────────────────────────

class FundFlowWriteRequest(BaseModel):
    scenario: str = Field(..., description="One of the 20 fund-flow scenario names")
    record: Dict[str, Any] = Field(..., description="Fund flow record to persist")
    idempotency_key: Optional[str] = Field(None, description="Optional SHA-256 idempotency key")

class FundFlowWriteResponse(BaseModel):
    table: str
    partition: str
    rows_written: int
    idempotent: bool

# ─── IDEMPOTENCY ──────────────────────────────────────────────────────────────

def check_and_set_idempotency(key: str) -> bool:
    """
    Atomic Redis SET NX — returns True if duplicate (already processed).
    Fails open (returns False) if Redis is unavailable.
    """
    r = get_redis()
    if r is None:
        return False
    try:
        result = r.set(f"ff:idem:{key}", "1", nx=True, ex=IDEMPOTENCY_TTL)
        return result is None  # None → key existed → duplicate
    except redis.RedisError as e:
        logger.warning(f"Redis SET NX failed: {e}")
        return False

def derive_key(scenario: str, record: Dict[str, Any]) -> str:
    content = json.dumps({"scenario": scenario, "record": record}, sort_keys=True)
    return hashlib.sha256(content.encode()).hexdigest()

# ─── PARQUET WRITER ───────────────────────────────────────────────────────────

def write_fund_flow_record(scenario: str, record: Dict[str, Any]) -> tuple[str, str, int]:
    """
    Write a fund-flow record to the Delta Lake.
    Returns (table, partition, rows_written).
    """
    if scenario not in SCENARIO_TABLE_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown scenario: {scenario}")

    table, partition_field = SCENARIO_TABLE_MAP[scenario]

    # Ensure created_at
    if "created_at" not in record:
        record["created_at"] = datetime.now(timezone.utc).isoformat()

    # Derive partition
    date_str = record.get("date") or record.get("settlement_date") or record.get("reconciliation_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    partition = f"date={date_str}"

    # Build output path
    out_path = Path(DELTA_LAKE_PATH) / table / partition
    out_path.mkdir(parents=True, exist_ok=True)
    ts_ms = int(time.time() * 1000)
    out_file = out_path / f"{ts_ms}.parquet"

    # Build PyArrow arrays
    arrays: Dict[str, pa.Array] = {}
    for col, val in record.items():
        if isinstance(val, datetime):
            arrays[col] = pa.array([val], type=pa.timestamp("ms", tz="UTC"))
        elif isinstance(val, bool):
            arrays[col] = pa.array([val], type=pa.bool_())
        elif isinstance(val, int):
            arrays[col] = pa.array([val], type=pa.int64())
        elif isinstance(val, float):
            arrays[col] = pa.array([val], type=pa.float64())
        else:
            arrays[col] = pa.array([str(val) if val is not None else None], type=pa.string())

    arrow_table = pa.table(arrays)
    pq.write_table(arrow_table, str(out_file), compression="snappy")
    logger.info(f"[fund_flow_writer] Wrote {len(arrow_table)} rows → {out_file}")
    return table, partition, len(arrow_table)

# ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

def handle_fund_flow_write(req: FundFlowWriteRequest) -> FundFlowWriteResponse:
    idem_key = req.idempotency_key or derive_key(req.scenario, req.record)

    if check_and_set_idempotency(idem_key):
        logger.info(f"Duplicate fund-flow write ignored: scenario={req.scenario} key={idem_key[:16]}...")
        table, _, _ = write_fund_flow_record.__wrapped__(req.scenario, {}) if False else (
            SCENARIO_TABLE_MAP.get(req.scenario, ("unknown", "date"))[0], f"date={datetime.now(timezone.utc).strftime('%Y-%m-%d')}", 0
        )
        return FundFlowWriteResponse(
            table=table,
            partition=f"date={datetime.now(timezone.utc).strftime('%Y-%m-%d')}",
            rows_written=0,
            idempotent=True,
        )

    table, partition, rows = write_fund_flow_record(req.scenario, req.record)
    return FundFlowWriteResponse(table=table, partition=partition, rows_written=rows, idempotent=False)
