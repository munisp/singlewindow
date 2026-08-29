"""
Ray Risk Scorer Service — pytest suite
Tests feature extraction, risk scoring, lane assignment, AEO discounts,
and FastAPI endpoint contracts.
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
        "ucr": "UCR-TEST-001",
        "hs_code": "0901.21",
        "declared_value": 10_000.0,
        "origin_country": "GH",
        "dest_country": "NG",
        "trader_id": "trader-001",
    }
    base.update(overrides)
    return svc.DeclarationFeatures(**base)


# ─── Feature extraction ───────────────────────────────────────────────────────

class TestFeatureExtraction:
    def test_extract_features_returns_dict(self):
        features = svc.extract_features(_decl())
        assert isinstance(features, dict)

    def test_all_feature_values_are_floats(self):
        features = svc.extract_features(_decl())
        for k, v in features.items():
            assert isinstance(v, float), f"Feature {k} is not float: {v}"

    def test_high_risk_hs_code_increases_hs_risk(self):
        low = svc.extract_features(_decl(hs_code="0901.21"))
        high = svc.extract_features(_decl(hs_code="9301.00"))  # weapons chapter
        assert high.get("hs_risk", 0) >= low.get("hs_risk", 0)

    def test_high_risk_origin_increases_origin_risk(self):
        low = svc.extract_features(_decl(origin_country="GH"))
        high = svc.extract_features(_decl(origin_country="AF"))
        assert high.get("origin_risk", 0) >= low.get("origin_risk", 0)

    def test_aeo_full_increases_aeo_discount(self):
        no_aeo = svc.extract_features(_decl(aeo_status=None))
        with_aeo = svc.extract_features(_decl(aeo_status="FULL"))
        assert with_aeo.get("aeo_discount", 0) >= no_aeo.get("aeo_discount", 0)

    def test_violation_history_increases_risk(self):
        clean = svc.extract_features(_decl(trader_violation_count=0))
        dirty = svc.extract_features(_decl(trader_violation_count=5))
        assert dirty.get("trader_risk", 0) >= clean.get("trader_risk", 0)


# ─── Risk scoring ─────────────────────────────────────────────────────────────

class TestRiskScoring:
    def test_score_returns_risk_score_object(self):
        result = svc.score_declaration(_decl())
        assert isinstance(result, svc.RiskScore)

    def test_score_bounded_0_to_100(self):
        for origin in ["GH", "AF", "KP", "DE", "SG"]:
            result = svc.score_declaration(_decl(origin_country=origin))
            assert 0 <= result.score <= 100, f"Score out of bounds for origin={origin}"

    def test_high_risk_declaration_scores_higher(self):
        low = svc.score_declaration(_decl(origin_country="GH", hs_code="0901.21"))
        high = svc.score_declaration(_decl(origin_country="AF", hs_code="9301.00",
                                           trader_violation_count=5))
        assert high.score >= low.score

    def test_aeo_full_reduces_score(self):
        no_aeo = svc.score_declaration(_decl(aeo_status=None))
        with_aeo = svc.score_declaration(_decl(aeo_status="FULL"))
        assert with_aeo.score <= no_aeo.score

    def test_score_has_risk_tier(self):
        result = svc.score_declaration(_decl())
        assert result.risk_tier in ("GREEN", "YELLOW", "RED")

    def test_score_has_lane(self):
        result = svc.score_declaration(_decl())
        assert result.lane in ("AUTO_APPROVE", "DOC_CHECK", "PHYSICAL_INSPECTION")

    def test_score_has_feature_contributions(self):
        result = svc.score_declaration(_decl())
        assert isinstance(result.feature_contributions, dict)

    def test_score_has_recommendation(self):
        result = svc.score_declaration(_decl())
        assert isinstance(result.recommendation, str)


# ─── Lane assignment ──────────────────────────────────────────────────────────

class TestLaneAssignment:
    def test_clean_declaration_gets_green_or_yellow(self):
        result = svc.score_declaration(_decl(
            origin_country="SG", hs_code="0901.21",
            aeo_status="FULL", trader_declaration_count=100,
        ))
        assert result.risk_tier in ("GREEN", "YELLOW")

    def test_high_risk_declaration_gets_yellow_or_red(self):
        result = svc.score_declaration(_decl(
            origin_country="AF", hs_code="9301.00",
            trader_violation_count=10,
        ))
        assert result.risk_tier in ("YELLOW", "RED")


# ─── API endpoint contracts ────────────────────────────────────────────────────

class TestAPIEndpoints:
    def test_health_returns_healthy(self):
        r = client.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "healthy"

    def test_score_endpoint(self):
        payload = {
            "ucr": "UCR-API-001",
            "hs_code": "0901.21",
            "declared_value": 10000.0,
            "origin_country": "GH",
            "dest_country": "NG",
            "trader_id": "trader-api",
        }
        r = client.post("/score", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert "score" in data
        assert "risk_tier" in data
        assert "lane" in data

    def test_batch_score_endpoint(self):
        payload = {
            "declarations": [
                {
                    "ucr": "UCR-BATCH-001",
                    "hs_code": "0901.21",
                    "declared_value": 5000.0,
                    "origin_country": "GH",
                    "dest_country": "NG",
                    "trader_id": "trader-batch",
                },
                {
                    "ucr": "UCR-BATCH-002",
                    "hs_code": "8471.30",
                    "declared_value": 50000.0,
                    "origin_country": "CN",
                    "dest_country": "NG",
                    "trader_id": "trader-batch",
                },
            ]
        }
        r = client.post("/batch-score", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert "results" in data
        assert len(data["results"]) == 2

    def test_model_stats_endpoint(self):
        """Without a deployed model, /model-stats must report NO_MODEL_DEPLOYED
        and must NOT contain fabricated performance metrics."""
        r = client.get("/model-stats")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "NO_MODEL_DEPLOYED"
        assert "message" in data
        # No invented metrics may leak through
        for fabricated in ("auc_roc", "precision", "recall", "f1_score",
                           "training_samples", "last_trained"):
            assert fabricated not in data

    def test_feature_importance_endpoint(self):
        r = client.get("/feature-importance")
        assert r.status_code == 200
        # Returns a list of feature importance dicts
        data = r.json()
        assert isinstance(data, list) or isinstance(data, dict)

    def test_score_missing_required_fields_returns_422(self):
        r = client.post("/score", json={"ucr": "X"})
        assert r.status_code == 422


# ─── Honest ML layer (fail-closed + real ONNX inference) ─────────────────────

FIXTURE_MODEL = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "fixtures", "tiny_risk_model.onnx"
)


@pytest.fixture
def restore_model_layer():
    """Snapshot and restore the global model layer + config."""
    saved = (svc.MODEL_LAYER, svc.RISK_MODEL_PATH, svc.RISK_MODEL_VERSION,
             svc.RISK_MODEL_METRICS_PATH)
    yield
    (svc.MODEL_LAYER, svc.RISK_MODEL_PATH, svc.RISK_MODEL_VERSION,
     svc.RISK_MODEL_METRICS_PATH) = saved


class TestNoFakeNoise:
    def test_scoring_is_deterministic(self):
        """Regression guard: MD5-hash 'noise' was removed — identical input
        must produce identical scores."""
        a = svc.score_declaration(_decl())
        b = svc.score_declaration(_decl())
        assert a.score == b.score

    def test_scores_have_no_hash_jitter(self):
        """Two declarations differing only in UCR must get the same score
        (previously the UCR MD5 hash injected ±5 points of fake variance)."""
        a = svc.score_declaration(_decl(ucr="UCR-AAA"))
        b = svc.score_declaration(_decl(ucr="UCR-ZZZ"))
        assert a.score == b.score


class TestFailClosedModelLayer:
    def test_unloadable_model_stays_unavailable(self, restore_model_layer):
        svc.RISK_MODEL_PATH = "/nonexistent/model.onnx"
        svc.MODEL_LAYER = svc._load_model_layer()
        assert not svc.MODEL_LAYER.available
        r = client.post("/score", json=_decl().model_dump())
        assert r.status_code == 200
        assert r.json()["ml_augmentation"] == "UNAVAILABLE"

    def test_score_reports_unavailable_without_model(self, restore_model_layer):
        svc.MODEL_LAYER = svc.OnnxModelLayer(None)
        data = client.post("/score", json=_decl().model_dump()).json()
        assert data["ml_augmentation"] == "UNAVAILABLE"
        assert data["ml_model_version"] is None


class TestRealOnnxInference:
    def test_real_model_loaded_and_applied(self, restore_model_layer):
        """With a real ONNX artefact, inference runs and the score is blended."""
        svc.RISK_MODEL_PATH = FIXTURE_MODEL
        svc.RISK_MODEL_VERSION = "tiny-fixture-1"
        svc.MODEL_LAYER = svc._load_model_layer()
        assert svc.MODEL_LAYER.available

        data = client.post("/score", json=_decl().model_dump()).json()
        assert data["ml_augmentation"] == "APPLIED"
        assert data["ml_model_version"] == "tiny-fixture-1"
        assert 0 <= data["score"] <= 100

        # Direct layer call returns a real 0-100 score
        features = svc.extract_features(_decl())
        ml_score = svc.MODEL_LAYER.score(features)
        assert ml_score is not None and 0 <= ml_score <= 100

    def test_model_stats_with_real_model(self, restore_model_layer, tmp_path):
        svc.RISK_MODEL_PATH = FIXTURE_MODEL
        svc.RISK_MODEL_VERSION = "tiny-fixture-1"
        svc.MODEL_LAYER = svc._load_model_layer()

        # No metrics file -> metrics null, never invented
        svc.RISK_MODEL_METRICS_PATH = None
        data = client.get("/model-stats").json()
        assert data["status"] == "MODEL_DEPLOYED"
        assert data["model_version"] == "tiny-fixture-1"
        assert data["metrics"] is None
        assert "auc_roc" not in data

        # Real metrics file -> surfaced verbatim
        metrics_file = tmp_path / "metrics.json"
        metrics_file.write_text('{"auc_roc": 0.71, "evaluated_on": "2026-01-01"}')
        svc.RISK_MODEL_METRICS_PATH = str(metrics_file)
        data = client.get("/model-stats").json()
        assert data["metrics"]["auc_roc"] == 0.71

    def test_rules_red_never_softened_by_ml(self):
        """Fail-closed blend: rule-layer RED (>=65) is returned unchanged."""
        assert svc.blend_scores(80.0, 0.0) == 80.0
        assert svc.blend_scores(65.0, 0.0) == 65.0
        # Below RED, the ML layer genuinely augments
        assert svc.blend_scores(50.0, 0.0) == pytest.approx(0.6 * 50.0)
        assert svc.blend_scores(50.0, 100.0) == pytest.approx(0.6 * 50.0 + 40.0)
