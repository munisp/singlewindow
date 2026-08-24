import os
import sys
from datetime import datetime, timezone, timedelta

from fastapi.testclient import TestClient
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main as svc


def _write_fixture(root):
    now = datetime.now(timezone.utc)
    created_at = now - timedelta(days=2)
    partition = root / f"date={created_at.date().isoformat()}"
    partition.mkdir(parents=True)
    pq.write_table(
        pa.Table.from_pylist(
            [
                {
                    "id": 1,
                    "created_at": created_at,
                    "hs_code": "0901",
                    "country_of_origin": "GH",
                    "country_of_destination": "NG",
                    "invoice_value": 1000.0,
                    "duty_amount": 100.0,
                    "trader_id": 7,
                    "risk_lane": "green",
                    "submitted_at": created_at - timedelta(hours=1),
                    "cleared_at": created_at,
                },
                {
                    "id": 2,
                    "created_at": created_at,
                    "hs_code": "0901",
                    "country_of_origin": "GH",
                    "country_of_destination": "CI",
                    "invoice_value": 500.0,
                    "duty_amount": 50.0,
                    "trader_id": 8,
                    "risk_lane": "yellow",
                    "submitted_at": None,
                    "cleared_at": None,
                },
            ]
        ),
        partition / "declarations.parquet",
    )


def test_analytics_aggregates_real_parquet_facts(tmp_path, monkeypatch):
    _write_fixture(tmp_path)
    monkeypatch.setattr(svc, "LAKEHOUSE_ROOT", tmp_path)
    client = TestClient(svc.app)

    response = client.get("/trade-stats?period=monthly")
    assert response.status_code == 200
    assert response.json()["summary"] == {
        "total_declarations": 2,
        "total_value_usd": 1500.0,
        "total_duty_usd": 150.0,
        "average_clearance_hours": 1.0,
        "clearance_observation_count": 1,
        "green_lane_count": 1,
        "lane_observation_count": 2,
    }
    assert response.json()["lane_distribution"] == [
        {"lane": "green", "declaration_count": 1},
        {"lane": "yellow", "declaration_count": 1},
    ]
    assert response.json()["clearance"] == {
        "average_clearance_hours": 1.0,
        "clearance_observation_count": 1,
    }
    assert response.json()["as_of"]

    hs = client.get("/hs-code-volume?period=monthly")
    assert hs.status_code == 200
    assert hs.json()["hs_volumes"][0]["declaration_count"] == 2

    routes = client.get("/route-flow?period=monthly")
    assert routes.status_code == 200
    assert {row["route"] for row in routes.json()["routes"]} == {"GH->NG", "GH->CI"}


def test_stale_partitions_trigger_refresh(tmp_path, monkeypatch):
    _write_fixture(tmp_path)
    monkeypatch.setattr(svc, "LAKEHOUSE_ROOT", tmp_path)
    partition_file = next(tmp_path.glob("date=*/declarations.parquet"))
    old_timestamp = (datetime.now(timezone.utc) - timedelta(hours=2)).timestamp()
    os.utime(partition_file, (old_timestamp, old_timestamp))
    refreshed = []
    monkeypatch.setattr(svc, "LAKEHOUSE_MAX_AGE_SECONDS", 900)
    monkeypatch.setattr(svc, "_export_declarations", lambda: refreshed.append(True))

    svc._ensure_source()

    assert refreshed == [True]


def test_analytics_returns_reasoned_503_when_sources_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "LAKEHOUSE_ROOT", tmp_path / "missing")
    monkeypatch.setattr(svc, "DATABASE_URL", "")
    response = TestClient(svc.app).get("/trade-stats?period=monthly")
    assert response.status_code == 503
    assert response.json()["detail"]["reason"] == "analytics_source_unavailable"


def test_ingest_is_removed():
    response = TestClient(svc.app).post("/ingest", json={"events": []})
    assert response.status_code == 410
    assert response.json()["detail"]["reason"] == "synthetic_ingestion_removed"
