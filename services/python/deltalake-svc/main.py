"""
deltalake-svc — Delta Lake Analytics Pipeline Service
Port: 8103

Provides trade statistics aggregation, HS code volume analytics,
trader performance metrics, and route-level trade flow analytics
for the TradeGateway™ NGSWTP Trade Analytics dashboard.

In production this service uses delta-rs + PyArrow + DuckDB for
in-process analytics on Delta Lake Parquet partitions. Kafka
consumer ingests declaration events in real-time.
"""

from __future__ import annotations
from contextlib import asynccontextmanager

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Sequence

import duckdb
import psycopg2
import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fund_flow_writer import FundFlowWriteRequest, FundFlowWriteResponse, handle_fund_flow_write


# ─── Application Lifespan ───────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan: activates full middleware bundle on startup."""
    async with middleware_lifespan():
        yield

app = FastAPI(title="deltalake-svc", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

LAKEHOUSE_ROOT = Path(os.getenv("LAKEHOUSE_ROOT", "/var/lib/tradegateway/lakehouse"))
DATABASE_URL = os.getenv("DATABASE_URL", "")


def _period_cutoff(period: str) -> datetime:
    days = {"daily": 1, "weekly": 7, "monthly": 30, "quarterly": 90}[period]
    return datetime.now(timezone.utc) - timedelta(days=days)


def _parquet_files() -> list[str]:
    if not LAKEHOUSE_ROOT.is_dir():
        return []
    return [str(path) for path in LAKEHOUSE_ROOT.glob("date=*/declarations.parquet")]


def _export_declarations() -> int:
    if not DATABASE_URL:
        raise RuntimeError("postgres_not_configured")
    with psycopg2.connect(DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, created_at, hs_code, country_of_origin,
                       country_of_destination, invoice_value, duty_amount, trader_id
                FROM declarations
                ORDER BY created_at, id
                """
            )
            rows = cursor.fetchall()
            columns = [description[0] for description in cursor.description]

    LAKEHOUSE_ROOT.mkdir(parents=True, exist_ok=True)
    for existing in _parquet_files():
        Path(existing).unlink()
    by_date: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        record = dict(zip(columns, row))
        created_at = record["created_at"]
        if not isinstance(created_at, datetime):
            raise RuntimeError("invalid_created_at")
        by_date.setdefault(created_at.date().isoformat(), []).append(record)
    for date_key, records in by_date.items():
        partition = LAKEHOUSE_ROOT / f"date={date_key}"
        partition.mkdir(parents=True, exist_ok=True)
        pq.write_table(pa.Table.from_pylist(records), partition / "declarations.parquet")
    return len(rows)


def _ensure_source() -> list[str]:
    files = _parquet_files()
    if files:
        return files
    try:
        _export_declarations()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"reason": "analytics_source_unavailable", "cause": str(exc)},
        ) from exc
    files = _parquet_files()
    if not files and not LAKEHOUSE_ROOT.exists():
        raise HTTPException(
            status_code=503,
            detail={"reason": "analytics_source_unavailable", "cause": "lakehouse_root_missing"},
        )
    return files


def _query(query: str, parameters: Sequence[object] = ()) -> list[dict[str, object]]:
    files = _ensure_source()
    if not files:
        return []
    connection = duckdb.connect()
    try:
        result = connection.execute(query, [files, *parameters]).fetchall()
        names = [description[0] for description in connection.description]
        return [dict(zip(names, row)) for row in result]
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"reason": "analytics_query_unavailable", "cause": str(exc)},
        ) from exc
    finally:
        connection.close()


def _source_summary() -> dict[str, object]:
    rows = _query(
        """
        SELECT count(*)::BIGINT AS total_declarations,
               sum(invoice_value)::DOUBLE AS total_value_usd,
               sum(duty_amount)::DOUBLE AS total_duty_usd,
               count(DISTINCT country_of_origin)::BIGINT AS origin_countries,
               count(DISTINCT country_of_destination)::BIGINT AS destination_countries
        FROM read_parquet($1, union_by_name=true)
        """
    )
    return rows[0] if rows else {"total_declarations": 0}


def _base_query(period: str) -> tuple[str, list[object]]:
    return (
        """
        FROM read_parquet($1, union_by_name=true)
        WHERE created_at >= ?
        """,
        [_period_cutoff(period)],
    )

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict[str, object]:
    _ensure_source()
    summary = _source_summary()
    return {
        "status": "ok",
        "service": "deltalake-svc",
        "source": "postgresql_exported_parquet",
        "declarations_available": int(summary.get("total_declarations") or 0),
    }

@app.get("/trade-stats")
def get_trade_stats(period: str = Query("monthly", enum=["daily", "weekly", "monthly", "quarterly"])) -> dict[str, object]:
    from_clause, parameters = _base_query(period)
    summary_rows = _query(
        f"""SELECT count(*)::BIGINT AS total_declarations,
                   sum(invoice_value)::DOUBLE AS total_value_usd,
                   sum(duty_amount)::DOUBLE AS total_duty_usd
            {from_clause}""",
        parameters,
    )
    series = _query(
        f"""SELECT CAST(created_at AS DATE)::VARCHAR AS date,
                   count(*)::BIGINT AS declaration_count,
                   sum(invoice_value)::DOUBLE AS total_value_usd,
                   sum(duty_amount)::DOUBLE AS total_duty_usd
            {from_clause}
            GROUP BY CAST(created_at AS DATE)
            ORDER BY CAST(created_at AS DATE)""",
        parameters,
    )
    summary = dict(summary_rows[0]) if summary_rows else {"total_declarations": 0}
    return {
        "period": period,
        "summary": {key: value for key, value in summary.items() if value is not None},
        "time_series": [
            {key: value for key, value in row.items() if value is not None}
            for row in series[-30:]
        ],
        "source": "declarations",
    }

@app.get("/hs-code-volume")
def get_hs_code_volume(period: str = Query("monthly", enum=["daily", "weekly", "monthly", "quarterly"])) -> dict[str, object]:
    from_clause, parameters = _base_query(period)
    rows = _query(
        f"""SELECT hs_code,
                   count(*)::BIGINT AS declaration_count,
                   sum(invoice_value)::DOUBLE AS total_value_usd,
                   sum(duty_amount)::DOUBLE AS total_duty_usd
            {from_clause} AND hs_code IS NOT NULL
            GROUP BY hs_code
            ORDER BY declaration_count DESC""",
        parameters,
    )
    return {
        "hs_volumes": [{key: value for key, value in row.items() if value is not None} for row in rows],
        "total_chapters": len(rows),
        "period": period,
        "source": "declarations",
    }

@app.get("/trader-metrics")
def get_trader_metrics(period: str = Query("monthly", enum=["daily", "weekly", "monthly", "quarterly"]), limit: int = Query(20, ge=1, le=100)) -> dict[str, object]:
    from_clause, parameters = _base_query(period)
    rows = _query(
        f"""SELECT trader_id,
                   count(*)::BIGINT AS declaration_count,
                   sum(invoice_value)::DOUBLE AS total_value_usd,
                   sum(duty_amount)::DOUBLE AS total_duty_usd
            {from_clause} AND trader_id IS NOT NULL
            GROUP BY trader_id
            ORDER BY declaration_count DESC
            LIMIT {limit}""",
        parameters,
    )
    return {"traders": rows, "total_traders": len(rows), "period": period, "source": "declarations"}

@app.get("/route-flow")
def get_route_flow(period: str = Query("monthly", enum=["daily", "weekly", "monthly", "quarterly"])) -> dict[str, object]:
    from_clause, parameters = _base_query(period)
    rows = _query(
        f"""SELECT country_of_origin AS origin,
                   country_of_destination AS destination,
                   count(*)::BIGINT AS declaration_count,
                   sum(invoice_value)::DOUBLE AS total_value_usd
            {from_clause}
            AND country_of_origin IS NOT NULL
            AND country_of_destination IS NOT NULL
            GROUP BY country_of_origin, country_of_destination
            ORDER BY total_value_usd DESC NULLS LAST
            LIMIT 50""",
        parameters,
    )
    return {
        "routes": [{**row, "route": f"{row['origin']}->{row['destination']}"} for row in rows],
        "total_routes": len(rows),
        "period": period,
        "source": "declarations",
    }

@app.get("/duty-revenue")
def get_duty_revenue(period: str = Query("monthly", enum=["daily", "weekly", "monthly", "quarterly"])) -> dict[str, object]:
    from_clause, parameters = _base_query(period)
    rows = _query(
        f"""SELECT CAST(created_at AS DATE)::VARCHAR AS date,
                   sum(duty_amount)::DOUBLE AS duty_revenue_usd
            {from_clause} AND duty_amount IS NOT NULL
            GROUP BY CAST(created_at AS DATE)
            ORDER BY CAST(created_at AS DATE)""",
        parameters,
    )
    total = _query(
        f"SELECT sum(duty_amount)::DOUBLE AS total_duty_revenue_usd {from_clause}",
        parameters,
    )
    result: dict[str, object] = {
        "period": period,
        "time_series": rows[-30:],
        "source": "declarations",
    }
    if total and total[0].get("total_duty_revenue_usd") is not None:
        result["total_duty_revenue_usd"] = total[0]["total_duty_revenue_usd"]
    return result

@app.post("/fund-flow/write", response_model=FundFlowWriteResponse)
def write_fund_flow(req: FundFlowWriteRequest) -> FundFlowWriteResponse:
    """Idempotent fund-flow record persistence for all 20 scenarios."""
    return handle_fund_flow_write(req)

@app.post("/ingest")
def ingest_events() -> None:
    raise HTTPException(status_code=410, detail={"reason": "synthetic_ingestion_removed"})

# ─── PostgreSQL Write-back ───────────────────────────────────────────────────

class PostgresWriteBackRequest(BaseModel):
    table: str = "trade_stats_mirror"

class PostgresWriteBackResponse(BaseModel):
    success: bool
    table: str
    rows_affected: int
    source: str
    period: str
    timestamp: str

@app.post("/write-postgres", response_model=PostgresWriteBackResponse)
def write_postgres(req: PostgresWriteBackRequest) -> PostgresWriteBackResponse:
    if req.table != "trade_stats_mirror":
        raise HTTPException(status_code=400, detail={"reason": "table_not_allowed"})
    _ensure_source()
    summary = _source_summary()
    if not DATABASE_URL:
        raise HTTPException(status_code=503, detail={"reason": "postgres_not_configured"})
    timestamp = datetime.now(timezone.utc)
    with psycopg2.connect(DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS trade_stats_mirror (
                    period VARCHAR(16) PRIMARY KEY,
                    total_declarations BIGINT NOT NULL,
                    total_value_usd NUMERIC,
                    total_duty_usd NUMERIC,
                    generated_at TIMESTAMPTZ NOT NULL,
                    source VARCHAR(64) NOT NULL
                )
                """
            )
            cursor.execute(
                """
                INSERT INTO trade_stats_mirror
                    (period, total_declarations, total_value_usd, total_duty_usd,
                     generated_at, source)
                VALUES ('monthly', %s, %s, %s, %s, 'declarations')
                ON CONFLICT (period) DO UPDATE SET
                    total_declarations = EXCLUDED.total_declarations,
                    total_value_usd = EXCLUDED.total_value_usd,
                    total_duty_usd = EXCLUDED.total_duty_usd,
                    generated_at = EXCLUDED.generated_at,
                    source = EXCLUDED.source
                """,
                (
                    summary.get("total_declarations", 0),
                    summary.get("total_value_usd"),
                    summary.get("total_duty_usd"),
                    timestamp,
                ),
            )
    return PostgresWriteBackResponse(
        success=True, table=req.table, rows_affected=1,
        source="declarations", period="monthly", timestamp=timestamp.isoformat(),
    )


@app.get("/stats")
def get_stats() -> dict[str, object]:
    summary = _source_summary()
    return {
        key: value
        for key, value in {
            "total_events": summary.get("total_declarations"),
            "total_trade_value_usd": summary.get("total_value_usd"),
            "total_duty_revenue_usd": summary.get("total_duty_usd"),
            "origin_countries": summary.get("origin_countries"),
            "destination_countries": summary.get("destination_countries"),
            "source": "declarations",
        }.items()
        if value is not None
    }


# ─── Lifecycle ───────────────────────────────────────────────────────────────


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


    uvicorn.run(app, host="0.0.0.0", port=8103)
