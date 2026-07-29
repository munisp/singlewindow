#!/usr/bin/env python3
"""
TradeGateway NGSWTP — AI Risk Scorer Model Training Script
=========================================================
Trains an XGBoost + IsolationForest ensemble model on historical
declaration data from PostgreSQL.

Usage:
    python3 train_model.py [--db-url <url>] [--output <path>] [--min-samples <n>]

The trained model is saved as a pickle bundle at the specified output path.
The main.py service loads this bundle on startup for inference.

Training data:
  - Declarations with known risk outcomes (cleared, flagged, seized)
  - Trader history (violation counts, AEO status, declaration volume)
  - HS code risk rates (computed from historical seizure data)
  - Origin country risk scores (from UNODC/WCO data)

Features (12 dimensions):
  1. declared_value_norm       — log-normalized declared value
  2. trader_risk               — historical trader risk score (0-1)
  3. trader_violations_norm    — normalized violation count
  4. aeo_status                — AEO certified (1) or not (0)
  5. hs_fraud_rate             — HS chapter historical fraud rate
  6. hs_controlled             — controlled goods indicator
  7. hs_duty_rate              — estimated duty rate
  8. origin_risk               — country of origin risk score
  9. dest_risk                 — destination country risk score
  10. weight_norm              — normalized weight
  11. packages_norm            — normalized package count
  12. value_per_kg_norm        — normalized value-per-kg ratio

Labels:
  0 = GREEN (low risk)
  1 = YELLOW (medium risk)
  2 = RED (high risk)
"""
from __future__ import annotations

import argparse
import logging
import os
import pickle
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import psycopg2
import psycopg2.extras
from sklearn.ensemble import IsolationForest
from sklearn.metrics import classification_report, f1_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
import xgboost as xgb

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("train_model")

# ─── Constants ────────────────────────────────────────────────────────────────
HIGH_RISK_HS_CHAPTERS = {"93", "28", "36", "30", "22", "24", "61", "62", "64", "85"}
HIGH_RISK_COUNTRIES = {"KP", "IR", "MM", "AF", "SY", "YE", "LY", "SD", "SO", "VE", "PK"}
MEDIUM_RISK_COUNTRIES = {"CN", "NG", "GH", "CI", "SN", "ML", "BF", "TZ", "KE", "ET"}

FEATURE_NAMES = [
    "declared_value_norm",
    "trader_risk",
    "trader_violations_norm",
    "aeo_status",
    "hs_fraud_rate",
    "hs_controlled",
    "hs_duty_rate",
    "origin_risk",
    "dest_risk",
    "weight_norm",
    "packages_norm",
    "value_per_kg_norm",
]


def fetch_training_data(db_url: str) -> pd.DataFrame:
    """Fetch historical declaration data from PostgreSQL."""
    logger.info("Connecting to PostgreSQL...")
    conn = psycopg2.connect(db_url)
    cursor = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    query = """
        SELECT
            d.id,
            d.declared_value,
            d.hs_code,
            d.country_of_origin,
            d.port_of_destination,
            d.weight_kg,
            d.num_packages,
            d.risk_score,
            d.risk_lane,
            d.status,
            COALESCE(sp.risk_score, 0.3) AS trader_risk,
            COALESCE(sp.violations_count, 0) AS trader_violations,
            CASE WHEN sp.aeo_status = 'ACTIVE' THEN 1 ELSE 0 END AS aeo_status,
            COALESCE(sp.declaration_count, 0) AS declaration_count
        FROM declarations d
        LEFT JOIN stakeholder_profiles sp ON sp.user_id = d.trader_id
        WHERE d.status IN ('cleared', 'flagged', 'seized', 'rejected')
          AND d.risk_lane IS NOT NULL
          AND d.created_at > NOW() - INTERVAL '2 years'
        LIMIT 100000
    """

    try:
        cursor.execute(query)
        rows = cursor.fetchall()
        logger.info(f"Fetched {len(rows)} training samples from PostgreSQL")
    except Exception as e:
        logger.warning(f"Failed to fetch training data: {e}. Using synthetic data.")
        rows = []
    finally:
        cursor.close()
        conn.close()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=[
        "id", "declared_value", "hs_code", "country_of_origin",
        "port_of_destination", "weight_kg", "num_packages",
        "risk_score", "risk_lane", "status",
        "trader_risk", "trader_violations", "aeo_status", "declaration_count"
    ])

    return df


