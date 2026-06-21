"""
retrain_scheduler.py — APScheduler nightly cron that retrains the IsolationForest
model using the last 30 days of insider_threat_events from the database.

Runs at 02:00 UTC daily. Can also be triggered manually via POST /train.

Environment variables:
  DATABASE_URL       — PostgreSQL/MySQL connection string
  INSIDER_THREAT_SVC_URL — base URL of this service (default: http://localhost:8000)
  RETRAIN_CONTAMINATION  — IsolationForest contamination (default: 0.05)
  RETRAIN_N_ESTIMATORS   — number of trees (default: 100)
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

SVC_URL = os.getenv("INSIDER_THREAT_SVC_URL", "http://localhost:8000")
CONTAMINATION = float(os.getenv("RETRAIN_CONTAMINATION", "0.05"))
N_ESTIMATORS = int(os.getenv("RETRAIN_N_ESTIMATORS", "100"))
MIN_EVENTS_FOR_RETRAIN = int(os.getenv("RETRAIN_MIN_EVENTS", "50"))

# ─── Database fetch ───────────────────────────────────────────────────────────

def _fetch_recent_events(days: int = 30) -> list[dict]:
    """
    Fetch insider_threat_events from the last `days` days.
    Returns a list of feature dicts compatible with the /train endpoint.
    Falls back to an empty list on DB errors.
    """
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        logger.warning("DATABASE_URL not set; cannot fetch events for retraining")
        return []

    try:
        import sqlalchemy as sa
        engine = sa.create_engine(db_url, pool_pre_ping=True, pool_size=1, max_overflow=0)
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        with engine.connect() as conn:
            rows = conn.execute(
                sa.text(
                    """
                    SELECT
                        EXTRACT(HOUR FROM detected_at)::int          AS hour_of_day,
                        COALESCE(metadata->>'action_count', '1')::int AS action_count_per_hour,
                        COALESCE(metadata->>'unique_records', '1')::int AS unique_records_accessed,
                        COALESCE(metadata->>'role', 'trader')         AS role,
                        COALESCE(metadata->>'action', 'general')      AS action,
                        (severity IN ('HIGH', 'CRITICAL'))            AS is_anomaly
                    FROM insider_threat_events
                    WHERE detected_at >= :cutoff
                    ORDER BY detected_at DESC
                    LIMIT 10000
                    """
                ),
                {"cutoff": cutoff},
            ).fetchall()

        events = [
            {
                "hour_of_day": int(r[0]),
                "action_count_per_hour": int(r[1]),
                "unique_records_accessed": int(r[2]),
                "role": str(r[3]),
                "action": str(r[4]),
                "is_anomaly": bool(r[5]),
            }
            for r in rows
        ]
        logger.info("Fetched %d events from DB for retraining (last %d days)", len(events), days)
        return events

    except Exception as exc:
        logger.error("Failed to fetch events from DB: %s", exc)
        return []


# ─── Retrain job ──────────────────────────────────────────────────────────────

def run_nightly_retrain() -> Optional[dict]:
    """
    Fetch recent events and call POST /train on the local service.
    Returns the train response dict on success, None on failure.
    """
    logger.info("Starting nightly model retraining job")
    events = _fetch_recent_events(days=30)

    if len(events) < MIN_EVENTS_FOR_RETRAIN:
        logger.warning(
            "Only %d events available (minimum %d); skipping retraining",
            len(events), MIN_EVENTS_FOR_RETRAIN,
        )
        return None

    try:
        resp = requests.post(
            f"{SVC_URL}/train",
            json={
                "events": events,
                "contamination": CONTAMINATION,
                "n_estimators": N_ESTIMATORS,
            },
            timeout=120,
        )
        resp.raise_for_status()
        result = resp.json()
        logger.info(
            "Nightly retraining complete: model v%d trained on %d samples",
            result.get("version"), result.get("n_samples"),
        )
        return result
    except Exception as exc:
        logger.error("Nightly retraining failed: %s", exc)
        return None


# ─── Scheduler setup ──────────────────────────────────────────────────────────

_scheduler: Optional[BackgroundScheduler] = None


def start_scheduler() -> BackgroundScheduler:
    """Start the APScheduler background scheduler with the nightly retrain job."""
    global _scheduler
    if _scheduler and _scheduler.running:
        logger.info("Scheduler already running")
        return _scheduler

    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(
        run_nightly_retrain,
        trigger=CronTrigger(hour=2, minute=0),  # 02:00 UTC daily
        id="nightly_retrain",
        name="Nightly IsolationForest Retraining",
        replace_existing=True,
        misfire_grace_time=3600,  # allow up to 1h late start
    )
    _scheduler.start()
    logger.info(
        "APScheduler started: nightly retrain job scheduled at 02:00 UTC; "
        "next run: %s",
        _scheduler.get_job("nightly_retrain").next_run_time,
    )
    return _scheduler


def stop_scheduler() -> None:
    """Gracefully stop the scheduler."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("APScheduler stopped")


def get_next_run_time() -> Optional[str]:
    """Return the next scheduled run time as ISO8601 string."""
    if not _scheduler:
        return None
    job = _scheduler.get_job("nightly_retrain")
    if not job or not job.next_run_time:
        return None
    return job.next_run_time.isoformat()
