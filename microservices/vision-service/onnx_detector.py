"""Fail-closed ONNX Runtime object detector for cargo inspection.

Replaces the former Ultralytics YOLOv8 backend (AGPL — removed for license
discipline) and its silent ``_mock_detections`` fallback. This module follows
the licensed approach of ``blueeconomy-cv-service/src/cvservice/detectors``:

- YOLOX-s (Apache-2.0) exported to ONNX, executed via ONNX Runtime (MIT).
- Weights are verified at load (presence, non-empty, optional SHA-256
  sidecar); any failure raises :class:`DetectorError` with a
  ``WEIGHTS_REQUIRED``-style reason — there is no mock path, ever.

Fail-closed contract:
- :func:`verify_weights` raises ``DetectorError("WEIGHTS_REQUIRED: ...")``
  when the model file is absent/empty or the sidecar digest mismatches.
- :class:`OnnxCargoDetector` raises ``DetectorError`` on model-load or
  inference failure. Callers must propagate — never substitute fabricated
  detections.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass

import numpy as np


class DetectorError(RuntimeError):
    """Raised on model-load or inference failure. Fail-closed: callers must
    surface the failure (boot abort / 503), never fabricate detections."""


@dataclass(frozen=True)
class RawDetection:
    """A single detection in absolute image coordinates."""

    x1: float
    y1: float
    x2: float
    y2: float
    score: float
    class_id: int


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_weights(path: str) -> str:
    """Verify model weights; fail closed. Returns an opaque model version
    ``<filename>@<sha256[:12]>`` recorded in health/readiness reports."""
    if not os.path.isfile(path):
        raise DetectorError(f"WEIGHTS_REQUIRED: model file missing: {path}")
    if os.path.getsize(path) == 0:
        raise DetectorError(f"WEIGHTS_REQUIRED: model file empty: {path}")
    digest = _sha256_file(path)
    sidecar = path + ".sha256"
    if os.path.isfile(sidecar):
        expected = open(sidecar, "r", encoding="utf-8").read().split()[0].strip()
        if expected.lower() != digest:
            raise DetectorError(
                f"weights SHA256 mismatch for {path}: expected {expected}, got {digest}"
            )
    return f"{os.path.basename(path)}@{digest[:12]}"


class OnnxCargoDetector:
    """YOLOX-s ONNX detector (CPU) for cargo/container inspection."""

    def __init__(
        self,
        model_path: str,
        class_names: dict[int, str],
        *,
        input_size: int = 640,
        conf_threshold: float = 0.35,
        nms_threshold: float = 0.45,
        intra_threads: int = 2,
    ):
        self._version = verify_weights(model_path)  # fail closed
        try:
            import onnxruntime as ort
        except ImportError as exc:
            raise DetectorError(
                f"WEIGHTS_REQUIRED: onnxruntime not installed ({exc}); "
                "install onnxruntime and provide a YOLOX-s ONNX export"
            ) from exc
        try:
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = intra_threads
            opts.log_severity_level = 3
            self._session = ort.InferenceSession(
                model_path, sess_options=opts, providers=["CPUExecutionProvider"]
            )
        except Exception as exc:
            raise DetectorError(f"model load failed for {model_path}: {exc}") from exc
        self._input_name = self._session.get_inputs()[0].name
        self._class_names = class_names
        self._input_size = input_size
        self._conf_threshold = conf_threshold
        self._nms_threshold = nms_threshold

    @property
    def model_version(self) -> str:
        return self._version

    def detect(self, img_rgb: np.ndarray) -> list[RawDetection]:
        """Run detection on an RGB uint8 image. Raises DetectorError on any
        failure — never returns fabricated results."""
        import cv2

        try:
            blob, ratio = self._preprocess(img_rgb)
            outputs = self._session.run(None, {self._input_name: blob})
        except DetectorError:
            raise
        except Exception as exc:
            raise DetectorError(f"inference failed: {exc}") from exc
        return self._postprocess_yolox(outputs[0], ratio)

    # -- preprocessing ------------------------------------------------------

    def _preprocess(self, frame: np.ndarray):
        import cv2

        size = self._input_size
        h, w = frame.shape[:2]
        ratio = min(size / h, size / w)
        new_w, new_h = max(1, int(round(w * ratio))), max(1, int(round(h * ratio)))
        resized = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        padded = np.full((size, size, 3), 114, dtype=np.uint8)
        padded[:new_h, :new_w] = resized
        blob = padded.transpose(2, 0, 1)[None].astype(np.float32)
        return blob, ratio

    # -- postprocessing -----------------------------------------------------

    def _postprocess_yolox(self, output: np.ndarray, ratio: float) -> list[RawDetection]:
        import cv2

        preds = output[0]
        if preds.ndim != 2 or preds.shape[1] < 6:
            raise DetectorError(f"unexpected yolox output shape {output.shape}")
        size = self._input_size
        grids, strides = _yolox_grids(size)
        n = preds.shape[0]
        if n != grids.shape[0]:
            raise DetectorError(
                f"anchor count mismatch: output {n} vs grid {grids.shape[0]}"
            )
        boxes = np.empty((n, 4), dtype=np.float64)
        boxes[:, 0] = (preds[:, 0] + grids[:, 0]) * strides  # cx
        boxes[:, 1] = (preds[:, 1] + grids[:, 1]) * strides  # cy
        boxes[:, 2] = np.exp(preds[:, 2]) * strides  # w
        boxes[:, 3] = np.exp(preds[:, 3]) * strides  # h
        obj = 1.0 / (1.0 + np.exp(-preds[:, 4]))
        cls_logits = preds[:, 5:]
        cls_ids = np.argmax(cls_logits, axis=1)
        cls_scores = 1.0 / (1.0 + np.exp(-cls_logits[np.arange(n), cls_ids]))
        scores = obj * cls_scores
        keep = scores >= self._conf_threshold
        if not np.any(keep):
            return []
        boxes, scores, cls_ids = boxes[keep], scores[keep], cls_ids[keep]
        x1 = (boxes[:, 0] - boxes[:, 2] / 2) / ratio
        y1 = (boxes[:, 1] - boxes[:, 3] / 2) / ratio
        x2 = (boxes[:, 0] + boxes[:, 2] / 2) / ratio
        y2 = (boxes[:, 1] + boxes[:, 3] / 2) / ratio
        indices = cv2.dnn.NMSBoxes(
            np.stack([x1, y1, x2 - x1, y2 - y1], axis=1).astype(np.float32).tolist(),
            scores.astype(np.float32).tolist(),
            self._conf_threshold,
            self._nms_threshold,
        )
        out: list[RawDetection] = []
        for i in np.atleast_1d(indices).flatten():
            out.append(
                RawDetection(
                    x1=float(x1[i]),
                    y1=float(y1[i]),
                    x2=float(x2[i]),
                    y2=float(y2[i]),
                    score=float(scores[i]),
                    class_id=int(cls_ids[i]),
                )
            )
        return out


def _yolox_grids(size: int) -> tuple[np.ndarray, np.ndarray]:
    """Grid/strides for YOLOX FPN levels at strides 8/16/32."""
    grids, strides = [], []
    for stride in (8, 16, 32):
        n = size // stride
        yv, xv = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
        grids.append(np.stack([xv.ravel(), yv.ravel()], axis=1))
        strides.append(np.full(n * n, stride, dtype=np.float64))
    return np.concatenate(grids).astype(np.float64), np.concatenate(strides)
