"""
opensearch-indexer — TradeGateway NGSWTP

Python service that consumes Kafka domain events and indexes them into OpenSearch.
Provides full-text search, analytics, and audit trail retrieval.

Why Python:
  - opensearch-py is the canonical Python client
  - Pandas for bulk data transformation
  - Rich ecosystem for data pipeline patterns

Indexed indices:
  - tradegateway-declarations   (declaration lifecycle events)
  - tradegateway-audit-log      (tamper-evident audit trail)
  - tradegateway-risk-events    (risk scoring history)
  - tradegateway-payments       (payment events)
  - tradegateway-cargo          (cargo tracking events)
"""

import asyncio
import json
import logging
import os
import signal
import time
from datetime import datetime, timezone
from typing import Any, Optional

import structlog
from confluent_kafka import Consumer, KafkaError, KafkaException
from opensearchpy import AsyncOpenSearch, OpenSearch, helpers

# ─── Logging ──────────────────────────────────────────────────────────────────

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)
logger = structlog.get_logger("opensearch-indexer")

# ─── Config ───────────────────────────────────────────────────────────────────

KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
KAFKA_GROUP_ID = os.getenv("KAFKA_GROUP_ID", "opensearch-indexer")
KAFKA_TOPICS = [
    "declaration-events",
    "risk-events",
    "payment-events",
    "cargo-events",
    "kyc-events",
    "audit-events",
]

OPENSEARCH_HOST = os.getenv("OPENSEARCH_HOST", "localhost")
OPENSEARCH_PORT = int(os.getenv("OPENSEARCH_PORT", "9200"))
OPENSEARCH_USER = os.getenv("OPENSEARCH_USER", "admin")
OPENSEARCH_PASS = os.getenv("OPENSEARCH_PASS", "admin")

BULK_BATCH_SIZE = int(os.getenv("BULK_BATCH_SIZE", "100"))
BULK_FLUSH_INTERVAL_SECONDS = float(os.getenv("BULK_FLUSH_INTERVAL_SECONDS", "5.0"))

# ─── Index mappings ───────────────────────────────────────────────────────────

INDEX_MAPPINGS = {
    "tradegateway-declarations": {
        "mappings": {
            "properties": {
                "declaration_id": {"type": "keyword"},
                "trader_id": {"type": "keyword"},
                "declaration_type": {"type": "keyword"},
                "status": {"type": "keyword"},
                "hs_codes": {"type": "keyword"},
                "country_of_origin": {"type": "keyword"},
                "country_of_destination": {"type": "keyword"},
                "total_value": {"type": "double"},
                "total_duty": {"type": "double"},
                "risk_score": {"type": "double"},
                "lane": {"type": "keyword"},
                "description": {"type": "text", "analyzer": "english"},
                "created_at": {"type": "date"},
                "updated_at": {"type": "date"},
                "event_type": {"type": "keyword"},
                "event_timestamp": {"type": "date"},
            }
        },
        "settings": {
            "number_of_shards": 3,
            "number_of_replicas": 1,
            "index.refresh_interval": "5s",
        },
    },
    "tradegateway-audit-log": {
        "mappings": {
            "properties": {
                "entity_id": {"type": "keyword"},
                "entity_type": {"type": "keyword"},
                "action": {"type": "keyword"},
                "actor_id": {"type": "keyword"},
                "actor_type": {"type": "keyword"},
                "actor_role": {"type": "keyword"},
                "ip_address": {"type": "ip"},
                "entry_hash": {"type": "keyword"},
                "prev_hash": {"type": "keyword"},
                "timestamp": {"type": "date"},
                "details": {"type": "object", "enabled": False},
            }
        },
        "settings": {
            "number_of_shards": 2,
            "number_of_replicas": 1,
            "index.refresh_interval": "10s",
        },
    },
    "tradegateway-risk-events": {
        "mappings": {
            "properties": {
                "declaration_id": {"type": "keyword"},
                "risk_score": {"type": "double"},
                "ml_score": {"type": "double"},
                "rule_score": {"type": "double"},
                "anomaly_score": {"type": "double"},
                "lane": {"type": "keyword"},
                "triggered_rules": {"type": "keyword"},
                "model_version": {"type": "integer"},
                "scored_at": {"type": "date"},
                "processing_ms": {"type": "double"},
            }
        },
        "settings": {"number_of_shards": 1, "number_of_replicas": 1},
    },
    "tradegateway-payments": {
        "mappings": {
            "properties": {
                "payment_id": {"type": "keyword"},
                "declaration_id": {"type": "keyword"},
                "trader_id": {"type": "keyword"},
                "amount": {"type": "double"},
                "currency": {"type": "keyword"},
                "status": {"type": "keyword"},
                "payment_method": {"type": "keyword"},
                "mojaloop_transfer_id": {"type": "keyword"},
                "created_at": {"type": "date"},
                "completed_at": {"type": "date"},
            }
        },
        "settings": {"number_of_shards": 2, "number_of_replicas": 1},
    },
    "tradegateway-cargo": {
        "mappings": {
            "properties": {
                "ucr": {"type": "keyword"},
                "declaration_id": {"type": "keyword"},
                "status": {"type": "keyword"},
                "location": {"type": "geo_point"},
                "vessel_name": {"type": "keyword"},
                "container_number": {"type": "keyword"},
                "port_of_loading": {"type": "keyword"},
                "port_of_discharge": {"type": "keyword"},
                "eta": {"type": "date"},
                "updated_at": {"type": "date"},
            }
        },
        "settings": {"number_of_shards": 1, "number_of_replicas": 1},
    },
}

