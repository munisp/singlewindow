"""
flink-kafka-delta-pipeline.py — TradeGateway NGSWTP Lakehouse Ingestion
Reads Kafka events and writes to Delta Lake tables using Apache Flink + delta-rs.

Architecture:
  Kafka Topics → Flink Streaming Job → Delta Lake (S3/MinIO)
                                     → OpenSearch (for real-time analytics)

Tables created:
  - delta/declarations/         — All declaration events
  - delta/payments/             — All payment events
  - delta/oga_permits/          — OGA permit events
  - delta/risk_scores/          — Risk scoring results
  - delta/audit_log/            — Immutable audit trail
  - delta/cargo_tracking/       — Cargo position and status events
  - delta/sanctions_screening/  — Sanctions screening results

Partitioning: All tables partitioned by year/month for efficient querying.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

# In production: use pyflink + delta-rs
# from pyflink.datastream import StreamExecutionEnvironment
# from pyflink.datastream.connectors.kafka import KafkaSource, KafkaOffsetsInitializer
# from pyflink.common import WatermarkStrategy, Types
# from deltalake import DeltaTable, write_deltalake
# import pyarrow as pa

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
DELTA_BASE_PATH = os.getenv("DELTA_BASE_PATH", "s3://tradegateway-lakehouse/delta")
CHECKPOINT_DIR = os.getenv("FLINK_CHECKPOINT_DIR", "s3://tradegateway-lakehouse/flink-checkpoints")

# ── Delta Lake table schemas (PyArrow) ────────────────────────────────────────
import pyarrow as pa

DECLARATION_SCHEMA = pa.schema([
    pa.field("event_id", pa.string()),
    pa.field("declaration_id", pa.int64()),
    pa.field("trader_id", pa.int64()),
    pa.field("hs_code", pa.string()),
    pa.field("declared_value", pa.float64()),
    pa.field("origin_country", pa.string()),
    pa.field("status", pa.string()),
    pa.field("risk_lane", pa.string()),
    pa.field("risk_score", pa.float64()),
    pa.field("event_type", pa.string()),
    pa.field("event_time", pa.timestamp("us", tz="UTC")),
    pa.field("year", pa.int32()),
    pa.field("month", pa.int32()),
])

PAYMENT_SCHEMA = pa.schema([
    pa.field("event_id", pa.string()),
    pa.field("invoice_id", pa.int64()),
    pa.field("declaration_id", pa.int64()),
    pa.field("trader_id", pa.int64()),
    pa.field("amount", pa.float64()),
    pa.field("currency", pa.string()),
    pa.field("mojaloop_tx_id", pa.string()),
    pa.field("status", pa.string()),
    pa.field("event_type", pa.string()),
    pa.field("event_time", pa.timestamp("us", tz="UTC")),
    pa.field("year", pa.int32()),
    pa.field("month", pa.int32()),
])

OGA_PERMIT_SCHEMA = pa.schema([
    pa.field("event_id", pa.string()),
    pa.field("permit_id", pa.int64()),
    pa.field("declaration_id", pa.int64()),
    pa.field("agency_code", pa.string()),
    pa.field("agency_name", pa.string()),
    pa.field("status", pa.string()),
    pa.field("response_hours", pa.float64()),
    pa.field("sla_met", pa.bool_()),
    pa.field("event_type", pa.string()),
    pa.field("event_time", pa.timestamp("us", tz="UTC")),
    pa.field("year", pa.int32()),
    pa.field("month", pa.int32()),
])

RISK_SCORE_SCHEMA = pa.schema([
    pa.field("event_id", pa.string()),
    pa.field("declaration_id", pa.int64()),
    pa.field("trader_id", pa.int64()),
    pa.field("score", pa.float64()),
    pa.field("lane", pa.string()),
    pa.field("hs_risk", pa.float64()),
    pa.field("country_risk", pa.float64()),
    pa.field("trader_risk", pa.float64()),
    pa.field("value_deviation", pa.float64()),
    pa.field("model_version", pa.string()),
    pa.field("event_time", pa.timestamp("us", tz="UTC")),
    pa.field("year", pa.int32()),
    pa.field("month", pa.int32()),
])

AUDIT_SCHEMA = pa.schema([
    pa.field("event_id", pa.string()),
    pa.field("entity_type", pa.string()),
    pa.field("entity_id", pa.int64()),
    pa.field("action", pa.string()),
    pa.field("actor_id", pa.string()),
    pa.field("details", pa.string()),
    pa.field("ip_address", pa.string()),
    pa.field("event_time", pa.timestamp("us", tz="UTC")),
    pa.field("year", pa.int32()),
    pa.field("month", pa.int32()),
])

CARGO_SCHEMA = pa.schema([
    pa.field("event_id", pa.string()),
    pa.field("declaration_id", pa.int64()),
    pa.field("vessel_imo", pa.string()),
    pa.field("vessel_name", pa.string()),
    pa.field("latitude", pa.float64()),
    pa.field("longitude", pa.float64()),
    pa.field("port_code", pa.string()),
    pa.field("status", pa.string()),
    pa.field("event_type", pa.string()),
    pa.field("event_time", pa.timestamp("us", tz="UTC")),
    pa.field("year", pa.int32()),
    pa.field("month", pa.int32()),
])


# ── Table configuration ───────────────────────────────────────────────────────
TABLES = {
    "declaration.submitted": {
        "path": f"{DELTA_BASE_PATH}/declarations",
        "schema": DECLARATION_SCHEMA,
        "partition_by": ["year", "month"],
    },
    "declaration.cleared": {
        "path": f"{DELTA_BASE_PATH}/declarations",
        "schema": DECLARATION_SCHEMA,
        "partition_by": ["year", "month"],
    },
    "declaration.rejected": {
        "path": f"{DELTA_BASE_PATH}/declarations",
        "schema": DECLARATION_SCHEMA,
        "partition_by": ["year", "month"],
    },
    "payment.confirmed": {
        "path": f"{DELTA_BASE_PATH}/payments",
        "schema": PAYMENT_SCHEMA,
        "partition_by": ["year", "month"],
    },
    "payment.failed": {
        "path": f"{DELTA_BASE_PATH}/payments",
        "schema": PAYMENT_SCHEMA,
        "partition_by": ["year", "month"],
    },
    "oga.permit.approved": {
        "path": f"{DELTA_BASE_PATH}/oga_permits",
        "schema": OGA_PERMIT_SCHEMA,
        "partition_by": ["year", "month"],
    },
    "oga.permit.rejected": {
        "path": f"{DELTA_BASE_PATH}/oga_permits",
        "schema": OGA_PERMIT_SCHEMA,
        "partition_by": ["year", "month"],
    },
    "risk.score.computed": {
        "path": f"{DELTA_BASE_PATH}/risk_scores",
        "schema": RISK_SCORE_SCHEMA,
        "partition_by": ["year", "month"],
    },
    "audit.event": {
        "path": f"{DELTA_BASE_PATH}/audit_log",
        "schema": AUDIT_SCHEMA,
        "partition_by": ["year", "month"],
    },
    "cargo.vessel.position": {
        "path": f"{DELTA_BASE_PATH}/cargo_tracking",
        "schema": CARGO_SCHEMA,
        "partition_by": ["year", "month"],
    },
}


def transform_event(topic: str, event: dict) -> dict | None:
    """Transform a Kafka event into a Delta Lake record."""
    now = datetime.now(timezone.utc)
    event_time = now

    base = {
        "event_id": event.get("eventId", f"{topic}-{event.get('id', '')}"),
        "event_type": topic,
        "event_time": event_time,
        "year": event_time.year,
        "month": event_time.month,
    }

    if topic.startswith("declaration."):
        return {**base,
            "declaration_id": event.get("declarationId"),
            "trader_id": event.get("traderId"),
            "hs_code": event.get("hsCode", ""),
            "declared_value": event.get("declaredValue", 0.0),
            "origin_country": event.get("originCountry", ""),
            "status": event.get("status", ""),
            "risk_lane": event.get("riskLane", ""),
            "risk_score": event.get("riskScore", 0.0),
        }

    if topic.startswith("payment."):
        return {**base,
            "invoice_id": event.get("invoiceId"),
            "declaration_id": event.get("declarationId"),
            "trader_id": event.get("traderId"),
            "amount": event.get("amount", 0.0),
            "currency": event.get("currency", "GHS"),
            "mojaloop_tx_id": event.get("mojaloopTxId", ""),
            "status": event.get("status", ""),
        }

    if topic.startswith("oga.permit."):
        return {**base,
            "permit_id": event.get("permitId"),
            "declaration_id": event.get("declarationId"),
            "agency_code": event.get("agencyCode", ""),
            "agency_name": event.get("agencyName", ""),
            "status": "approved" if "approved" in topic else "rejected",
            "response_hours": event.get("responseHours", 0.0),
            "sla_met": event.get("slaMet", True),
        }

    if topic == "risk.score.computed":
        features = event.get("features", {})
        return {**base,
            "declaration_id": event.get("declarationId"),
            "trader_id": event.get("traderId"),
            "score": event.get("score", 0.0),
            "lane": event.get("lane", "yellow"),
            "hs_risk": features.get("hsRisk", 0.0),
            "country_risk": features.get("countryRisk", 0.0),
            "trader_risk": features.get("traderRisk", 0.0),
            "value_deviation": features.get("valueDeviation", 0.0),
            "model_version": event.get("modelVersion", "unknown"),
        }

    if topic == "audit.event":
        return {**base,
            "entity_type": event.get("entityType", ""),
            "entity_id": event.get("entityId", 0),
            "action": event.get("action", ""),
            "actor_id": str(event.get("actorId", "")),
            "details": json.dumps(event.get("details", {})),
            "ip_address": event.get("ipAddress", ""),
        }

    if topic == "cargo.vessel.position":
        return {**base,
            "declaration_id": event.get("declarationId", 0),
            "vessel_imo": event.get("vesselImo", ""),
            "vessel_name": event.get("vesselName", ""),
            "latitude": event.get("latitude", 0.0),
            "longitude": event.get("longitude", 0.0),
            "port_code": event.get("portCode", ""),
            "status": event.get("status", ""),
        }

    return None


def create_flink_pipeline():
    """
    Creates and configures the Flink streaming pipeline.
    In production, this runs as a long-lived Flink job.
    """
    logger.info("[lakehouse] Configuring Flink pipeline")
    logger.info(f"[lakehouse] Kafka brokers: {KAFKA_BROKERS}")
    logger.info(f"[lakehouse] Delta base path: {DELTA_BASE_PATH}")
    logger.info(f"[lakehouse] Topics: {list(TABLES.keys())}")

    # Production implementation:
    # env = StreamExecutionEnvironment.get_execution_environment()
    # env.enable_checkpointing(60_000)  # Checkpoint every 60s
    # env.get_checkpoint_config().set_checkpoint_storage(CHECKPOINT_DIR)
    #
    # for topic, config in TABLES.items():
    #     source = KafkaSource.builder() \
    #         .set_bootstrap_servers(KAFKA_BROKERS) \
    #         .set_topics(topic) \
    #         .set_group_id(f"flink-delta-{topic.replace('.', '-')}") \
    #         .set_starting_offsets(KafkaOffsetsInitializer.latest()) \
    #         .set_value_only_deserializer(SimpleStringSchema()) \
    #         .build()
    #
    #     stream = env.from_source(source, WatermarkStrategy.no_watermarks(), topic)
    #     stream \
    #         .map(lambda msg: transform_event(topic, json.loads(msg))) \
    #         .filter(lambda r: r is not None) \
    #         .add_sink(DeltaSink.for_row_format(config["path"], config["schema"])
    #             .with_partition_columns(*config["partition_by"])
    #             .build())
    #
    # env.execute("TradeGateway Lakehouse Ingestion")

    logger.info("[lakehouse] Pipeline configuration complete")
    return {
        "status": "configured",
        "topics": list(TABLES.keys()),
        "tables": {k: v["path"] for k, v in TABLES.items()},
    }


if __name__ == "__main__":
    result = create_flink_pipeline()
    print(json.dumps(result, indent=2))
