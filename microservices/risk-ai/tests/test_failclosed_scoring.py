"""Fail-closed scoring tests for risk-ai.

Modes:
- Default (RISK_AI_ALLOW_RULE_FALLBACK unset): boot raises
  SCORING_UNAVAILABLE when the model file is absent; /score returns 503
  SCORING_UNAVAILABLE if the model is missing at runtime.
- Degraded (RISK_AI_ALLOW_RULE_FALLBACK=true): explicitly-configured,
  separately-audited rule-based fallback — boot succeeds in degraded mode,
  /score returns rule-based results, and every degraded score increments the
  audit metric.
"""

from __future__ import annotations

import asyncio
import importlib
import sys
from pathlib import Path

import pytest

SERVICE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVICE_DIR))

import main  # noqa: E402


def _reload(monkeypatch, *, model_dir: str, allow_fallback: bool | None):
    monkeypatch.setenv("MODEL_DIR", model_dir)
    if allow_fallback is None:
        monkeypatch.delenv("RISK_AI_ALLOW_RULE_FALLBACK", raising=False)
    else:
        monkeypatch.setenv("RISK_AI_ALLOW_RULE_FALLBACK", str(allow_fallback).lower())
    # Module re-registration: reset the default prometheus registry so the
    # reloaded module can redeclare its metrics.
    from prometheus_client import REGISTRY

    for collector in list(REGISTRY._names_to_collectors.values()):
        try:
            REGISTRY.unregister(collector)
        except Exception:
            pass
    return importlib.reload(main)


def _req():
    return main.RiskAIRequest(declaration_id="decl-1", hs_code="9301", origin_country="KP")


# ── fail-closed default mode ─────────────────────────────────────────────────


def test_boot_fails_closed_when_model_absent(tmp_path, monkeypatch):
    m = _reload(monkeypatch, model_dir=str(tmp_path), allow_fallback=None)
    with pytest.raises(main.ScoringUnavailableError, match="SCORING_UNAVAILABLE"):
        m.load_model()


def test_boot_fails_closed_when_model_corrupt(tmp_path, monkeypatch):
    (tmp_path / "xgb_risk.json").write_bytes(b"not a model")
    m = _reload(monkeypatch, model_dir=str(tmp_path), allow_fallback=None)
    with pytest.raises(main.ScoringUnavailableError, match="SCORING_UNAVAILABLE"):
        m.load_model()


def test_score_returns_503_fail_closed(tmp_path, monkeypatch):
    m = _reload(monkeypatch, model_dir=str(tmp_path), allow_fallback=None)
    m._xgb_model = None
    m._degraded_mode = False
    refused_before = m.SCORING_REFUSED_TOTAL._value.get()
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        asyncio.run(m.score_declaration(_req()))
    assert exc.value.status_code == 503
    assert "SCORING_UNAVAILABLE" in exc.value.detail
    assert m.SCORING_REFUSED_TOTAL._value.get() == refused_before + 1


def test_no_silent_fallback_string_remains():
    src = (SERVICE_DIR / "main.py").read_text()
    assert "Using rule-based scoring." not in src  # old silent-fallback log lines
    assert src.count("rule_based_degraded") >= 3  # honest mode labelling


# ── explicitly-configured degraded mode ──────────────────────────────────────


def test_degraded_boot_succeeds_and_audits(tmp_path, monkeypatch, caplog):
    m = _reload(monkeypatch, model_dir=str(tmp_path), allow_fallback=True)
    with caplog.at_level("WARNING"):
        m.load_model()
    assert m._xgb_model is None
    assert m._degraded_mode is True
    assert any("AUDIT degraded-mode" in r.message for r in caplog.records)


def test_degraded_score_uses_rules_and_metric(tmp_path, monkeypatch):
    m = _reload(monkeypatch, model_dir=str(tmp_path), allow_fallback=True)
    m.load_model()
    degraded_before = m.DEGRADED_SCORING_TOTAL._value.get()
    resp = asyncio.run(m.score_declaration(_req()))
    assert resp.model_version == "rule_based_degraded"
    assert resp.lane in ("GREEN", "YELLOW", "RED")
    assert 0.0 <= resp.risk_score <= 1.0
    assert m.DEGRADED_SCORING_TOTAL._value.get() == degraded_before + 1


def test_readyz_reports_modes_honestly(tmp_path, monkeypatch):
    m = _reload(monkeypatch, model_dir=str(tmp_path), allow_fallback=True)
    m.load_model()
    payload = asyncio.run(m.readiness())
    assert payload["degraded_mode"] is True
    assert payload["model"] == "rule_based_degraded"
    assert payload["status"] == "ready"

    m2 = _reload(monkeypatch, model_dir=str(tmp_path), allow_fallback=None)
    m2._xgb_model = None
    m2._degraded_mode = False
    payload2 = asyncio.run(m2.readiness())
    assert payload2["status"] == "unavailable"
    assert payload2["model"] == "unavailable"
