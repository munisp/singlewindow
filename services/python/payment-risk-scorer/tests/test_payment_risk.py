"""
Payment Risk Scorer — pytest suite
Tests the PaymentRiskScorer ensemble scoring engine, VelocityTracker,
FSP channel risk weights, and FastAPI endpoint contracts.
"""
import sys
import os
import time
import importlib

import pytest
from fastapi.testclient import TestClient

# ── Import the service module ──────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main as svc

client = TestClient(svc.app)


# ─── Fixtures ─────────────────────────────────────────────────────────────────

def _base_req(**overrides):
    """Return a minimal valid PaymentScoreRequest dict."""
    base = {
        "trader_id": "trader-test-001",
        "declaration_id": "DECL-12345",
        "amount": 5_000.0,
        "currency": "GHS",
        "fsp_id": "GCB",
        "fsp_type": "BANK",
        "payer_account": "1234567890",
        "declaration_value": 50_000.0,
        "trader_compliance_score": 0.8,
        "is_first_payment": False,
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def reset_velocity_tracker():
    """Reset the global velocity tracker between tests."""
    svc.velocity_tracker._data.clear()
    yield
    svc.velocity_tracker._data.clear()


# ─── VelocityTracker ──────────────────────────────────────────────────────────

class TestVelocityTracker:
    def test_empty_trader_returns_zero_stats(self):
        stats = svc.velocity_tracker.get_stats("new-trader")
        assert stats["count_24h"] == 0
        assert stats["amount_24h"] == 0.0

    def test_single_payment_recorded(self):
        svc.velocity_tracker.record("trader-A", 1000.0)
        stats = svc.velocity_tracker.get_stats("trader-A")
        assert stats["count_24h"] == 1
        assert stats["amount_24h"] == pytest.approx(1000.0)

    def test_multiple_payments_accumulate(self):
        for _ in range(5):
            svc.velocity_tracker.record("trader-B", 2000.0)
        stats = svc.velocity_tracker.get_stats("trader-B")
        assert stats["count_24h"] == 5
        assert stats["amount_24h"] == pytest.approx(10_000.0)

    def test_old_entries_pruned(self):
        """Entries older than 24h should be excluded from stats."""
        tracker = svc.VelocityTracker()
        # Manually inject a stale entry (older than 24h)
        stale_ts = time.time() - 86_401
        tracker._data["trader-C"] = [{"ts": stale_ts, "amount": 9999.0}]
        stats = tracker.get_stats("trader-C")
        assert stats["count_24h"] == 0
        assert stats["amount_24h"] == 0.0

    def test_traders_are_isolated(self):
        svc.velocity_tracker.record("trader-X", 500.0)
        svc.velocity_tracker.record("trader-Y", 1500.0)
        assert svc.velocity_tracker.get_stats("trader-X")["count_24h"] == 1
        assert svc.velocity_tracker.get_stats("trader-Y")["count_24h"] == 1
        assert svc.velocity_tracker.get_stats("trader-Z")["count_24h"] == 0


# ─── PaymentRiskScorer — amount risk ──────────────────────────────────────────

class TestAmountRisk:
    def test_low_amount_produces_low_score(self):
        req = svc.PaymentScoreRequest(**_base_req(amount=100.0))
        resp = svc.scorer.score(req)
        assert resp.risk_score < 0.5
        assert "HIGH_AMOUNT" not in " ".join(resp.flags)

    def test_very_high_amount_triggers_flag(self):
        # amount > AMOUNT_THRESHOLDS["critical"] (5_000_000) → _score_amount returns 0.95 > 0.7
        req = svc.PaymentScoreRequest(**_base_req(amount=6_000_000.0))
        resp = svc.scorer.score(req)
        assert any("HIGH_AMOUNT" in f for f in resp.flags)

    def test_risk_score_bounded_0_to_1(self):
        for amount in [1.0, 1_000.0, 100_000.0, 10_000_000.0]:
            req = svc.PaymentScoreRequest(**_base_req(amount=amount))
            resp = svc.scorer.score(req)
            assert 0.0 <= resp.risk_score <= 1.0, f"Out of bounds for amount={amount}"


# ─── PaymentRiskScorer — velocity risk ────────────────────────────────────────

class TestVelocityRisk:
    def test_high_payment_count_triggers_velocity_flag(self):
        # Pre-load velocity tracker with many payments
        for _ in range(svc.VELOCITY_LIMIT_COUNT):
            svc.velocity_tracker.record("trader-vel", 100.0)
        req = svc.PaymentScoreRequest(**_base_req(trader_id="trader-vel"))
        resp = svc.scorer.score(req)
        assert any("VELOCITY_COUNT" in f for f in resp.flags)

    def test_high_amount_velocity_triggers_flag(self):
        svc.velocity_tracker.record("trader-amt", svc.VELOCITY_LIMIT_AMOUNT_GHS)
        req = svc.PaymentScoreRequest(**_base_req(trader_id="trader-amt"))
        resp = svc.scorer.score(req)
        assert any("VELOCITY_AMOUNT" in f for f in resp.flags)

    def test_clean_trader_no_velocity_flags(self):
        req = svc.PaymentScoreRequest(**_base_req(trader_id="clean-trader"))
        resp = svc.scorer.score(req)
        velocity_flags = [f for f in resp.flags if "VELOCITY" in f]
        assert len(velocity_flags) == 0


# ─── PaymentRiskScorer — duty-to-value ratio ──────────────────────────────────

class TestDutyValueRatio:
    def test_high_duty_ratio_triggers_flag(self):
        # duty > 50% of declared value
        req = svc.PaymentScoreRequest(**_base_req(amount=30_000.0, declaration_value=50_000.0))
        resp = svc.scorer.score(req)
        assert any("HIGH_DUTY_RATIO" in f for f in resp.flags)

    def test_suspiciously_low_duty_ratio_triggers_flag(self):
        # duty < 1% of declared value (potential under-declaration)
        req = svc.PaymentScoreRequest(**_base_req(amount=10.0, declaration_value=100_000.0))
        resp = svc.scorer.score(req)
        assert any("LOW_DUTY_RATIO" in f for f in resp.flags)

    def test_normal_duty_ratio_no_flag(self):
        # 10% duty — normal
        req = svc.PaymentScoreRequest(**_base_req(amount=5_000.0, declaration_value=50_000.0))
        resp = svc.scorer.score(req)
        ratio_flags = [f for f in resp.flags if "DUTY_RATIO" in f]
        assert len(ratio_flags) == 0

    def test_no_declaration_value_skips_ratio_check(self):
        req = svc.PaymentScoreRequest(**_base_req(declaration_value=None))
        resp = svc.scorer.score(req)
        ratio_flags = [f for f in resp.flags if "DUTY_RATIO" in f]
        assert len(ratio_flags) == 0


# ─── PaymentRiskScorer — risk tiers ───────────────────────────────────────────

class TestRiskTiers:
    def test_low_risk_payment_approved(self):
        req = svc.PaymentScoreRequest(**_base_req(
            amount=1_000.0,
            declaration_value=100_000.0,
            trader_compliance_score=0.95,
            fsp_id="GCB",
        ))
        resp = svc.scorer.score(req)
        assert resp.risk_tier in ("LOW", "MEDIUM")

    def test_response_has_required_fields(self):
        req = svc.PaymentScoreRequest(**_base_req())
        resp = svc.scorer.score(req)
        assert resp.trader_id == "trader-test-001"
        assert resp.declaration_id == "DECL-12345"
        assert resp.risk_tier in ("LOW", "MEDIUM", "HIGH", "CRITICAL")
        assert resp.recommended_action in ("APPROVE", "REVIEW", "HOLD", "REJECT")
        assert resp.model_version
        assert resp.scored_at

    def test_first_payment_flag_increases_risk(self):
        req_first = svc.PaymentScoreRequest(**_base_req(is_first_payment=True))
        req_repeat = svc.PaymentScoreRequest(**_base_req(is_first_payment=False))
        resp_first = svc.scorer.score(req_first)
        resp_repeat = svc.scorer.score(req_repeat)
        # First payment should have same or higher risk
        assert resp_first.risk_score >= resp_repeat.risk_score


# ─── API endpoint contracts ────────────────────────────────────────────────────

class TestAPIEndpoints:
    def test_health_returns_ok(self):
        r = client.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"
        assert "service" in data

    def test_score_endpoint_returns_200(self):
        r = client.post("/api/payment-risk/score", json=_base_req())
        assert r.status_code == 200
        data = r.json()
        assert "risk_score" in data
        assert "risk_tier" in data
        assert "flags" in data

    def test_score_endpoint_validates_negative_amount(self):
        r = client.post("/api/payment-risk/score", json=_base_req(amount=-100.0))
        assert r.status_code == 422

    def test_score_endpoint_validates_missing_trader_id(self):
        payload = _base_req()
        del payload["trader_id"]
        r = client.post("/api/payment-risk/score", json=payload)
        assert r.status_code == 422

    def test_batch_score_endpoint(self):
        payload = {"payments": [_base_req(), _base_req(trader_id="trader-002", amount=2000.0)]}
        r = client.post("/api/payment-risk/batch-score", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert "results" in data
        assert len(data["results"]) == 2

    def test_stats_endpoint(self):
        r = client.get("/api/payment-risk/stats")
        assert r.status_code == 200
        data = r.json()
        assert "total_scored" in data
