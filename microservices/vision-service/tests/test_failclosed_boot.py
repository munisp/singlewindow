"""Fail-closed boot + no-mock-path tests for vision-service.

Proves:
1. Boot aborts (WEIGHTS_REQUIRED) when ONNX weights/deps are absent.
2. There is no mock detection path — detect() raises when uninitialised.
3. Health reports real readiness only (no "mock_mode").
4. With a working detector, boot succeeds and /health reports the real
   model version.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import numpy as np
import pytest

SERVICE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVICE_DIR))

from onnx_detector import DetectorError, OnnxCargoDetector, RawDetection, verify_weights  # noqa: E402
import main  # noqa: E402


# ── verify_weights: pure fail-closed unit tests ─────────────────────────────


def test_verify_weights_missing_file(tmp_path):
    with pytest.raises(DetectorError, match="WEIGHTS_REQUIRED"):
        verify_weights(str(tmp_path / "absent.onnx"))


def test_verify_weights_empty_file(tmp_path):
    p = tmp_path / "empty.onnx"
    p.write_bytes(b"")
    with pytest.raises(DetectorError, match="WEIGHTS_REQUIRED"):
        verify_weights(str(p))


def test_verify_weights_sha_mismatch(tmp_path):
    p = tmp_path / "model.onnx"
    p.write_bytes(b"weights")
    (tmp_path / "model.onnx.sha256").write_text("0" * 64 + "  model.onnx\n")
    with pytest.raises(DetectorError, match="SHA256 mismatch"):
        verify_weights(str(p))


def test_verify_weights_ok(tmp_path):
    p = tmp_path / "model.onnx"
    p.write_bytes(b"weights")
    version = verify_weights(str(p))
    assert version.startswith("model.onnx@")


# ── no mock path ─────────────────────────────────────────────────────────────


def test_detect_raises_when_not_initialised():
    det = main.YOLODetector()
    with pytest.raises(DetectorError, match="WEIGHTS_REQUIRED"):
        det.detect(np.zeros((64, 64, 3), dtype=np.uint8))


def test_no_mock_symbols_remain():
    src = (SERVICE_DIR / "main.py").read_text()
    assert "_mock_detections" not in src
    assert "mock_mode" not in src
    assert "ultralytics" not in src.lower()
    assert "CSQU-305182-3" not in src


# ── fail-closed boot ─────────────────────────────────────────────────────────


def test_boot_fails_closed_without_weights(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "ONNX_MODEL_PATH", str(tmp_path / "missing.onnx"))
    with pytest.raises(DetectorError, match="WEIGHTS_REQUIRED"):
        asyncio.run(main.yolo.load())


def test_lifespan_aborts_without_weights(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "ONNX_MODEL_PATH", str(tmp_path / "missing.onnx"))

    async def run():
        async with main.lifespan(main.app):
            pass  # pragma: no cover - must never reach

    with pytest.raises(DetectorError, match="WEIGHTS_REQUIRED"):
        asyncio.run(run())


# ── health reports real readiness only ───────────────────────────────────────


def test_health_reports_unavailable_when_detector_absent():
    main.yolo._detector = None
    payload = asyncio.run(main.health())
    assert payload["ready"] is False
    assert payload["status"] == "unavailable"
    assert payload["models"]["yolox_onnx"] == "unavailable"
    assert "mock_mode" not in str(payload)


class _FakeDetector:
    model_version = "cargo_yolox_s.onnx@deadbeefcafe"

    def detect(self, img):
        return [
            RawDetection(x1=1.0, y1=2.0, x2=10.0, y2=20.0, score=0.9, class_id=6)
        ]


def test_health_reports_real_model_version_when_ready(monkeypatch):
    monkeypatch.setattr(main.yolo, "_detector", _FakeDetector())
    payload = asyncio.run(main.health())
    assert payload["ready"] is True
    assert payload["status"] == "ok"
    assert payload["models"]["yolox_onnx"] == "cargo_yolox_s.onnx@deadbeefcafe"


def test_detect_returns_real_detections(monkeypatch):
    monkeypatch.setattr(main.yolo, "_detector", _FakeDetector())
    dets = main.yolo.detect(np.zeros((64, 64, 3), dtype=np.uint8))
    assert len(dets) == 1
    assert dets[0].class_name == "container_seal_intact"
    assert dets[0].confidence == pytest.approx(0.9)
    assert dets[0].area_px == pytest.approx(9.0 * 18.0)
