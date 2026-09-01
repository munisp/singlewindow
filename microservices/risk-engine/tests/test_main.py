"""risk-engine remediation tests (phase 11, findings: fabricated model
identity + fail-open DB defaults).

Covers:
  - modelVersion honestly identifies the heuristic rule set
    ("rules-v1-<sha256[:12]>"), never a fabricated XGBoost version, and the
    hash tracks the actual rule tables.
  - Trader-risk database failure fails CLOSED: HTTP 503 RISK_UNAVAILABLE,
    never the old 0.50 stand-in.
  - Unknown trader (no profile row) keeps an explicit, labelled policy
    default — distinct from a masked database error.
  - The heuristic math itself (weights, AEO multiplier, lanes).

No real database or network: get_db is monkeypatched with fakes.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: E402
from main import (  # noqa: E402
    MODEL_VERSION,
    RiskScoreRequest,
    RiskUnavailableError,
    assign_lane,
    compute_risk_score,
    get_trader_risk,
    score_declaration,
)


def _request() -> RiskScoreRequest:
    return RiskScoreRequest(
        declarationId=1, traderId=42, hsCode="9301",
        declaredValue=1000.0, originCountry="IR",
    )


class _Cursor:
    def __init__(self, row):
        self._row = row

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, *a, **k):
        pass

    def fetchone(self):
        return self._row


class _Conn:
    def __init__(self, row):
        self._row = row
        self.closed = False

    def cursor(self):
        return _Cursor(self._row)

    def commit(self):
        pass


TRADER_ROW = {
    "compliance_score": 80.0,
    "total_declarations": 120,
    "rejected_declarations": 2,
    "kyc_status": "verified",
    "aeo_status": "certified",
}


def test_model_version_honestly_identifies_heuristic():
    assert MODEL_VERSION.startswith("rules-v1-")
    suffix = MODEL_VERSION.removeprefix("rules-v1-")
    assert len(suffix) == 12
    int(suffix, 16)  # hex digest fragment
    assert "xgb" not in MODEL_VERSION


def test_model_version_hash_tracks_rule_tables():
    expected = "rules-v1-" + hashlib.sha256(
        json.dumps(
            {
                "hs_risk_profiles": main.HS_RISK_PROFILES,
                "country_risk": main.COUNTRY_RISK,
                "rule_weights": main.RULE_WEIGHTS,
                "reference_prices": main.REFERENCE_PRICES,
                "reference_price_default": main.REFERENCE_PRICE_DEFAULT,
                "document_risk": {
                    "kyc_verified": main.DOCUMENT_RISK_KYC_VERIFIED,
                    "kyc_unverified": main.DOCUMENT_RISK_KYC_UNVERIFIED,
                },
                "aeo_risk_multiplier": main.AEO_RISK_MULTIPLIER,
                "unknown_trader_risk": main.UNKNOWN_TRADER_RISK,
            },
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()[:12]
    assert MODEL_VERSION == expected


def test_db_failure_fails_closed(monkeypatch):
    def boom():
        raise RuntimeError("connection refused")

    monkeypatch.setattr(main, "get_db", boom)
    with pytest.raises(RiskUnavailableError):
        get_trader_risk(42)


def test_score_endpoint_db_down_returns_503_risk_unavailable(monkeypatch):
    def boom():
        raise RuntimeError("connection refused")

    monkeypatch.setattr(main, "get_db", boom)
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(score_declaration(_request()))
    assert exc_info.value.status_code == 503
    assert "RISK_UNAVAILABLE" in str(exc_info.value.detail)


def test_unknown_trader_labelled_policy_default_not_masked_error(monkeypatch):
    monkeypatch.setattr(main, "get_db", lambda: _Conn(None))
    risk, info = get_trader_risk(42)
    assert risk == main.UNKNOWN_TRADER_RISK
    assert info["traderKnown"] is False
    assert info["traderRiskSource"] == "policy-default-unknown-trader"


def test_known_trader_scored_from_profile(monkeypatch):
    monkeypatch.setattr(main, "get_db", lambda: _Conn(TRADER_ROW))
    risk, info = get_trader_risk(42)
    assert risk == pytest.approx(0.2)  # 1 - 80/100
    assert info["traderKnown"] is True
    assert info["aeo"] is True


def test_score_happy_path_reports_rules_version(monkeypatch):
    monkeypatch.setattr(main, "get_db", lambda: _Conn(TRADER_ROW))
    resp = asyncio.run(score_declaration(_request()))
    assert resp.modelVersion == MODEL_VERSION
    assert resp.modelVersion.startswith("rules-v1-")
    assert 0 <= resp.score <= 100
    assert resp.lane in ("green", "yellow", "red")


def test_heuristic_math_weights_and_aeo():
    # No AEO, KYC verified:
    # 0.25*0.5 + 0.20*0.5 + 0.30*0.5 + 0.20*0.5 + 0.05*0.1 = 0.48 -> 48.0
    score = compute_risk_score(0.5, 0.5, 0.5, 0.5, aeo_certified=False, kyc_verified=True)
    assert score == pytest.approx(48.0)
    # AEO multiplier applied:
    score_aeo = compute_risk_score(0.5, 0.5, 0.5, 0.5, aeo_certified=True, kyc_verified=True)
    assert score_aeo == pytest.approx(48.0 * main.AEO_RISK_MULTIPLIER, abs=0.01)


def test_assign_lane_thresholds():
    assert assign_lane(0) == "green"
    assert assign_lane(29.99) == "green"
    assert assign_lane(30) == "yellow"
    assert assign_lane(69.99) == "yellow"
    assert assign_lane(70) == "red"