def generate_synthetic_data(n_samples: int = 5000) -> pd.DataFrame:
    """Generate synthetic training data when real data is insufficient."""
    logger.info(f"Generating {n_samples} synthetic training samples...")
    rng = np.random.default_rng(42)

    hs_chapters = list(range(1, 100))
    countries = ["GH", "NG", "CN", "US", "GB", "DE", "FR", "KP", "IR", "SY",
                 "CI", "SN", "ML", "ZA", "KE", "TZ", "ET", "CM", "TG", "BJ"]

    data = {
        "declared_value": rng.lognormal(mean=8, sigma=2, size=n_samples),
        "hs_code": [f"{rng.integers(1, 99):02d}{rng.integers(0, 9999):04d}" for _ in range(n_samples)],
        "country_of_origin": rng.choice(countries, size=n_samples),
        "port_of_destination": rng.choice(["GHTEM", "NGAPP", "GHKSI", "NGLOS"], size=n_samples),
        "weight_kg": rng.lognormal(mean=5, sigma=2, size=n_samples),
        "num_packages": rng.integers(1, 500, size=n_samples),
        "trader_risk": rng.beta(2, 5, size=n_samples),
        "trader_violations": rng.poisson(1.5, size=n_samples),
        "aeo_status": rng.binomial(1, 0.15, size=n_samples),
        "declaration_count": rng.integers(1, 1000, size=n_samples),
    }

    df = pd.DataFrame(data)

    # Generate labels based on risk factors
    risk_scores = np.zeros(n_samples)
    for i, row in df.iterrows():
        chapter = str(row["hs_code"])[:2]
        origin = row["country_of_origin"]
        score = (
            0.20 * min(np.log1p(row["declared_value"]) / np.log1p(10_000_000), 1.0)
            + 0.15 * row["trader_risk"]
            + 0.10 * min(row["trader_violations"] / 20.0, 1.0)
            + 0.20 * (0.9 if chapter in HIGH_RISK_HS_CHAPTERS else 0.2)
            + 0.25 * (0.85 if origin in HIGH_RISK_COUNTRIES else (0.5 if origin in MEDIUM_RISK_COUNTRIES else 0.15))
            + 0.10 * min(row["declared_value"] / max(row["weight_kg"], 0.1) / 10_000.0, 1.0)
        )
        risk_scores[i] = np.clip(score + rng.normal(0, 0.05), 0, 1)

    df["risk_score"] = risk_scores * 100
    df["risk_lane"] = pd.cut(
        risk_scores,
        bins=[0, 0.35, 0.70, 1.0],
        labels=["green", "yellow", "red"]
    )

    return df


def build_features(df: pd.DataFrame) -> np.ndarray:
    """Build feature matrix from DataFrame."""
    features = np.zeros((len(df), len(FEATURE_NAMES)), dtype=np.float32)

    for i, (_, row) in enumerate(df.iterrows()):
        declared_value = float(row.get("declared_value", 0) or 0)
        weight = float(row.get("weight_kg", 0) or 0)
        packages = int(row.get("num_packages", 1) or 1)
        hs_code = str(row.get("hs_code", "") or "")
        origin = str(row.get("country_of_origin", "") or "")
        dest = str(row.get("port_of_destination", "") or "")
        trader_risk = float(row.get("trader_risk", 0.3) or 0.3)
        violations = float(row.get("trader_violations", 0) or 0)
        aeo = float(row.get("aeo_status", 0) or 0)

        chapter = hs_code[:2]
        value_norm = min(np.log1p(declared_value) / np.log1p(10_000_000), 1.0)
        hs_fraud_rate = 0.9 if chapter in HIGH_RISK_HS_CHAPTERS else 0.2
        hs_controlled = 1.0 if chapter in {"93", "28", "36"} else 0.0
        hs_duty_rate = 0.35 if chapter in {"22", "24"} else 0.15
        origin_risk = 0.85 if origin in HIGH_RISK_COUNTRIES else (0.5 if origin in MEDIUM_RISK_COUNTRIES else 0.15)
        dest_risk = 0.3 if dest in {"GHTEM", "NGAPP"} else 0.1
        weight_norm = min(weight / 50_000.0, 1.0)
        packages_norm = min(packages / 1000.0, 1.0)
        value_per_kg = (declared_value / max(weight, 0.1)) if weight > 0 else 0.0
        value_per_kg_norm = min(value_per_kg / 10_000.0, 1.0)

        features[i] = [
            value_norm,
            trader_risk,
            min(violations / 50.0, 1.0),
            aeo,
            hs_fraud_rate,
            hs_controlled,
            hs_duty_rate,
            origin_risk,
            dest_risk,
            weight_norm,
            packages_norm,
            value_per_kg_norm,
        ]

    return features


