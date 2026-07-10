"""
TradeGateway NGSWTP — Anomaly Detection Service Tests
Sprint v74 — covers all detection rules, risk scoring, batch endpoint, and health check.
"""

import math
import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from main import (
    app,
    UserActionEvent,
    _haversine_km,
    compute_risk_score,
    determine_action,
    rule_off_hours_access,
    rule_bulk_export,
    rule_geo_anomaly,
    rule_rapid_actions,
    rule_large_payment,
    rule_failed_authz,
    AnomalyAlert,
)

client = TestClient(app)

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _event(**kwargs) -> dict:
    """Build a minimal UserActionEvent dict."""
    defaults = {
        "user_id": "u-test",
        "session_id": "s-test",
        "action": "view",
        "endpoint": "/api/declarations",
        "ip_address": "1.2.3.4",
        "timestamp": time.time(),
    }
    defaults.update(kwargs)
    return defaults


# ─── Health check ─────────────────────────────────────────────────────────────

def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "anomaly-detection-svc"


# ─── Haversine helper ─────────────────────────────────────────────────────────

def test_haversine_same_point():
    assert _haversine_km(0.0, 0.0, 0.0, 0.0) == pytest.approx(0.0, abs=1e-6)


def test_haversine_known_distance():
    # London (51.5, -0.12) to Paris (48.85, 2.35) ≈ 341 km
    dist = _haversine_km(51.5, -0.12, 48.85, 2.35)
    assert 330 < dist < 360


# ─── Rule 1: Off-hours access ─────────────────────────────────────────────────

def test_rule_off_hours_triggers_at_midnight():
    from datetime import datetime, timezone
    dt = datetime(2024, 1, 1, 1, 0, 0, tzinfo=timezone.utc)
    event = UserActionEvent(**_event(timestamp=dt.timestamp()))
    alert = rule_off_hours_access(event)
    assert alert is not None
    assert alert.rule_id == "R001"
    assert alert.severity == "MEDIUM"


def test_rule_off_hours_no_alert_during_business_hours():
    from datetime import datetime, timezone
    dt = datetime(2024, 1, 1, 10, 0, 0, tzinfo=timezone.utc)
    event = UserActionEvent(**_event(timestamp=dt.timestamp()))
    alert = rule_off_hours_access(event)
    assert alert is None


# ─── Rule 2: Bulk export ──────────────────────────────────────────────────────

def test_rule_bulk_export_triggers():
    event = UserActionEvent(**_event(record_count=600))
    alert = rule_bulk_export(event)
    assert alert is not None
    assert alert.rule_id == "R002"
    assert alert.severity == "HIGH"


def test_rule_bulk_export_no_alert_below_threshold():
    event = UserActionEvent(**_event(record_count=100))
    alert = rule_bulk_export(event)
    assert alert is None


def test_rule_bulk_export_no_alert_when_none():
    event = UserActionEvent(**_event())
    alert = rule_bulk_export(event)
    assert alert is None


# ─── Rule 3: Geo anomaly ──────────────────────────────────────────────────────

def test_rule_geo_anomaly_no_alert_without_coords():
    event = UserActionEvent(**_event())
    with patch("main._redis_get", return_value=None):
        with patch("main._redis_set"):
            alert = rule_geo_anomaly(event)
    assert alert is None


def test_rule_geo_anomaly_triggers_impossible_travel():
    import json as _json
    prev_data = _json.dumps({
        "lat": 51.5, "lon": -0.12,
        "ts": time.time() - 1800,
        "ip": "1.2.3.4",
    })
    event = UserActionEvent(**_event(
        latitude=1.35, longitude=103.82,
        ip_address="5.6.7.8",
    ))
    with patch("main._redis_get", return_value=prev_data):
        with patch("main._redis_set"):
            alert = rule_geo_anomaly(event)
    assert alert is not None
    assert alert.rule_id == "R003"
    assert alert.severity == "CRITICAL"
    assert alert.recommended_action == "FORCE_LOGOUT"


def test_rule_geo_anomaly_no_alert_slow_travel():
    import json as _json
    prev_data = _json.dumps({
        "lat": 51.5, "lon": -0.12,
        "ts": time.time() - 7200,
        "ip": "1.2.3.4",
    })
    event = UserActionEvent(**_event(
        latitude=48.85, longitude=2.35,
        ip_address="5.6.7.8",
    ))
    with patch("main._redis_get", return_value=prev_data):
        with patch("main._redis_set"):
            alert = rule_geo_anomaly(event)
    assert alert is None


# ─── Rule 5: Rapid actions ────────────────────────────────────────────────────

def test_rule_rapid_actions_triggers():
    event = UserActionEvent(**_event())
    with patch("main._redis_incr", return_value=35):
        alert = rule_rapid_actions(event)
    assert alert is not None
    assert alert.rule_id == "R005"
    assert alert.severity == "HIGH"


def test_rule_rapid_actions_no_alert_below_threshold():
    event = UserActionEvent(**_event())
    with patch("main._redis_incr", return_value=10):
        alert = rule_rapid_actions(event)
    assert alert is None


# ─── Rule 9: Large payment ────────────────────────────────────────────────────

