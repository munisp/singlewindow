"""
test_retrain.py — pytest tests for the insider-threat-svc retraining pipeline.

Tests cover:
  - /train endpoint: valid input, too few events, contamination bounds
  - model persistence: save_model / load_current_model round-trip
  - scheduler: start/stop, job registration, next_run_time
  - /detect: with and without a trained model
  - /model/info and /model/versions
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sklearn.ensemble import IsolationForest

# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def tmp_models_dir(tmp_path, monkeypatch):
    """Redirect model storage to a temporary directory for each test."""
    monkeypatch.setenv("MODELS_DIR", str(tmp_path / "models"))
    # Re-import model_store so it picks up the new env var
    import importlib
    import model_store
    importlib.reload(model_store)
    yield tmp_path / "models"


def _make_events(n: int = 50) -> list[dict]:
    """Generate synthetic event dicts for training."""
    rng = np.random.default_rng(42)
    events = []
    for i in range(n):
        events.append({
            "hour_of_day": int(rng.integers(0, 24)),
            "action_count_per_hour": int(rng.integers(1, 60)),
            "unique_records_accessed": int(rng.integers(1, 20)),
            "role": rng.choice(["trader", "customs_officer", "finance"]),
            "action": rng.choice(["query", "bulk-export", "approve-payment", "general"]),
            "is_anomaly": bool(rng.random() < 0.05),
        })
    return events


# ─── anomaly_detector tests ───────────────────────────────────────────────────

class TestAnomalyDetector:
    def test_extract_features_shape(self):
        from anomaly_detector import extract_features
        vec = extract_features(14, 5, 3, "trader", "query")
        assert vec.shape == (1, 5)

    def test_off_hours_flag(self):
        from anomaly_detector import extract_features
        night = extract_features(3, 1, 1, "trader", "query")
        day = extract_features(10, 1, 1, "trader", "query")
        assert night[0][3] == 1.0
        assert day[0][3] == 0.0

    def test_role_mismatch_trader_admin(self):
        from anomaly_detector import extract_features
        vec = extract_features(10, 1, 1, "trader", "aeo-revoke")
        assert vec[0][4] == 1.0  # trader doing admin = max mismatch

    def test_train_model_returns_tuple(self):
        from anomaly_detector import train_model
        events = _make_events(50)
        model, scaler, metrics = train_model(events, contamination=0.05)
        assert isinstance(model, IsolationForest)
        assert scaler is not None
        assert "n_anomalies_detected" in metrics

    def test_train_model_too_few_events(self):
        from anomaly_detector import train_model
        with pytest.raises(ValueError, match="at least 10"):
            train_model([{"hour_of_day": 10, "action_count_per_hour": 1,
                          "unique_records_accessed": 1, "role": "trader", "action": "query"}])

    def test_score_event_range(self):
        from anomaly_detector import train_model, score_event
        events = _make_events(100)
        model, scaler, _ = train_model(events)
        score = score_event(model, scaler, 14, 5, 3, "trader", "query")
        assert 0.0 <= score <= 1.0

    def test_score_event_no_scaler(self):
        from anomaly_detector import train_model, score_event
        events = _make_events(100)
        model, _, _ = train_model(events)
        score = score_event(model, None, 14, 5, 3, "trader", "query")
        assert 0.0 <= score <= 1.0


# ─── model_store tests ────────────────────────────────────────────────────────

class TestModelStore:
    def test_save_and_load_model(self, tmp_models_dir):
        import importlib
        import model_store
        importlib.reload(model_store)

        from anomaly_detector import train_model
        events = _make_events(50)
        model, scaler, metrics = train_model(events)

        version = model_store.save_model(model, len(events), metrics, 0.05)
        assert version == 1

        loaded = model_store.load_current_model()
        assert loaded is not None

    def test_metadata_written(self, tmp_models_dir):
        import importlib
        import model_store
        importlib.reload(model_store)

        from anomaly_detector import train_model
        events = _make_events(50)
        model, scaler, metrics = train_model(events)
        model_store.save_model(model, len(events), metrics, 0.05)

        meta = model_store.load_metadata()
        assert meta is not None
        assert meta["version"] == 1
        assert meta["n_samples"] == len(events)

    def test_version_increments(self, tmp_models_dir):
        import importlib
        import model_store
        importlib.reload(model_store)

        from anomaly_detector import train_model
        events = _make_events(50)
        model, scaler, metrics = train_model(events)

        v1 = model_store.save_model(model, len(events), metrics, 0.05)
        v2 = model_store.save_model(model, len(events), metrics, 0.05)
        assert v2 == v1 + 1

    def test_no_model_returns_none(self, tmp_models_dir):
        import importlib
        import model_store
        importlib.reload(model_store)

        result = model_store.load_current_model()
        assert result is None


# ─── FastAPI endpoint tests ───────────────────────────────────────────────────

@pytest.fixture
def client(tmp_models_dir):
    """Create a TestClient with a fresh app instance."""
    import importlib
    import model_store
    importlib.reload(model_store)

    import main as app_module
    importlib.reload(app_module)
    app_module._model = None
    app_module._scaler = None

    return TestClient(app_module.app)


class TestEndpoints:
    def test_health_no_model(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["model_loaded"] is False

    def test_detect_heuristic_fallback(self, client):
        resp = client.post("/detect", json={
            "user_id": "u1", "session_id": "s1",
            "role": "trader", "action": "query",
            "hour_of_day": 3, "action_count_per_hour": 40,
            "unique_records_accessed": 5,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert 0.0 <= data["anomaly_score"] <= 1.0
        assert "blocked" in data

    def test_train_endpoint(self, client):
        events = _make_events(60)
        resp = client.post("/train", json={
            "events": events,
            "contamination": 0.05,
            "n_estimators": 50,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["version"] == 1
        assert data["n_samples"] == 60

    def test_train_too_few_events(self, client):
        resp = client.post("/train", json={
            "events": [{"hour_of_day": 10, "action_count_per_hour": 1,
                        "unique_records_accessed": 1, "role": "trader", "action": "query"}],
            "contamination": 0.05,
        })
        assert resp.status_code == 422

    def test_detect_with_trained_model(self, client):
        # First train
        events = _make_events(60)
        client.post("/train", json={"events": events, "contamination": 0.05, "n_estimators": 50})

        # Then detect
        resp = client.post("/detect", json={
            "user_id": "u2", "session_id": "s2",
            "role": "trader", "action": "bulk-export",
            "hour_of_day": 2, "action_count_per_hour": 55,
            "unique_records_accessed": 18,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["model_version"] == 1

    def test_model_info_no_model(self, client):
        resp = client.get("/model/info")
        assert resp.status_code == 200
        assert resp.json()["model_loaded"] is False

    def test_model_info_after_train(self, client):
        events = _make_events(60)
        client.post("/train", json={"events": events, "contamination": 0.05, "n_estimators": 50})
        resp = client.get("/model/info")
        assert resp.status_code == 200
        data = resp.json()
        assert data["model_loaded"] is True
        assert data["version"] == 1

    def test_model_versions(self, client):
        events = _make_events(60)
        client.post("/train", json={"events": events, "contamination": 0.05, "n_estimators": 50})
        resp = client.get("/model/versions")
        assert resp.status_code == 200
        versions = resp.json()["versions"]
        assert len(versions) >= 1
        assert versions[0]["version"] == 1


# ─── Scheduler tests ──────────────────────────────────────────────────────────

class TestScheduler:
    def test_start_stop_scheduler(self):
        from retrain_scheduler import start_scheduler, stop_scheduler
        scheduler = start_scheduler()
        assert scheduler.running is True
        stop_scheduler()
        assert scheduler.running is False

    def test_nightly_job_registered(self):
        from retrain_scheduler import start_scheduler, stop_scheduler, _scheduler
        scheduler = start_scheduler()
        job = scheduler.get_job("nightly_retrain")
        assert job is not None
        assert job.name == "Nightly IsolationForest Retraining"
        stop_scheduler()

    def test_get_next_run_time(self):
        from retrain_scheduler import start_scheduler, stop_scheduler, get_next_run_time
        start_scheduler()
        nrt = get_next_run_time()
        assert nrt is not None
        assert "T" in nrt  # ISO8601 format
        stop_scheduler()

    def test_run_nightly_retrain_no_db(self):
        """Should return None gracefully when DATABASE_URL is not set."""
        from retrain_scheduler import run_nightly_retrain
        with patch.dict(os.environ, {"DATABASE_URL": "", "RETRAIN_MIN_EVENTS": "50"}):
            result = run_nightly_retrain()
        assert result is None


    def test_env_gated_scheduler_disabled_by_default(self, tmp_models_dir):
        """RETRAIN_SCHEDULER_ENABLED unset -> lifespan does NOT start APScheduler."""
        import importlib
        import main as app_module
        importlib.reload(app_module)
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("RETRAIN_SCHEDULER_ENABLED", None)
            with TestClient(app_module.app):
                import retrain_scheduler
                assert retrain_scheduler._scheduler is None or \
                    not retrain_scheduler._scheduler.running

    def test_env_gated_scheduler_enabled(self, tmp_models_dir):
        """RETRAIN_SCHEDULER_ENABLED=true -> lifespan starts and stops the
        nightly retrain scheduler cleanly."""
        import importlib
        import main as app_module
        importlib.reload(app_module)
        import retrain_scheduler
        importlib.reload(retrain_scheduler)
        with patch.dict(os.environ, {"RETRAIN_SCHEDULER_ENABLED": "true",
                                     "DATABASE_URL": ""}):
            with TestClient(app_module.app):
                assert retrain_scheduler._scheduler is not None
                assert retrain_scheduler._scheduler.running
                job = retrain_scheduler._scheduler.get_job("nightly_retrain")
                assert job is not None
            # After lifespan shutdown the scheduler is stopped
            assert not retrain_scheduler._scheduler.running
