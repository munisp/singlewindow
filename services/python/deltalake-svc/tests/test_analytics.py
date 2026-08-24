import os
import sys
from datetime import datetime, timezone, timedelta

from fastapi.testclient import TestClient
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main as svc


def _write_fixture(root):
    partition = root / f"date={(datetime.now(timezone.utc) - timedelta(days=2)).date().isoformat()}"
    partition.mkdir(parents=True)
    pq.write_table(
        pa.Table.from_pylist(
            [
                {
                    "id": 1,
                    "created_at": datetime.now(timezone.utc) - timedelta(days=2),
                    "hs_code": "0901",
                    "country_of_origin": "GH",
                    "country_of_destination": "NG",
                    "invoice_value": 1000.0,
                    "duty_amount": 100.0,
                    "trader_id": 7,
                },
                {
                    "id": 2,
                    "created_at": datetime.now(timezone.utc) - timedelta(days=2),
                    "hs_code": "0901",
                    "country_of_origin": "GH",
                    "country_of_destination": "CI",
                    "invoice_value": 500.0,
                    "duty_amount": 50.0,
                    "trader_id": 8,
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
    }

    hs = client.get("/hs-code-volume?period=monthly")
    assert hs.status_code == 200
    assert hs.json()["hs_volumes"][0]["declaration_count"] == 2

    routes = client.get("/route-flow?period=monthly")
    assert routes.status_code == 200
    assert {row["route"] for row in routes.json()["routes"]} == {"GH->NG", "GH->CI"}


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
