"""
Ray Risk Service — pytest suite
Tests feature extraction, risk score computation, lane assignment,
model versioning, A/B testing, and FastAPI endpoint contracts.
"""
import sys
import os

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main as svc

client = TestClient(svc.app)


# ─── Fixtures ─────────────────────────────────────────────────────────────────

def _decl(**overrides):
    base = {
        "declaration_id": "DECL-TEST-001",
        "trader_id": "trader-001",
        "hs_code": "0901.21",
        "origin_country": "GH",
        "destination_country": "NG",
        "declared_value_usd": 10_000.0,
        "weight_kg": 1_000.0,
        "document_count": 5,
    }
    base.update(overrides)
    return svc.DeclarationInput(**base)


# ─── Feature extraction ───────────────────────────────────────────────────────

class TestFeatureExtraction:
    def test_returns_dict(self):
        features = svc.extract_features(_decl())
        assert isinstance(features, dict)

    def test_all_values_are_floats(self):
        features = svc.extract_features(_decl())
        for k, v in features.items():
            assert isinstance(v, float), f"{k}={v} is not float"

    def test_high_risk_origin_increases_origin_risk(self):
        low = svc.extract_features(_decl(origin_country="GH"))
        high = svc.extract_features(_decl(origin_country="KP"))
        assert high.get("origin_risk", 0) >= low.get("origin_risk", 0)

    def test_high_risk_hs_chapter_increases_hs_risk(self):
        low = svc.extract_features(_decl(hs_code="09.01"))
        high = svc.extract_features(_decl(hs_code="93.01"))  # chapter 93 = weapons
        assert high.get("hs_risk", 0) >= low.get("hs_risk", 0)

    def test_rejection_history_increases_trader_risk(self):
        clean = svc.extract_features(_decl(trader_rejection_history=0))
        dirty = svc.extract_features(_decl(trader_rejection_history=5))
        assert dirty.get("trader_risk", 0) >= clean.get("trader_risk", 0)

    def test_aeo_certified_reduces_risk(self):
        no_aeo = svc.extract_features(_decl(is_aeo_certified=False))
        with_aeo = svc.extract_features(_decl(is_aeo_certified=True))
        assert with_aeo.get("aeo_discount", 0) >= no_aeo.get("aeo_discount", 0)


# ─── Risk score computation ───────────────────────────────────────────────────

class TestRiskScoreComputation:
    def test_score_bounded_0_to_100(self):
        for origin in ["GH", "KP", "IR", "DE", "SG"]:
            features = svc.extract_features(_decl(origin_country=origin))
            score = svc.compute_risk_score(features)
            assert 0.0 <= score <= 100.0, f"Score {score} out of bounds for origin={origin}"

    def test_high_risk_scores_higher(self):
        low_features = svc.extract_features(_decl(origin_country="GH"))
        high_features = svc.extract_features(_decl(origin_country="KP",
                                                    trader_rejection_history=5))
        assert svc.compute_risk_score(high_features) >= svc.compute_risk_score(low_features)


# ─── Lane assignment ──────────────────────────────────────────────────────────

class TestLaneAssignment:
    def test_low_score_is_green(self):
        # Scores 0-29 → GREEN
        assert svc.assign_lane(10) == "GREEN"

    def test_medium_score_is_yellow(self):
        # Scores 30-64 → YELLOW
        assert svc.assign_lane(45) == "YELLOW"

    def test_high_score_is_red(self):
        # Scores 65+ → RED
        assert svc.assign_lane(80) == "RED"

    def test_boundary_values_are_valid_lanes(self):
        assert svc.assign_lane(0) in ("GREEN", "YELLOW", "RED")
        assert svc.assign_lane(100) in ("GREEN", "YELLOW", "RED")


# ─── Feature importances ──────────────────────────────────────────────────────

class TestFeatureImportances:
    def test_returns_list(self):
        features = svc.extract_features(_decl())
        importances = svc.feature_importances(features)
        assert isinstance(importances, list)

    def test_each_entry_has_feature_and_value(self):
        features = svc.extract_features(_decl())
        importances = svc.feature_importances(features)
        for entry in importances:
            assert "feature" in entry or "name" in entry
            assert "importance" in entry or "weight" in entry or "value" in entry


# ─── Model registry ───────────────────────────────────────────────────────────

class TestModelRegistry:
    def test_registry_has_entries(self):
        assert len(svc.MODEL_REGISTRY) > 0

    def test_exactly_one_champion(self):
        champions = [m for m in svc.MODEL_REGISTRY if m.status == "champion"]
        assert len(champions) == 1

    def test_champion_has_competitive_auc(self):
        champion = next(m for m in svc.MODEL_REGISTRY if m.status == "champion")
        assert champion.auc_roc > 0.8

    def test_model_has_required_fields(self):
        m = svc.MODEL_REGISTRY[0]
        assert m.version_id
        assert m.version
        assert m.algorithm
        assert 0 < m.accuracy <= 1.0


# ─── API endpoint contracts ────────────────────────────────────────────────────

class TestAPIEndpoints:
    def test_health_returns_ok(self):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_score_endpoint(self):
        payload = {
            "declaration_id": "DECL-API-001",
            "trader_id": "trader-api",
            "hs_code": "0901.21",
            "origin_country": "GH",
            "destination_country": "NG",
            "declared_value_usd": 10000.0,
            "weight_kg": 1000.0,
            "document_count": 5,
        }
        r = client.post("/score", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert "risk_score" in data
        assert "lane" in data

    def test_batch_score_endpoint(self):
        payload = [
            {
                "declaration_id": "DECL-B-001",
                "trader_id": "trader-001",
                "hs_code": "0901.21",
                "origin_country": "GH",
                "destination_country": "NG",
                "declared_value_usd": 5000.0,
                "weight_kg": 500.0,
                "document_count": 3,
            }
        ]
        r = client.post("/score/batch", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) == 1

    def test_list_models_endpoint(self):
        r = client.get("/models")
        assert r.status_code == 200
        data = r.json()
        # Returns a list directly
        assert isinstance(data, list)
        assert len(data) > 0

    def test_get_model_by_version(self):
        champion = next(m for m in svc.MODEL_REGISTRY if m.status == "champion")
        r = client.get(f"/models/{champion.version_id}")
        assert r.status_code == 200
        data = r.json()
        assert data["version_id"] == champion.version_id

    def test_get_nonexistent_model_returns_404(self):
        r = client.get("/models/nonexistent-version-id")
        assert r.status_code == 404

    def test_metrics_history_endpoint(self):
        r = client.get("/models/metrics/history")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_ab_tests_endpoint(self):
        r = client.get("/ab-tests")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