# ─── OpenSearch client ────────────────────────────────────────────────────────


def create_opensearch_client() -> OpenSearch:
    return OpenSearch(
        hosts=[{"host": OPENSEARCH_HOST, "port": OPENSEARCH_PORT}],
        http_auth=(OPENSEARCH_USER, OPENSEARCH_PASS),
        use_ssl=OPENSEARCH_PORT == 443,
        verify_certs=False,
        ssl_show_warn=False,
        timeout=30,
        max_retries=3,
        retry_on_timeout=True,
    )


def ensure_indices(client: OpenSearch):
    """Create all required indices if they don't exist."""
    for index_name, config in INDEX_MAPPINGS.items():
        if not client.indices.exists(index=index_name):
            client.indices.create(index=index_name, body=config)
            logger.info("Created OpenSearch index", index=index_name)
        else:
            # Update mappings for existing indices (additive only)
            try:
                client.indices.put_mapping(
                    index=index_name,
                    body=config["mappings"],
                )
            except Exception:
                pass  # Mapping conflicts are non-fatal


# ─── Event routing ────────────────────────────────────────────────────────────

def route_event_to_index(event: dict) -> Optional[tuple[str, str, dict]]:
    """
    Route a Kafka event to the appropriate OpenSearch index.
    Returns (index_name, document_id, document) or None if unroutable.
    """
    event_type = event.get("event_type", "")
    entity_id = event.get("entity_id", "")
    payload = event.get("payload", {})
    timestamp = event.get("timestamp", datetime.now(timezone.utc).isoformat())

    if event_type in ("DECLARATION_SUBMITTED", "DECLARATION_APPROVED", "DECLARATION_REJECTED",
                       "DECLARATION_CLEARED", "DECLARATION_AMENDED"):
        doc = {
            "declaration_id": entity_id,
            "trader_id": event.get("actor_id", ""),
            "event_type": event_type,
            "status": payload.get("status", ""),
            "declaration_type": payload.get("declarationType", ""),
            "country_of_origin": payload.get("countryOfOrigin", ""),
            "total_value": payload.get("totalValue", 0),
            "total_duty": payload.get("totalDuty", 0),
            "hs_codes": payload.get("hsCodes", []),
            "event_timestamp": timestamp,
            "updated_at": timestamp,
        }
        doc_id = f"{entity_id}_{event_type}_{int(time.time() * 1000)}"
        return "tradegateway-declarations", doc_id, doc

    elif event_type == "RISK_SCORED":
        doc = {
            "declaration_id": entity_id,
            "risk_score": payload.get("risk_score", 0),
            "ml_score": payload.get("ml_score", 0),
            "rule_score": payload.get("rule_score", 0),
            "anomaly_score": payload.get("anomaly_score", 0),
            "lane": payload.get("lane", ""),
            "triggered_rules": payload.get("triggered_rules", []),
            "model_version": payload.get("model_version", 0),
            "scored_at": timestamp,
            "processing_ms": payload.get("processing_ms", 0),
        }
        doc_id = f"{entity_id}_risk_{int(time.time() * 1000)}"
        return "tradegateway-risk-events", doc_id, doc

    elif event_type in ("PAYMENT_INITIATED", "PAYMENT_COMPLETED", "PAYMENT_FAILED"):
        doc = {
            "payment_id": entity_id,
            "declaration_id": payload.get("declarationId", ""),
            "trader_id": payload.get("traderId", ""),
            "amount": payload.get("amount", 0),
            "currency": payload.get("currency", ""),
            "status": payload.get("status", ""),
            "payment_method": payload.get("paymentMethod", ""),
            "mojaloop_transfer_id": payload.get("mojaloopTransferId", ""),
            "created_at": timestamp,
            "completed_at": payload.get("completedAt", None),
        }
        doc_id = f"{entity_id}_{event_type}_{int(time.time() * 1000)}"
        return "tradegateway-payments", doc_id, doc

    elif event_type in ("CARGO_UPDATED", "CARGO_RELEASED", "CARGO_HELD"):
        doc = {
            "ucr": entity_id,
            "declaration_id": payload.get("declarationId", ""),
            "status": payload.get("status", ""),
            "vessel_name": payload.get("vesselName", ""),
            "container_number": payload.get("containerNumber", ""),
            "port_of_loading": payload.get("portOfLoading", ""),
            "port_of_discharge": payload.get("portOfDischarge", ""),
            "eta": payload.get("eta", None),
            "updated_at": timestamp,
        }
        if payload.get("latitude") and payload.get("longitude"):
            doc["location"] = {
                "lat": payload["latitude"],
                "lon": payload["longitude"],
            }
        doc_id = f"{entity_id}_{event_type}_{int(time.time() * 1000)}"
        return "tradegateway-cargo", doc_id, doc

    elif event_type == "AUDIT_LOG":
        doc = {
            "entity_id": entity_id,
            "entity_type": payload.get("entityType", ""),
            "action": payload.get("action", ""),
            "actor_id": payload.get("actorId", ""),
            "actor_type": payload.get("actorType", ""),
            "actor_role": payload.get("actorRole", ""),
            "ip_address": payload.get("ipAddress", None),
            "entry_hash": payload.get("entryHash", ""),
            "prev_hash": payload.get("prevHash", ""),
            "details": payload.get("details", {}),
            "timestamp": timestamp,
        }
        doc_id = f"{entity_id}_{payload.get('action', '')}_{int(time.time() * 1000)}"
        return "tradegateway-audit-log", doc_id, doc

    return None


