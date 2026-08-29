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


# ─── Registry: fail-closed when unconfigured ──────────────────────────────────

class TestRegistryFailClosed:
    """No MLflow registry configured -> honest 503s, never fake entries."""

    def test_no_hardcoded_registry(self):
        """Regression guard: the fabricated MODEL_REGISTRY/AB_TESTS are gone."""
        assert not hasattr(svc, "MODEL_REGISTRY")
        assert not hasattr(svc, "AB_TESTS")

    def test_list_models_503_when_unconfigured(self):
        r = client.get("/models")
        assert r.status_code == 503
        assert r.json()["detail"]["status"] == "REGISTRY_UNAVAILABLE"

    def test_get_model_503_when_unconfigured(self):
        r = client.get("/models/risk-model:1")
        assert r.status_code == 503
        assert r.json()["detail"]["status"] == "REGISTRY_UNAVAILABLE"

    def test_promote_503_when_unconfigured(self):
        r = client.post("/models/risk-model:1/promote")
        assert r.status_code == 503

    def test_metrics_history_503_when_unconfigured(self):
        r = client.get("/models/metrics/history")
        assert r.status_code == 503

    def test_ab_tests_not_configured(self):
        r = client.get("/ab-tests")
        assert r.status_code == 200
        assert r.json()["status"] == "AB_NOT_CONFIGURED"

    def test_create_ab_test_rejected(self):
        r = client.post("/ab-tests", json={"champion_version": "x"})
        assert r.status_code == 409
        assert r.json()["detail"]["status"] == "AB_ENV_CONFIGURED"


# ─── Deterministic A/B assignment ─────────────────────────────────────────────

class TestDeterministicAB:
    def test_same_entity_same_bucket(self):
        a = svc.assign_ab_bucket("DECL-123")
        b = svc.assign_ab_bucket("DECL-123")
        assert a == b

    def test_bucket_in_range(self):
        for i in range(200):
            assert 0 <= svc.assign_ab_bucket(f"DECL-{i}")["bucket"] < 100

    def test_split_approximately_matches_config(self):
        champion = sum(
            1 for i in range(2000)
            if svc.assign_ab_bucket(f"entity-{i}")["variant"] == "champion"
        )
        # Default split is 50%; sha256 bucketing should land within 35-65%
        assert 0.35 < champion / 2000 < 0.65

    def test_variant_maps_to_configured_models(self, monkeypatch):
        monkeypatch.setattr(svc, "AB_CHAMPION_MODEL", "risk:1")
        monkeypatch.setattr(svc, "AB_CHALLENGER_MODEL", "risk:2")
        for i in range(50):
            res = svc.assign_ab_bucket(f"e-{i}")
            expected = "risk:1" if res["variant"] == "champion" else "risk:2"
            assert res["model"] == expected


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

    def test_score_reports_honest_rules_identity(self):
        payload = {
            "declaration_id": "DECL-HONEST-001",
            "trader_id": "trader-api",
            "hs_code": "0901.21",
            "origin_country": "GH",
            "destination_country": "NG",
            "declared_value_usd": 10000.0,
            "weight_kg": 1000.0,
            "document_count": 5,
        }
        data = client.post("/score", json=payload).json()
        # The score is produced by deterministic rules and must say so.
        assert data["model_version"] == "rules-only-2.0.0"


# ─── Real MLflow registry integration (file store, skipped without mlflow) ────

mlflow = pytest.importorskip("mlflow", reason="mlflow not installed")


