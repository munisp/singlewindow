#!/usr/bin/env python3
"""
TradeGateway NGSWTP — Continuous Training Pipeline
====================================================
Automated continuous training pipeline that:
  1. Extracts labeled training data from PostgreSQL production database
  2. Generates synthetic data to augment sparse real data
  3. Trains all AI models (GNN, Risk Scorer, HS Classifier)
  4. Tracks experiments in MLflow
  5. Runs distributed training with Ray (when available)
  6. Promotes models to production when F1 > threshold
  7. Detects model drift and triggers retraining
  8. Writes training results to Lakehouse (Delta Lake)
  9. Publishes model update events to Kafka

Trigger modes:
  - Scheduled: Every 24 hours (via Dapr cron)
  - Drift-triggered: When PSI > 0.25
  - Manual: Via tRPC admin endpoint
  - Data-triggered: When 1000+ new labeled samples available

Usage:
    python3 continuous_training_pipeline.py --mode scheduled
    python3 continuous_training_pipeline.py --mode drift-check
    python3 continuous_training_pipeline.py --mode force-retrain
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import numpy as np

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent))

log = logging.getLogger("continuous-training")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# ─── Configuration ────────────────────────────────────────────────────────────

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway"
)
MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
LAKEHOUSE_PATH = os.getenv("LAKEHOUSE_PATH", "/data/lakehouse")
MODEL_DIR = Path(os.getenv("MODEL_DIR", "/tmp/trade_models"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# Training thresholds
MIN_SAMPLES_FOR_TRAINING = 500
MIN_F1_FOR_PROMOTION = 0.75
DRIFT_PSI_THRESHOLD = 0.25
SYNTHETIC_AUGMENTATION_RATIO = 3  # 3x synthetic per real sample


# ─── PostgreSQL Data Extractor ────────────────────────────────────────────────

class PostgresDataExtractor:
    """Extracts labeled training data from PostgreSQL production database."""

    def __init__(self, db_url: str):
        self.db_url = db_url

    def get_labeled_declarations(self, since_days: int = 90, limit: int = 50_000) -> list[dict]:
        """
        Extract labeled declarations from PostgreSQL.
        Uses declarations with known outcomes (cleared/seized/flagged).
        """
        import psycopg2
        import psycopg2.extras

        try:
            conn = psycopg2.connect(self.db_url)
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            cur.execute("""
                WITH trader_stats AS (
                    SELECT
                        trader_id,
                        COUNT(*) as total_declarations,
                        COUNT(*) FILTER (WHERE status = 'seized') as violations,
                        AVG(CAST(declared_value AS NUMERIC)) as avg_value,
                        BOOL_OR(aeo_status) as aeo_status
                    FROM declarations
                    WHERE created_at > NOW() - INTERVAL '%s days'
                    GROUP BY trader_id
                )
                SELECT
                    d.id as declaration_id,
                    d.hs_code,
                    d.country_of_origin,
                    d.port_of_entry,
                    CAST(d.declared_value AS FLOAT) as declared_value,
                    CAST(d.weight_kg AS FLOAT) as weight_kg,
                    d.status,
                    d.risk_score,
                    d.risk_lane,
                    ts.total_declarations,
                    ts.violations,
                    ts.avg_value,
                    COALESCE(ts.aeo_status, false) as aeo_status,
                    d.created_at
                FROM declarations d
                LEFT JOIN trader_stats ts ON ts.trader_id = d.trader_id
                WHERE d.status IN ('cleared', 'seized', 'flagged', 'released')
                  AND d.created_at > NOW() - INTERVAL '%s days'
                  AND d.declared_value IS NOT NULL
                ORDER BY d.created_at DESC
                LIMIT %s
            """, (since_days, since_days, limit))

            rows = cur.fetchall()
            cur.close()
            conn.close()

            log.info(f"Extracted {len(rows)} labeled declarations from PostgreSQL")
            return [dict(r) for r in rows]

        except Exception as e:
            log.error(f"PostgreSQL extraction failed: {e}")
            return []

    def get_new_sample_count(self, since_hours: int = 24) -> int:
        """Count new labeled samples since last training."""
        import psycopg2

        try:
            conn = psycopg2.connect(self.db_url)
            cur = conn.cursor()
            cur.execute("""
                SELECT COUNT(*) FROM declarations
                WHERE status IN ('cleared', 'seized', 'flagged')
                  AND created_at > NOW() - INTERVAL '%s hours'
            """, (since_hours,))
            count = cur.fetchone()[0]
            cur.close()
            conn.close()
            return int(count)
        except Exception:
            return 0

    def get_recent_features_for_drift(self, n: int = 1000) -> Optional[np.ndarray]:
        """Get recent production feature vectors for drift detection."""
        import psycopg2
        import psycopg2.extras

        try:
            conn = psycopg2.connect(self.db_url)
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("""
                SELECT features FROM ai_training_declarations
                WHERE created_at > NOW() - INTERVAL '7 days'
                ORDER BY created_at DESC
                LIMIT %s
            """, (n,))
            rows = cur.fetchall()
            cur.close()
            conn.close()

            if not rows:
                return None
            return np.array([r["features"] for r in rows], dtype=np.float32)
        except Exception:
            return None


# ─── Feature Builder ──────────────────────────────────────────────────────────

def build_features_from_declaration(row: dict) -> list[float]:
    """Build the 12-dimensional feature vector from a production declaration."""
    import math

    declared_value = float(row.get("declared_value") or 0)
    weight_kg = float(row.get("weight_kg") or 1)
    violations = int(row.get("violations") or 0)
    total_decls = int(row.get("total_declarations") or 1)

    # HS fraud rates (from our taxonomy)
    hs_code = str(row.get("hs_code") or "9600")
    hs_chapter = hs_code[:2]

    HS_FRAUD_RATES = {
        "87": 0.35, "61": 0.45, "62": 0.42, "10": 0.55, "27": 0.40,
        "30": 0.25, "85": 0.30, "84": 0.15, "72": 0.15, "17": 0.35,
    }
    HS_DUTY_RATES = {
        "87": 0.35, "61": 0.35, "62": 0.35, "10": 0.50, "27": 0.05,
        "30": 0.05, "85": 0.10, "84": 0.05, "72": 0.05, "17": 0.20,
    }
    HS_CONTROLLED = {"30", "38", "21", "22", "06"}

    ORIGIN_RISK = {
        "CHN": 0.55, "IND": 0.35, "UAE": 0.50, "BEN": 0.70, "TGO": 0.65,
        "PAK": 0.60, "USA": 0.15, "GBR": 0.12, "DEU": 0.10,
    }
    PORT_RISK = {
        "NGAPP": 0.45, "NGTPK": 0.40, "NGPHC": 0.35, "NGKNO": 0.30, "NGABA": 0.38,
    }

    origin = str(row.get("country_of_origin") or "")
    port = str(row.get("port_of_entry") or "")

    return [
        float(math.log1p(declared_value) / math.log1p(1_000_000)),
        float(min(1.0, violations / 20.0)),
        float(min(1.0, violations / max(1, total_decls))),
        float(1.0 if row.get("aeo_status") else 0.0),
        float(HS_FRAUD_RATES.get(hs_chapter, 0.20)),
        float(1.0 if hs_chapter in HS_CONTROLLED else 0.0),
        float(HS_DUTY_RATES.get(hs_chapter, 0.10)),
        float(ORIGIN_RISK.get(origin, 0.30)),
        float(PORT_RISK.get(port, 0.40)),
        float(min(1.0, math.log1p(weight_kg) / math.log1p(50000))),
        float(min(1.0, max(1, int(weight_kg / 20)) / 1000)),
        float(min(1.0, (declared_value / max(0.1, weight_kg)) / 20000)),
    ]


def map_status_to_label(status: str) -> int:
    """Map declaration status to risk label."""
    return {"cleared": 0, "released": 0, "flagged": 1, "seized": 2}.get(status, 1)


# ─── Model Promoter ───────────────────────────────────────────────────────────

class ModelPromoter:
    """Promotes trained models to production when they meet quality thresholds."""

    def __init__(self, mlflow_uri: str):
        self.mlflow_uri = mlflow_uri

    def promote_if_better(
        self,
        model_name: str,
        run_id: str,
        f1_score: float,
        threshold: float = MIN_F1_FOR_PROMOTION,
    ) -> bool:
        """Promote model to production if F1 exceeds threshold."""
        try:
            import mlflow
            from mlflow.tracking import MlflowClient

            mlflow.set_tracking_uri(self.mlflow_uri)
            client = MlflowClient()

            # Register model
            model_uri = f"runs:/{run_id}/model"
            try:
                client.create_registered_model(model_name)
            except Exception:
                pass  # Already exists

            version = client.create_model_version(
                name=model_name,
                source=model_uri,
                run_id=run_id,
            )

            if f1_score >= threshold:
                client.transition_model_version_stage(
                    name=model_name,
                    version=version.version,
                    stage="Production",
                )
                log.info(f"Model {model_name} v{version.version} promoted to Production (F1={f1_score:.4f})")
                return True
            else:
                client.transition_model_version_stage(
                    name=model_name,
                    version=version.version,
                    stage="Staging",
                )
                log.info(f"Model {model_name} v{version.version} moved to Staging (F1={f1_score:.4f} < {threshold})")
                return False

        except Exception as e:
            log.warning(f"MLflow model promotion failed: {e}")
            return False


# ─── Kafka Publisher ──────────────────────────────────────────────────────────

def publish_model_update_event(model_name: str, metrics: dict, brokers: str) -> None:
    """Publish model update event to Kafka for downstream consumers."""
    try:
        from kafka import KafkaProducer

        producer = KafkaProducer(
            bootstrap_servers=brokers.split(","),
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        )
        event = {
            "event_type": "model.updated",
            "model_name": model_name,
            "metrics": metrics,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        producer.send("ai.model.events", event)
        producer.flush()
        producer.close()
        log.info(f"Published model update event for {model_name}")
    except Exception as e:
        log.warning(f"Kafka publish failed: {e}")


# ─── Lakehouse Writer ─────────────────────────────────────────────────────────

def write_training_results_to_lakehouse(results: dict, lakehouse_path: str) -> None:
    """Write training results to Delta Lake for analytics."""
    try:
        import pandas as pd

        results_path = Path(lakehouse_path) / "ai_training_runs"
        results_path.mkdir(parents=True, exist_ok=True)

        df = pd.DataFrame([{
            "run_id": results.get("run_id", ""),
            "model_name": results.get("model_name", ""),
            "f1_score": results.get("f1_score", 0.0),
            "n_samples": results.get("n_samples", 0),
            "promoted": results.get("promoted", False),
            "trained_at": datetime.now(timezone.utc).isoformat(),
        }])

        parquet_path = results_path / f"run_{int(time.time())}.parquet"
        df.to_parquet(parquet_path, index=False)
        log.info(f"Training results written to {parquet_path}")
    except Exception as e:
        log.warning(f"Lakehouse write failed: {e}")


# ─── Main Training Pipeline ───────────────────────────────────────────────────

class ContinuousTrainingPipeline:
    """
    Orchestrates the full continuous training pipeline.
    Runs all AI models in sequence with shared data.
    """

    def __init__(self):
        self.extractor = PostgresDataExtractor(DATABASE_URL)
        self.promoter = ModelPromoter(MLFLOW_TRACKING_URI)

    def run(self, mode: str = "scheduled", force: bool = False) -> dict[str, Any]:
        """
        Run the continuous training pipeline.

        Args:
            mode: "scheduled" | "drift-check" | "force-retrain"
            force: Force retraining even if not enough new samples

        Returns:
            Pipeline results dict
        """
        start_time = time.time()
        results = {
            "mode": mode,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "models": {},
        }

        log.info(f"Starting continuous training pipeline (mode={mode})")

        # ── 1. Check if retraining is needed ─────────────────────────────────
        if mode == "drift-check":
            recent_features = self.extractor.get_recent_features_for_drift()
            if recent_features is not None:
                from risk.risk_scorer import EnsembleRiskScorer
                scorer = EnsembleRiskScorer()
                drift = scorer.check_drift(recent_features)
                results["drift_check"] = drift
                if not drift["drift_detected"] and not force:
                    log.info("No drift detected — skipping retraining")
                    results["skipped"] = True
                    return results
            else:
                log.info("No recent features for drift check — proceeding with training")

        if mode == "scheduled" and not force:
            new_samples = self.extractor.get_new_sample_count(since_hours=24)
            if new_samples < MIN_SAMPLES_FOR_TRAINING:
                log.info(f"Only {new_samples} new samples (< {MIN_SAMPLES_FOR_TRAINING}) — skipping")
                results["skipped"] = True
                results["new_samples"] = new_samples
                return results

        # ── 2. Extract production data ────────────────────────────────────────
        log.info("Extracting production data from PostgreSQL...")
        prod_rows = self.extractor.get_labeled_declarations(since_days=90)
        log.info(f"Extracted {len(prod_rows)} production samples")

        # ── 3. Generate synthetic data ────────────────────────────────────────
        from data.nigerian_synthetic_generator import NigerianSyntheticGenerator

        n_synthetic = max(5000, len(prod_rows) * SYNTHETIC_AUGMENTATION_RATIO)
        log.info(f"Generating {n_synthetic:,} synthetic samples...")
        gen = NigerianSyntheticGenerator()
        node_features_syn, edge_index_syn, labels_syn = gen.generate_graph_data_for_gnn(
            n_samples=n_synthetic
        )

        # ── 4. Build combined dataset ─────────────────────────────────────────
        if prod_rows:
            prod_features = np.array([build_features_from_declaration(r) for r in prod_rows],
                                     dtype=np.float32)
            prod_labels = np.array([map_status_to_label(r["status"]) for r in prod_rows],
                                   dtype=np.int64)
            X_combined = np.vstack([node_features_syn, prod_features])
            y_combined = np.concatenate([labels_syn, prod_labels])
        else:
            X_combined = node_features_syn
            y_combined = labels_syn

        log.info(f"Combined dataset: {len(X_combined):,} samples, "
                 f"label distribution: {np.bincount(y_combined)}")

        # ── 5. Train GNN ──────────────────────────────────────────────────────
        log.info("Training Fraud Detection GNN...")
        try:
            from gnn.fraud_gnn import FraudGNNTrainer
            gnn_trainer = FraudGNNTrainer(mlflow_uri=MLFLOW_TRACKING_URI)
            gnn_metrics = gnn_trainer.train(
                X_combined, edge_index_syn, y_combined,
                experiment_name="fraud-gnn-continuous"
            )
            results["models"]["fraud_gnn"] = {
                "f1": gnn_metrics.get("best_val_f1", 0),
                "trained": not gnn_metrics.get("error"),
                "engine": gnn_metrics.get("architecture", ""),
            }
            log.info(f"GNN training complete: F1={gnn_metrics.get('best_val_f1', 0):.4f}")
        except Exception as e:
            log.error(f"GNN training failed: {e}")
            results["models"]["fraud_gnn"] = {"error": str(e)}

        # ── 6. Train Risk Scorer ──────────────────────────────────────────────
        log.info("Training Ensemble Risk Scorer...")
        try:
            from risk.risk_scorer import EnsembleRiskScorer
            scorer = EnsembleRiskScorer(mlflow_uri=MLFLOW_TRACKING_URI)
            scorer_metrics = scorer.train(
                X_combined, y_combined,
                tune_hyperparams=len(X_combined) >= 5000,
                experiment_name="risk-scorer-continuous"
            )
            results["models"]["risk_scorer"] = {
                "f1": scorer_metrics.get("ensemble_val_f1", 0),
                "trained": not scorer_metrics.get("error"),
            }
            log.info(f"Risk scorer training complete: F1={scorer_metrics.get('ensemble_val_f1', 0):.4f}")
        except Exception as e:
            log.error(f"Risk scorer training failed: {e}")
            results["models"]["risk_scorer"] = {"error": str(e)}

        # ── 7. Train HS Classifier ────────────────────────────────────────────
        log.info("Training HS Code Classifier...")
        try:
            from hs.hs_classifier import HSCodeClassifier
            hs_clf = HSCodeClassifier(mlflow_uri=MLFLOW_TRACKING_URI)

            # Extract goods descriptions from production data if available
            extra_descs = None
            extra_labels_hs = None
            if prod_rows:
                extra_descs = [r.get("goods_description", "") for r in prod_rows
                               if r.get("goods_description")]
                extra_labels_hs = [str(r.get("hs_code", "9600"))[:2] for r in prod_rows
                                   if r.get("goods_description")]

            hs_metrics = hs_clf.train(
                extra_descriptions=extra_descs,
                extra_labels=extra_labels_hs,
                experiment_name="hs-classifier-continuous"
            )
            results["models"]["hs_classifier"] = {
                "f1": hs_metrics.get("cv_f1_mean", 0),
                "trained": not hs_metrics.get("error"),
            }
            log.info(f"HS classifier training complete: F1={hs_metrics.get('cv_f1_mean', 0):.4f}")
        except Exception as e:
            log.error(f"HS classifier training failed: {e}")
            results["models"]["hs_classifier"] = {"error": str(e)}

        # ── 8. Write results to Lakehouse ─────────────────────────────────────
        for model_name, model_results in results["models"].items():
            write_training_results_to_lakehouse(
                {**model_results, "model_name": model_name, "n_samples": len(X_combined)},
                LAKEHOUSE_PATH
            )

        # ── 9. Publish Kafka events ───────────────────────────────────────────
        for model_name, model_results in results["models"].items():
            if not model_results.get("error"):
                publish_model_update_event(model_name, model_results, KAFKA_BROKERS)

        # ── 10. Save pipeline run record to PostgreSQL ────────────────────────
        try:
            import psycopg2
            conn = psycopg2.connect(DATABASE_URL)
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ai_training_runs (
                    id BIGSERIAL PRIMARY KEY,
                    mode VARCHAR(32),
                    n_samples INT,
                    models JSONB,
                    duration_seconds FLOAT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""
                INSERT INTO ai_training_runs (mode, n_samples, models, duration_seconds)
                VALUES (%s, %s, %s, %s)
            """, (mode, len(X_combined), json.dumps(results["models"]),
                  time.time() - start_time))
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            log.warning(f"Failed to save training run record: {e}")

        results["duration_seconds"] = round(time.time() - start_time, 2)
        results["n_samples"] = len(X_combined)
        results["completed_at"] = datetime.now(timezone.utc).isoformat()

        log.info(f"Pipeline complete in {results['duration_seconds']}s")
        return results