# ─── Kafka consumer loop ──────────────────────────────────────────────────────

def run_indexer():
    """Main Kafka consumer loop with bulk indexing."""
    client = create_opensearch_client()

    # Wait for OpenSearch to be ready
    for attempt in range(30):
        try:
            client.ping()
            logger.info("OpenSearch connected")
            break
        except Exception:
            logger.info("Waiting for OpenSearch...", attempt=attempt + 1)
            time.sleep(2)
    else:
        logger.error("OpenSearch not reachable after 60s — exiting")
        return

    ensure_indices(client)

    consumer = Consumer({
        "bootstrap.servers": KAFKA_BROKERS,
        "group.id": KAFKA_GROUP_ID,
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
        "session.timeout.ms": 30000,
        "heartbeat.interval.ms": 10000,
    })
    consumer.subscribe(KAFKA_TOPICS)
    logger.info("Kafka consumer subscribed", topics=KAFKA_TOPICS)

    bulk_buffer: list[dict] = []
    last_flush = time.time()
    running = True

    def shutdown(sig, frame):
        nonlocal running
        logger.info("Shutdown signal received")
        running = False

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    def flush_buffer():
        nonlocal bulk_buffer
        if not bulk_buffer:
            return
        try:
            success, errors = helpers.bulk(client, bulk_buffer, raise_on_error=False)
            if errors:
                logger.warning("Bulk index errors", count=len(errors), errors=errors[:3])
            logger.info("Bulk indexed", count=success)
            bulk_buffer = []
        except Exception as e:
            logger.error("Bulk index failed", error=str(e))

    try:
        while running:
            msg = consumer.poll(timeout=1.0)

            if msg is None:
                # Flush on timeout if buffer has items
                if time.time() - last_flush > BULK_FLUSH_INTERVAL_SECONDS:
                    flush_buffer()
                    last_flush = time.time()
                continue

            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                logger.error("Kafka error", error=str(msg.error()))
                continue

            try:
                event = json.loads(msg.value().decode("utf-8"))
                routed = route_event_to_index(event)

                if routed:
                    index_name, doc_id, doc = routed
                    bulk_buffer.append({
                        "_index": index_name,
                        "_id": doc_id,
                        "_source": doc,
                    })

                consumer.commit(msg)

                # Flush if buffer is full or interval elapsed
                if (len(bulk_buffer) >= BULK_BATCH_SIZE or
                        time.time() - last_flush > BULK_FLUSH_INTERVAL_SECONDS):
                    flush_buffer()
                    last_flush = time.time()

            except json.JSONDecodeError as e:
                logger.warning("Invalid JSON in Kafka message", error=str(e))
            except Exception as e:
                logger.error("Event processing failed", error=str(e))

    finally:
        flush_buffer()
        consumer.close()
        logger.info("OpenSearch indexer stopped")


if __name__ == "__main__":
    run_indexer()