@pytest.fixture
def real_registry(tmp_path, monkeypatch):
    """Stand up a REAL MLflow file-store registry with two real model versions
    backed by real runs carrying real metrics."""
    from mlflow.tracking import MlflowClient

    store_uri = f"sqlite:///{tmp_path}/mlflow.db"
    reg_client = MlflowClient(tracking_uri=store_uri)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", store_uri)

    versions = {}
    for name, ver_metrics in (("risk-champion", {"auc_roc": 0.71, "f1": 0.66}),
                              ("risk-challenger", {"auc_roc": 0.74, "f1": 0.69})):
        reg_client.create_registered_model(name)
        exp_id = reg_client.create_experiment(f"exp-{name}", artifact_location=str(tmp_path / f"artifacts-{name}"))
        run = reg_client.create_run(exp_id)
        for k, v in ver_metrics.items():
            reg_client.log_metric(run.info.run_id, k, v)
        model_dir = tmp_path / f"model-{name}"
        model_dir.mkdir()
        (model_dir / "MLmodel").write_text("flavors: {}\n")
        reg_client.log_artifacts(run.info.run_id, str(model_dir), artifact_path="model")
        mv = reg_client.create_model_version(
            name, source=f"{run.info.artifact_uri}/model", run_id=run.info.run_id
        )
        versions[name] = mv.version

    # Point the service at this real registry
    monkeypatch.setattr(svc, "MLFLOW_TRACKING_URI", store_uri)
    monkeypatch.setattr(svc, "_mlflow_client", None)
    svc._registry_cache.clear()
    yield versions
    monkeypatch.setattr(svc, "MLFLOW_TRACKING_URI", None)
    monkeypatch.setattr(svc, "_mlflow_client", None)
    svc._registry_cache.clear()


class TestRealRegistry:
    def test_models_returns_real_entries(self, real_registry):
        data = client.get("/models").json()
        names = {m["name"] for m in data}
        assert {"risk-champion", "risk-challenger"} <= names

    def test_real_metrics_surfaced(self, real_registry):
        data = client.get("/models").json()
        champ = next(m for m in data if m["name"] == "risk-champion")
        assert champ["metrics"]["auc_roc"] == pytest.approx(0.71)

    def test_get_single_model(self, real_registry):
        v = real_registry["risk-champion"]
        data = client.get(f"/models/risk-champion:{v}").json()
        assert data["name"] == "risk-champion"
        assert data["version"] == str(v)
        assert data["metrics"]["f1"] == pytest.approx(0.66)

    def test_promote_sets_real_alias(self, real_registry):
        v = real_registry["risk-challenger"]
        r = client.post(f"/models/risk-challenger:{v}/promote")
        assert r.status_code == 200
        assert "champion" in r.json()["model"]["aliases"]

    def test_metrics_history_real(self, real_registry):
        data = client.get("/models/metrics/history").json()
        assert any(m["metrics"] and "auc_roc" in m["metrics"] for m in data)

    def test_ab_tests_surfaces_both_versions_real_metrics(self, real_registry, monkeypatch):
        monkeypatch.setattr(svc, "AB_CHAMPION_MODEL", f"risk-champion:{real_registry['risk-champion']}")
        monkeypatch.setattr(svc, "AB_CHALLENGER_MODEL", f"risk-challenger:{real_registry['risk-challenger']}")
        data = client.get("/ab-tests").json()
        assert data["status"] == "RUNNING"
        assert data["champion"]["metrics"]["auc_roc"] == pytest.approx(0.71)
        assert data["challenger"]["metrics"]["auc_roc"] == pytest.approx(0.74)
        assert data["traffic_split_pct"] == {"champion": 50, "challenger": 50}

    def test_score_includes_deterministic_ab_assignment(self, real_registry, monkeypatch):
        monkeypatch.setattr(svc, "AB_CHAMPION_MODEL", f"risk-champion:{real_registry['risk-champion']}")
        monkeypatch.setattr(svc, "AB_CHALLENGER_MODEL", f"risk-challenger:{real_registry['risk-challenger']}")
        payload = {
            "declaration_id": "DECL-AB-001",
            "trader_id": "trader-ab",
            "hs_code": "0901.21",
            "origin_country": "GH",
            "destination_country": "NG",
            "declared_value_usd": 10000.0,
            "weight_kg": 1000.0,
            "document_count": 5,
        }
        a = client.post("/score", json=payload).json()
        assert a["ab_assignment"]["variant"] in ("champion", "challenger")
        assert a["ab_assignment"]["model"].startswith("risk-")
        # Deterministic: same entity -> same assignment
        b = client.post("/score", json=payload).json()
        assert a["ab_assignment"] == b["ab_assignment"]
