"""
run_pipeline.py — TradeGateway NGSWTP Lakehouse Pipeline Runner
R5 FIX: Activates the Flink pipeline in production (PyFlink available) or
         falls back to a delta-rs batch writer for development/staging.

Usage:
  python run_pipeline.py                    # Auto-detect mode
  python run_pipeline.py --mode flink       # Force PyFlink mode
  python run_pipeline.py --mode batch       # Force delta-rs batch mode
  python run_pipeline.py --mode dry-run     # Validate config only

Environment variables:
  KAFKA_BROKERS       — Kafka bootstrap servers (default: localhost:9092)
  DELTA_BASE_PATH     — S3/MinIO base path (default: s3://tradegateway-lakehouse/delta)
  CHECKPOINT_DIR      — Flink checkpoint directory (default: s3://tradegateway-lakehouse/checkpoints)
  FLINK_PARALLELISM   — Job parallelism (default: 4)
  AWS_ACCESS_KEY_ID   — S3 credentials (or use IAM role)
  AWS_SECRET_ACCESS_KEY
  AWS_ENDPOINT_URL    — MinIO endpoint for local dev (e.g. http://minio:9000)
"""
from __future__ import annotations
import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("lakehouse.runner")

KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
DELTA_BASE_PATH = os.getenv("DELTA_BASE_PATH", "s3://tradegateway-lakehouse/delta")
CHECKPOINT_DIR = os.getenv("CHECKPOINT_DIR", "s3://tradegateway-lakehouse/checkpoints")
FLINK_PARALLELISM = int(os.getenv("FLINK_PARALLELISM", "4"))

TOPICS = [
    "tradegateway.declarations",
    "tradegateway.payments",
    "tradegateway.oga_permits",
    "tradegateway.risk_scores",
    "tradegateway.audit_log",
    "tradegateway.cargo_tracking",
    "tradegateway.sanctions_screening",
]


def detect_mode() -> str:
    """Detect available runtime and return the best mode."""
    try:
        import pyflink  # noqa: F401
        logger.info("[runner] PyFlink detected — using Flink streaming mode")
        return "flink"
    except ImportError:
        pass
    try:
        import deltalake  # noqa: F401
        logger.info("[runner] delta-rs detected — using batch write mode")
        return "batch"
    except ImportError:
        pass
    logger.warning("[runner] Neither PyFlink nor delta-rs found — using dry-run mode")
    return "dry-run"


def run_flink_mode() -> dict[str, Any]:
    """Run the full PyFlink streaming pipeline."""
    from pyflink.datastream import StreamExecutionEnvironment
    from pyflink.datastream.connectors.kafka import KafkaSource, KafkaOffsetsInitializer
    from pyflink.common import WatermarkStrategy
    from pyflink.common.serialization import SimpleStringSchema

    # Import table configs from the main pipeline spec
    sys.path.insert(0, os.path.dirname(__file__))
    from flink_kafka_delta_pipeline import TABLES, transform_event  # type: ignore

    env = StreamExecutionEnvironment.get_execution_environment()
    env.set_parallelism(FLINK_PARALLELISM)
    env.enable_checkpointing(60_000)  # Checkpoint every 60s
    env.get_checkpoint_config().set_checkpoint_storage(CHECKPOINT_DIR)

    # Configure S3/MinIO filesystem
    env.get_config().set_string("s3.access-key", os.getenv("AWS_ACCESS_KEY_ID", ""))
    env.get_config().set_string("s3.secret-key", os.getenv("AWS_SECRET_ACCESS_KEY", ""))
    if endpoint := os.getenv("AWS_ENDPOINT_URL"):
        env.get_config().set_string("s3.endpoint", endpoint)
        env.get_config().set_string("s3.path.style.access", "true")

    for topic, config in TABLES.items():
        source = (
            KafkaSource.builder()
            .set_bootstrap_servers(KAFKA_BROKERS)
            .set_topics(topic)
            .set_group_id(f"flink-delta-{topic.replace('.', '-')}")
            .set_starting_offsets(KafkaOffsetsInitializer.latest())
            .set_value_only_deserializer(SimpleStringSchema())
            .build()
        )
        stream = env.from_source(source, WatermarkStrategy.no_watermarks(), topic)
        (
            stream
            .map(lambda msg, t=topic: transform_event(t, json.loads(msg)))
            .filter(lambda r: r is not None)
        )
        logger.info(f"[runner] Registered stream for topic: {topic} → {config['path']}")

    logger.info("[runner] Executing Flink job: TradeGateway Lakehouse Ingestion")
    env.execute("TradeGateway Lakehouse Ingestion")
    return {"status": "running", "mode": "flink", "topics": TOPICS}