def test_rule_large_payment_triggers():
    event = UserActionEvent(**_event(payment_amount=50000.0))
    with patch("main._redis_get", return_value="1000.0"):
        with patch("main._redis_set"):
            alert = rule_large_payment(event)
    assert alert is not None
    assert alert.rule_id == "R009"
    assert alert.severity == "CRITICAL"


def test_rule_large_payment_no_alert_no_history():
    event = UserActionEvent(**_event(payment_amount=5000.0))
    with patch("main._redis_get", return_value=None):
        with patch("main._redis_set"):
            alert = rule_large_payment(event)
    assert alert is None


def test_rule_large_payment_no_alert_when_none():
    event = UserActionEvent(**_event())
    alert = rule_large_payment(event)
    assert alert is None


# ─── Rule 10: Failed authz ────────────────────────────────────────────────────

def test_rule_failed_authz_triggers():
    event = UserActionEvent(**_event(action="authz_denied"))
    with patch("main._redis_incr", return_value=8):
        alert = rule_failed_authz(event)
    assert alert is not None
    assert alert.rule_id == "R010"
    assert alert.recommended_action == "BLOCKED"


def test_rule_failed_authz_no_alert_below_threshold():
    event = UserActionEvent(**_event(action="authz_denied"))
    with patch("main._redis_incr", return_value=3):
        alert = rule_failed_authz(event)
    assert alert is None


def test_rule_failed_authz_no_alert_wrong_action():
    event = UserActionEvent(**_event(action="view"))
    alert = rule_failed_authz(event)
    assert alert is None


# ─── Risk scoring ─────────────────────────────────────────────────────────────

def _make_test_alert(severity: str, recommended_action: str = "FLAGGED") -> AnomalyAlert:
    return AnomalyAlert(
        alert_id="test-id",
        user_id="u1",
        session_id="s1",
        rule_id="R000",
        rule_name="Test Rule",
        severity=severity,
        description="test",
        evidence={},
        timestamp=time.time(),
        recommended_action=recommended_action,
    )


def test_compute_risk_score_empty():
    assert compute_risk_score([]) == 0.0


def test_compute_risk_score_single_medium():
    alerts = [_make_test_alert("MEDIUM")]
    score = compute_risk_score(alerts)
    assert score == pytest.approx(0.25, abs=1e-6)


def test_compute_risk_score_capped_at_one():
    alerts = [_make_test_alert("CRITICAL")] * 5
    score = compute_risk_score(alerts)
    assert score == pytest.approx(1.0, abs=1e-6)


def test_determine_action_blocked():
    alerts = [_make_test_alert("HIGH", "BLOCKED")]
    assert determine_action(0.5, alerts) == "BLOCKED"


def test_determine_action_force_logout():
    alerts = [_make_test_alert("CRITICAL", "FORCE_LOGOUT")]
    assert determine_action(0.9, alerts) == "FORCE_LOGOUT"


def test_determine_action_flagged():
    alerts = [_make_test_alert("HIGH", "FLAGGED")]
    assert determine_action(0.6, alerts) == "FLAGGED"


def test_determine_action_none():
    assert determine_action(0.1, []) == "NONE"


# ─── POST /analyse endpoint ───────────────────────────────────────────────────

def test_analyse_clean_event_no_alerts():
    from datetime import datetime, timezone
    dt = datetime(2024, 6, 15, 10, 0, 0, tzinfo=timezone.utc)
    payload = _event(timestamp=dt.timestamp())
    with patch("main._redis_incr", return_value=1):
        with patch("main._redis_get", return_value=None):
            with patch("main._redis_set"):
                resp = client.post("/analyse", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["user_id"] == "u-test"
    assert isinstance(data["alerts"], list)
    assert data["risk_score"] >= 0.0
    assert data["action_taken"] in ("NONE", "FLAGGED", "FORCE_LOGOUT", "BLOCKED")


def test_analyse_bulk_export_alert():
    from datetime import datetime, timezone
    dt = datetime(2024, 6, 15, 10, 0, 0, tzinfo=timezone.utc)
    payload = _event(timestamp=dt.timestamp(), record_count=1000)
    with patch("main._redis_incr", return_value=1):
        with patch("main._redis_get", return_value=None):
            with patch("main._redis_set"):
                resp = client.post("/analyse", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    rule_ids = [a["rule_id"] for a in data["alerts"]]
    assert "R002" in rule_ids


# ─── POST /analyse/batch endpoint ────────────────────────────────────────────

def test_analyse_batch_returns_list():
    from datetime import datetime, timezone
    dt = datetime(2024, 6, 15, 10, 0, 0, tzinfo=timezone.utc)
    events = [_event(timestamp=dt.timestamp(), user_id=f"u{i}") for i in range(3)]
    with patch("main._redis_incr", return_value=1):
        with patch("main._redis_get", return_value=None):
            with patch("main._redis_set"):
                resp = client.post("/analyse/batch", json=events)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3


def test_analyse_batch_rejects_oversized():
    events = [_event() for _ in range(1001)]
    resp = client.post("/analyse/batch", json=events)
    assert resp.status_code == 400


# ─── GET /risk/{user_id} endpoint ─────────────────────────────────────────────

def test_get_user_risk_empty_profile():
    with patch("main._redis_get", return_value=None):
        resp = client.get("/risk/u-test")
    assert resp.status_code == 200
    data = resp.json()
    assert data["user_id"] == "u-test"
    assert data["risk_profile"] == {}
