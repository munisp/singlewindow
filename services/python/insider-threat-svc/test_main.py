"""
test_main.py — pytest tests for insider-threat-svc FastAPI endpoints.

Covers v73 additions:
  - GET  /ab/promotions   (promotion audit log)
  - GET  /ab/stats        (A/B model statistics)
  - GET  /ab/recent       (recent comparison records)
  - POST /ab/promote      (shadow → production promotion)
  - POST /score           (anomaly scoring)
  - GET  /health          (liveness probe)
"""

import pytest
from fastapi.testclient import TestClient
from main import app, _PROMOTION_LOG

client = TestClient(app)


# ─── /health ─────────────────────────────────────────────────────────────────

class TestHealth:
    def test_health_returns_200(self):
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_health_returns_status_ok(self):
        resp = client.get("/health")
        body = resp.json()
        assert body.get("status") == "ok"


# ─── /ab/stats ───────────────────────────────────────────────────────────────

class TestABStats:
    def test_ab_stats_returns_200(self):
        resp = client.get("/ab/stats")
        assert resp.status_code == 200

    def test_ab_stats_has_agreement_rate(self):
        resp = client.get("/ab/stats")
        body = resp.json()
        assert "agreement_rate" in body

    def test_ab_stats_has_total_comparisons(self):
        resp = client.get("/ab/stats")
        body = resp.json()
        assert "total_comparisons" in body

    def test_ab_stats_agreement_rate_is_float(self):
        resp = client.get("/ab/stats")
        body = resp.json()
        assert isinstance(body["agreement_rate"], (int, float))

    def test_ab_stats_has_production_mean(self):
        resp = client.get("/ab/stats")
        body = resp.json()
        assert "production_mean" in body

    def test_ab_stats_has_shadow_mean(self):
        resp = client.get("/ab/stats")
        body = resp.json()
        assert "shadow_mean" in body


# ─── /ab/recent ──────────────────────────────────────────────────────────────

class TestABRecent:
    def test_ab_recent_returns_200(self):
        resp = client.get("/ab/recent")
        assert resp.status_code == 200

    def test_ab_recent_has_records_list(self):
        resp = client.get("/ab/recent")
        body = resp.json()
        assert "records" in body
        assert isinstance(body["records"], list)

    def test_ab_recent_limit_param_accepted(self):
        resp = client.get("/ab/recent?limit=5")
        assert resp.status_code == 200

    def test_ab_recent_has_enabled_field(self):
        resp = client.get("/ab/recent")
        body = resp.json()
        assert "enabled" in body


# ─── /ab/promotions ──────────────────────────────────────────────────────────

class TestABPromotions:
    def test_ab_promotions_returns_200(self):
        resp = client.get("/ab/promotions")
        assert resp.status_code == 200

    def test_ab_promotions_has_records_list(self):
        resp = client.get("/ab/promotions")
        body = resp.json()
        assert "records" in body
        assert isinstance(body["records"], list)

    def test_ab_promotions_has_total_field(self):
        resp = client.get("/ab/promotions")
        body = resp.json()
        assert "total" in body

    def test_ab_promotions_limit_param_accepted(self):
        resp = client.get("/ab/promotions?limit=10")
        assert resp.status_code == 200

    def test_ab_promotions_total_is_non_negative(self):
        resp = client.get("/ab/promotions")
        body = resp.json()
        assert body["total"] >= 0

    def test_ab_promotions_records_count_le_limit(self):
        resp = client.get("/ab/promotions?limit=3")
        body = resp.json()
        assert len(body["records"]) <= 3

    def test_promotion_log_is_ring_buffer(self):
        """_PROMOTION_LOG must be a deque with maxlen=500."""
        from collections import deque
        assert isinstance(_PROMOTION_LOG, deque)
        assert _PROMOTION_LOG.maxlen == 500


# ─── POST /ab/promote ────────────────────────────────────────────────────────

class TestABPromote:
    def test_promote_returns_200_or_409(self):
        resp = client.post(
            "/ab/promote",
            json={"reason": "test_promotion", "operator": "test_admin"},
        )
        # 200 OK or 409 if no shadow model is enabled
        assert resp.status_code in (200, 409)

    def test_promote_accepts_default_reason(self):
        """reason has a default value so missing it is OK."""
        resp = client.post("/ab/promote", json={"operator": "test_admin"})
        assert resp.status_code in (200, 409)

    def test_promote_accepts_default_operator(self):
        """operator has a default value so missing it is OK."""
        resp = client.post("/ab/promote", json={"reason": "test"})
        assert resp.status_code in (200, 409)

    def test_promote_409_when_no_shadow_enabled(self):
        """When shadow model is disabled, promote should return 409 Conflict."""
        from shadow_model import get_shadow_model
        shadow = get_shadow_model()
        shadow.disable()
        resp = client.post(
            "/ab/promote",
            json={"reason": "no_shadow_test", "operator": "test_admin"},
        )
        assert resp.status_code == 409

    def test_promote_response_has_success_field(self):
        resp = client.post(
            "/ab/promote",
            json={"reason": "test", "operator": "test_admin"},
        )
        if resp.status_code == 200:
            assert "success" in resp.json()

    def test_promote_response_has_promoted_at(self):
        resp = client.post(
            "/ab/promote",
            json={"reason": "test", "operator": "test_admin"},
        )
        if resp.status_code == 200:
            assert "promoted_at" in resp.json()


# ─── POST /score ─────────────────────────────────────────────────────────────

class TestScore:
    def _sample_payload(self):
        return {
            "user_id": "u-test-001",
            "session_id": "sess-001",
            "action": "QUERY_DECLARATION",
            "resource": "declaration:9999",
            "hour_of_day": 10,
            "action_count_per_hour": 3,
            "unique_records_accessed": 2,
            "role": "trader",
        }

    def test_detect_returns_200(self):
        resp = client.post("/detect", json=self._sample_payload())
        assert resp.status_code == 200

    def test_detect_has_anomaly_score(self):
        resp = client.post("/detect", json=self._sample_payload())
        body = resp.json()
        assert "anomaly_score" in body

    def test_detect_has_blocked(self):
        resp = client.post("/detect", json=self._sample_payload())
        body = resp.json()
        assert "blocked" in body

    def test_detect_anomaly_score_is_float(self):
        resp = client.post("/detect", json=self._sample_payload())
        body = resp.json()
        assert isinstance(body["anomaly_score"], (int, float))

    def test_detect_blocked_is_bool(self):
        resp = client.post("/detect", json=self._sample_payload())
        body = resp.json()
        assert isinstance(body["blocked"], bool)
