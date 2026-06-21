"""
model_store.py — Versioned model persistence for IsolationForest anomaly detector.

Stores models as:
  models/isolation_forest_v{N}.joblib   (versioned snapshots)
  models/isolation_forest_current.joblib (symlink to latest)

Metadata is kept in models/metadata.json:
  { "version": N, "trained_at": "ISO8601", "n_samples": int, "contamination": float,
    "precision": float, "recall": float, "f1": float }
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import joblib
from sklearn.ensemble import IsolationForest

logger = logging.getLogger(__name__)

MODELS_DIR = Path(os.getenv("MODELS_DIR", "/tmp/insider_threat_models"))
CURRENT_LINK = MODELS_DIR / "isolation_forest_current.joblib"
METADATA_FILE = MODELS_DIR / "metadata.json"

# ─── Initialisation ───────────────────────────────────────────────────────────

def _ensure_dir() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)


def _versioned_path(version: int) -> Path:
    return MODELS_DIR / f"isolation_forest_v{version}.joblib"


# ─── Save ─────────────────────────────────────────────────────────────────────

def save_model(
    model: IsolationForest,
    n_samples: int,
    metrics: dict,
    contamination: float,
) -> int:
    """
    Persist a trained model with a new version number.
    Returns the new version number.
    """
    _ensure_dir()

    # Determine next version
    meta = load_metadata()
    version = (meta.get("version", 0) if meta else 0) + 1

    versioned = _versioned_path(version)
    joblib.dump(model, versioned)
    logger.info("Saved model to %s", versioned)

    # Atomically update the current symlink
    tmp_link = MODELS_DIR / "_current_tmp.joblib"
    if tmp_link.exists():
        tmp_link.unlink()
    shutil.copy2(versioned, tmp_link)
    tmp_link.rename(CURRENT_LINK)
    logger.info("Updated current model link → v%d", version)

    # Write metadata
    metadata = {
        "version": version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_samples": n_samples,
        "contamination": contamination,
        **metrics,
    }
    METADATA_FILE.write_text(json.dumps(metadata, indent=2))
    logger.info("Metadata written: %s", metadata)

    # Prune old versions (keep last 5)
    _prune_old_versions(keep=5)

    return version


# ─── Load ─────────────────────────────────────────────────────────────────────

def load_current_model() -> Optional[IsolationForest]:
    """Load the current production model. Returns None if no model exists."""
    if not CURRENT_LINK.exists():
        logger.warning("No current model found at %s", CURRENT_LINK)
        return None
    try:
        model = joblib.load(CURRENT_LINK)
        logger.info("Loaded current model from %s", CURRENT_LINK)
        return model
    except Exception as exc:
        logger.error("Failed to load model: %s", exc)
        return None


def load_metadata() -> Optional[dict]:
    """Load model metadata. Returns None if no metadata exists."""
    if not METADATA_FILE.exists():
        return None
    try:
        return json.loads(METADATA_FILE.read_text())
    except Exception as exc:
        logger.error("Failed to load metadata: %s", exc)
        return None


# ─── Pruning ──────────────────────────────────────────────────────────────────

def _prune_old_versions(keep: int = 5) -> None:
    """Remove versioned model files older than the last `keep` versions."""
    meta = load_metadata()
    if not meta:
        return
    current_version = meta.get("version", 0)
    for v in range(1, max(1, current_version - keep)):
        path = _versioned_path(v)
        if path.exists():
            path.unlink()
            logger.info("Pruned old model version v%d", v)


# ─── List versions ────────────────────────────────────────────────────────────

def list_versions() -> list[dict]:
    """Return a list of available versioned model files."""
    _ensure_dir()
    versions = []
    for f in sorted(MODELS_DIR.glob("isolation_forest_v*.joblib")):
        v = int(f.stem.split("_v")[-1])
        stat = f.stat()
        versions.append({
            "version": v,
            "path": str(f),
            "size_bytes": stat.st_size,
            "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        })
    return versions