def train(db_url: str, output_path: str, min_samples: int = 500) -> dict:
    """Train the XGBoost + IsolationForest ensemble model."""
    # Fetch real data
    df = fetch_training_data(db_url)

    # Fall back to synthetic data if insufficient real data
    if len(df) < min_samples:
        logger.warning(
            f"Only {len(df)} real samples found (minimum: {min_samples}). "
            "Supplementing with synthetic data."
        )
        synthetic = generate_synthetic_data(max(min_samples, 5000))
        df = pd.concat([df, synthetic], ignore_index=True) if len(df) > 0 else synthetic

    logger.info(f"Training on {len(df)} samples")

    # Build features and labels
    X = build_features(df)
    label_map = {"green": 0, "yellow": 1, "red": 2}
    y = df["risk_lane"].map(label_map).fillna(0).astype(int).values

    # Train/test split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # Train XGBoost
    logger.info("Training XGBoost classifier...")
    xgb_model = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        use_label_encoder=False,
        eval_metric="mlogloss",
        random_state=42,
        n_jobs=-1,
        device="cpu",  # CPU-only inference
    )
    xgb_model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )

    # Train IsolationForest for anomaly detection
    logger.info("Training IsolationForest anomaly detector...")
    iso_forest = IsolationForest(
        n_estimators=100,
        contamination=0.05,
        random_state=42,
        n_jobs=-1,
    )
    iso_forest.fit(X_train)

    # Evaluate
    y_pred = xgb_model.predict(X_test)
    f1 = f1_score(y_test, y_pred, average="weighted")
    report = classification_report(y_test, y_pred, target_names=["green", "yellow", "red"])
    logger.info(f"Test F1 Score (weighted): {f1:.4f}")
    logger.info(f"Classification Report:\n{report}")

    # Save model bundle
    bundle = {
        "xgb": xgb_model,
        "iso_forest": iso_forest,
        "feature_names": FEATURE_NAMES,
        "version": datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S"),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_samples": len(df),
        "f1_score": f1,
        "label_map": label_map,
    }

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "wb") as f:
        pickle.dump(bundle, f, protocol=pickle.HIGHEST_PROTOCOL)

    logger.info(f"Model saved to {output}")

    return {
        "version": bundle["version"],
        "n_samples": len(df),
        "f1_score": f1,
        "output_path": str(output),
    }


def main():
    parser = argparse.ArgumentParser(description="Train AI Risk Scorer model")
    parser.add_argument(
        "--db-url",
        default=os.getenv(
            "DATABASE_URL",
            "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway"
        ),
        help="PostgreSQL connection URL",
    )
    parser.add_argument(
        "--output",
        default=os.getenv("MODEL_PATH", "models/risk_model.pkl"),
        help="Output path for trained model",
    )
    parser.add_argument(
        "--min-samples",
        type=int,
        default=500,
        help="Minimum real samples before using synthetic data",
    )
    args = parser.parse_args()

    result = train(args.db_url, args.output, args.min_samples)
    logger.info(f"Training complete: {result}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