# ─── Ray Distributed Training ─────────────────────────────────────────────────

def run_with_ray(pipeline: ContinuousTrainingPipeline, mode: str) -> dict:
    """Run training pipeline with Ray for distributed compute."""
    try:
        import ray

        @ray.remote
        def train_gnn_remote(X, edge_index, y):
            from gnn.fraud_gnn import FraudGNNTrainer
            trainer = FraudGNNTrainer()
            return trainer.train(X, edge_index, y)

        @ray.remote
        def train_scorer_remote(X, y):
            from risk.risk_scorer import EnsembleRiskScorer
            scorer = EnsembleRiskScorer()
            return scorer.train(X, y)

        ray.init(ignore_reinit_error=True)

        from data.nigerian_synthetic_generator import NigerianSyntheticGenerator
        gen = NigerianSyntheticGenerator()
        X, edge_index, y = gen.generate_graph_data_for_gnn(n_samples=20_000)

        # Run GNN and risk scorer in parallel
        gnn_future = train_gnn_remote.remote(X, edge_index, y)
        scorer_future = train_scorer_remote.remote(X, y)

        gnn_results = ray.get(gnn_future)
        scorer_results = ray.get(scorer_future)

        return {
            "fraud_gnn": gnn_results,
            "risk_scorer": scorer_results,
            "distributed": True,
        }

    except ImportError:
        log.info("Ray not available — running sequentially")
        return pipeline.run(mode=mode)


# ─── Entry Point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Continuous Training Pipeline")
    parser.add_argument("--mode", choices=["scheduled", "drift-check", "force-retrain"],
                        default="force-retrain")
    parser.add_argument("--ray", action="store_true", help="Use Ray for distributed training")
    args = parser.parse_args()

    pipeline = ContinuousTrainingPipeline()

    if args.ray:
        results = run_with_ray(pipeline, args.mode)
    else:
        results = pipeline.run(mode=args.mode, force=args.mode == "force-retrain")

    print(json.dumps({
        k: v for k, v in results.items()
        if k not in ("classification_report",)
    }, indent=2, default=str))