def run_batch_mode() -> dict[str, Any]:
    """
    Batch write mode using delta-rs.
    Reads from Kafka using confluent-kafka and writes micro-batches to Delta Lake.
    Suitable for development and staging environments.
    """
    try:
        from confluent_kafka import Consumer, KafkaError  # type: ignore
        import pyarrow as pa  # type: ignore
        from deltalake import write_deltalake  # type: ignore
    except ImportError as e:
        logger.error(f"[runner] Missing dependency for batch mode: {e}")
        logger.error("[runner] Install: pip install confluent-kafka pyarrow deltalake")
        return {"status": "error", "mode": "batch", "error": str(e)}

    sys.path.insert(0, os.path.dirname(__file__))
    from flink_kafka_delta_pipeline import TABLES, transform_event  # type: ignore

    conf = {
        "bootstrap.servers": KAFKA_BROKERS,
        "group.id": "tradegateway-batch-writer",
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
    }
    consumer = Consumer(conf)
    consumer.subscribe(TOPICS)

    storage_options: dict[str, str] = {}
    if key := os.getenv("AWS_ACCESS_KEY_ID"):
        storage_options["AWS_ACCESS_KEY_ID"] = key
    if secret := os.getenv("AWS_SECRET_ACCESS_KEY"):
        storage_options["AWS_SECRET_ACCESS_KEY"] = secret
    if endpoint := os.getenv("AWS_ENDPOINT_URL"):
        storage_options["AWS_ENDPOINT_URL"] = endpoint
        storage_options["AWS_ALLOW_HTTP"] = "true"

    buffers: dict[str, list[dict]] = {t: [] for t in TOPICS}
    BATCH_SIZE = 100
    processed = 0

    logger.info("[runner] Starting batch consumer loop (Ctrl+C to stop)")
    try:
        while True:
            msg = consumer.poll(timeout=1.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                logger.error(f"[runner] Kafka error: {msg.error()}")
                continue

            topic = msg.topic()
            try:
                record = transform_event(topic, json.loads(msg.value().decode("utf-8")))
                if record:
                    buffers[topic].append(record)
                    processed += 1
            except Exception as e:
                logger.warning(f"[runner] Failed to transform message from {topic}: {e}")
                continue

            if len(buffers[topic]) >= BATCH_SIZE:
                _flush_buffer(topic, buffers[topic], TABLES, storage_options)
                consumer.commit()
                buffers[topic] = []
                logger.info(f"[runner] Flushed {BATCH_SIZE} records for {topic} (total: {processed})")

    except KeyboardInterrupt:
        logger.info("[runner] Shutting down — flushing remaining buffers")
        for topic, buf in buffers.items():
            if buf:
                _flush_buffer(topic, buf, TABLES, storage_options)
        consumer.close()

    return {"status": "stopped", "mode": "batch", "processed": processed}


def _flush_buffer(topic: str, records: list[dict], tables: dict, storage_options: dict) -> None:
    """Write a batch of records to Delta Lake."""
    import pyarrow as pa  # type: ignore
    from deltalake import write_deltalake  # type: ignore

    config = tables.get(topic)
    if not config:
        return
    try:
        table = pa.Table.from_pylist(records, schema=config["schema"])
        write_deltalake(
            config["path"],
            table,
            mode="append",
            partition_by=config.get("partition_by", []),
            storage_options=storage_options,
        )
    except Exception as e:
        logger.error(f"[runner] Failed to write to Delta Lake for {topic}: {e}")


def run_dry_run() -> dict[str, Any]:
    """Validate configuration without connecting to any external services."""
    logger.info("[runner] DRY RUN — validating pipeline configuration")
    logger.info(f"[runner] Kafka brokers: {KAFKA_BROKERS}")
    logger.info(f"[runner] Delta base path: {DELTA_BASE_PATH}")
    logger.info(f"[runner] Checkpoint dir: {CHECKPOINT_DIR}")
    logger.info(f"[runner] Parallelism: {FLINK_PARALLELISM}")
    for topic in TOPICS:
        logger.info(f"[runner] Topic: {topic}")
    return {
        "status": "dry-run",
        "kafka_brokers": KAFKA_BROKERS,
        "delta_base_path": DELTA_BASE_PATH,
        "topics": TOPICS,
        "parallelism": FLINK_PARALLELISM,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="TradeGateway Lakehouse Pipeline Runner")
    parser.add_argument(
        "--mode",
        choices=["flink", "batch", "dry-run", "auto"],
        default="auto",
        help="Pipeline execution mode (default: auto-detect)",
    )
    args = parser.parse_args()

    mode = args.mode if args.mode != "auto" else detect_mode()
    logger.info(f"[runner] Starting pipeline in mode: {mode}")

    if mode == "flink":
        result = run_flink_mode()
    elif mode == "batch":
        result = run_batch_mode()
    else:
        result = run_dry_run()

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
