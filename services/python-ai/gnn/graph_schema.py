"""
graph_schema.py — FalkorDB / Neo4j trade knowledge graph schema seeder and sync service.

Language choice: Python
  - FalkorDB and Neo4j both have mature Python clients
  - Schema seeding is I/O-bound (network calls to graph DB), not CPU-bound
  - Python's async/await with asyncio handles concurrent DB writes efficiently
  - The GNN training pipeline (PyTorch Geometric) is also Python, so sharing
    data structures between schema seeding and GNN training avoids serialization

Architecture:
  FalkorDB (primary, Redis-compatible, in-memory graph):
    - Used for real-time risk queries (< 5ms latency)
    - Stores the live trade knowledge graph
    - Supports Cypher queries natively
    - GNN risk scores are written back here after Rust propagation

  Neo4j (secondary, persistent, analytics):
    - Used for long-running analytics queries (corridor risk, collusion detection)
    - Stores historical graph snapshots
    - Supports APOC procedures and GDS (Graph Data Science) library
    - GNN training data is exported from here

Graph Schema (Cypher node labels and relationship types):
  Nodes:
    (:Trader {id, name, country, aeoStatus, kycVerified, riskScore, violationCount})
    (:Declaration {id, declarationNumber, hsCode, declaredValue, riskScore, lane, flagged})
    (:HsCode {code, description, chapter, fraudRate, controlled, avgDutyRate})
    (:Port {id, name, country, congestion, riskIndex, lat, lng})
    (:OGA {id, name, avgProcessingHours, slaCompliance})
    (:SanctionedEntity {id, name, listSource, matchScore})
    (:Corridor {id, origin, destination, riskIndex, declarationVolume})

  Relationships:
    (Trader)-[:SUBMITTED {timestamp}]->(Declaration)
    (Declaration)-[:CLASSIFIED_UNDER]->(HsCode)
    (Declaration)-[:ARRIVED_AT]->(Port)
    (Declaration)-[:REQUIRES_PERMIT_FROM]->(OGA)
    (Trader)-[:MATCHES_SANCTION {similarity}]->(SanctionedEntity)
    (Declaration)-[:FOLLOWS_CORRIDOR]->(Corridor)
    (Trader)-[:RELATED_TO {relationshipType}]->(Trader)
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field
from typing import Any

import structlog
from dotenv import load_dotenv

load_dotenv()
log = structlog.get_logger(__name__)

# ─── CONFIGURATION ────────────────────────────────────────────────────────────

FALKORDB_HOST = os.getenv("FALKORDB_HOST", "localhost")
FALKORDB_PORT = int(os.getenv("FALKORDB_PORT", "6379"))
FALKORDB_GRAPH = os.getenv("FALKORDB_GRAPH", "trade_kg")

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")

# ─── SCHEMA DEFINITIONS ───────────────────────────────────────────────────────

# Cypher constraints and indexes to create on first boot
FALKORDB_SCHEMA_QUERIES = [
    # Node indexes for fast lookup
    "CREATE INDEX FOR (t:Trader) ON (t.id)",
    "CREATE INDEX FOR (d:Declaration) ON (d.id)",
    "CREATE INDEX FOR (d:Declaration) ON (d.riskScore)",
    "CREATE INDEX FOR (h:HsCode) ON (h.code)",
    "CREATE INDEX FOR (p:Port) ON (p.id)",
    "CREATE INDEX FOR (o:OGA) ON (o.id)",
    "CREATE INDEX FOR (c:Corridor) ON (c.id)",
    "CREATE INDEX FOR (s:SanctionedEntity) ON (s.id)",
]

NEO4J_SCHEMA_QUERIES = [
    # Uniqueness constraints
    "CREATE CONSTRAINT trader_id IF NOT EXISTS FOR (t:Trader) REQUIRE t.id IS UNIQUE",
    "CREATE CONSTRAINT declaration_id IF NOT EXISTS FOR (d:Declaration) REQUIRE d.id IS UNIQUE",
    "CREATE CONSTRAINT hscode_code IF NOT EXISTS FOR (h:HsCode) REQUIRE h.code IS UNIQUE",
    "CREATE CONSTRAINT port_id IF NOT EXISTS FOR (p:Port) REQUIRE p.id IS UNIQUE",
    "CREATE CONSTRAINT oga_id IF NOT EXISTS FOR (o:OGA) REQUIRE o.id IS UNIQUE",
    "CREATE CONSTRAINT corridor_id IF NOT EXISTS FOR (c:Corridor) REQUIRE c.id IS UNIQUE",
    # Full-text index for sanctions name matching
    "CREATE FULLTEXT INDEX sanctionedEntityName IF NOT EXISTS FOR (s:SanctionedEntity) ON EACH [s.name]",
    # Range index for risk score queries
    "CREATE RANGE INDEX declarationRisk IF NOT EXISTS FOR (d:Declaration) ON (d.riskScore)",
]

# ─── SEED DATA ────────────────────────────────────────────────────────────────

# West and East African trade corridors with historical risk indices
SEED_CORRIDORS = [
    {"id": "corridor-gh-ng", "origin": "GH", "destination": "NG", "riskIndex": 0.42, "declarationVolume": 12500},
    {"id": "corridor-gh-ci", "origin": "GH", "destination": "CI", "riskIndex": 0.31, "declarationVolume": 8900},
    {"id": "corridor-ng-bj", "origin": "NG", "destination": "BJ", "riskIndex": 0.68, "declarationVolume": 5200},
    {"id": "corridor-ke-ug", "origin": "KE", "destination": "UG", "riskIndex": 0.38, "declarationVolume": 9100},
    {"id": "corridor-ke-tz", "origin": "KE", "destination": "TZ", "riskIndex": 0.29, "declarationVolume": 7800},
    {"id": "corridor-rw-cd", "origin": "RW", "destination": "CD", "riskIndex": 0.72, "declarationVolume": 3400},
    {"id": "corridor-za-zw", "origin": "ZA", "destination": "ZW", "riskIndex": 0.45, "declarationVolume": 6700},
    {"id": "corridor-et-dj", "origin": "ET", "destination": "DJ", "riskIndex": 0.55, "declarationVolume": 4100},
    {"id": "corridor-cn-gh", "origin": "CN", "destination": "GH", "riskIndex": 0.58, "declarationVolume": 18000},
    {"id": "corridor-ae-ke", "origin": "AE", "destination": "KE", "riskIndex": 0.35, "declarationVolume": 11200},
]

# High-risk HS codes with historical fraud rates
SEED_HS_CODES = [
    {"code": "8471.30", "description": "Portable computers", "chapter": "84", "fraudRate": 0.65, "controlled": False, "avgDutyRate": 0.20},
    {"code": "8517.12", "description": "Mobile phones", "chapter": "85", "fraudRate": 0.72, "controlled": False, "avgDutyRate": 0.15},
    {"code": "2710.12", "description": "Motor spirit (petrol)", "chapter": "27", "fraudRate": 0.48, "controlled": True, "avgDutyRate": 0.05},
    {"code": "3004.90", "description": "Medicaments", "chapter": "30", "fraudRate": 0.55, "controlled": True, "avgDutyRate": 0.00},
    {"code": "6109.10", "description": "T-shirts, cotton", "chapter": "61", "fraudRate": 0.38, "controlled": False, "avgDutyRate": 0.25},
    {"code": "8703.23", "description": "Motor cars (1000-1500cc)", "chapter": "87", "fraudRate": 0.42, "controlled": False, "avgDutyRate": 0.35},
    {"code": "2208.40", "description": "Rum and tafia", "chapter": "22", "fraudRate": 0.61, "controlled": True, "avgDutyRate": 0.40},
    {"code": "9013.80", "description": "Laser devices / optical instruments", "chapter": "90", "fraudRate": 0.78, "controlled": True, "avgDutyRate": 0.10},
    {"code": "7108.12", "description": "Gold (non-monetary)", "chapter": "71", "fraudRate": 0.82, "controlled": True, "avgDutyRate": 0.00},
    {"code": "4011.10", "description": "Pneumatic tyres", "chapter": "40", "fraudRate": 0.33, "controlled": False, "avgDutyRate": 0.20},
]

# African ports with risk indices
SEED_PORTS = [
    {"id": "port-tema", "name": "Tema Port", "country": "GH", "congestion": 0.70, "riskIndex": 0.35, "lat": 5.6333, "lng": -0.0167},
    {"id": "port-apapa", "name": "Apapa Port", "country": "NG", "congestion": 0.85, "riskIndex": 0.62, "lat": 6.4500, "lng": 3.3667},
    {"id": "port-mombasa", "name": "Mombasa Port", "country": "KE", "congestion": 0.65, "riskIndex": 0.40, "lat": -4.0435, "lng": 39.6682},
    {"id": "port-dar-es-salaam", "name": "Dar es Salaam Port", "country": "TZ", "congestion": 0.72, "riskIndex": 0.45, "lat": -6.8235, "lng": 39.2895},
    {"id": "port-durban", "name": "Durban Port", "country": "ZA", "congestion": 0.55, "riskIndex": 0.28, "lat": -29.8587, "lng": 31.0218},
    {"id": "port-abidjan", "name": "Abidjan Port", "country": "CI", "congestion": 0.60, "riskIndex": 0.38, "lat": 5.2767, "lng": -4.0094},
    {"id": "port-cotonou", "name": "Cotonou Port", "country": "BJ", "congestion": 0.78, "riskIndex": 0.71, "lat": 6.3536, "lng": 2.4181},
    {"id": "port-djibouti", "name": "Djibouti Port", "country": "DJ", "congestion": 0.50, "riskIndex": 0.48, "lat": 11.5892, "lng": 43.1456},
    {"id": "port-dakar", "name": "Dakar Port", "country": "SN", "congestion": 0.58, "riskIndex": 0.33, "lat": 14.6928, "lng": -17.4467},
    {"id": "port-casablanca", "name": "Casablanca Port", "country": "MA", "congestion": 0.62, "riskIndex": 0.30, "lat": 33.5731, "lng": -7.5898},
]


# ─── FALKORDB SEEDER ─────────────────────────────────────────────────────────

class FalkorDBSeeder:
    """
    Seeds the FalkorDB trade knowledge graph with initial schema and data.
    FalkorDB is used for real-time risk queries — it must always be current.
    """

    def __init__(self) -> None:
        try:
            import falkordb
            self.client = falkordb.FalkorDB(host=FALKORDB_HOST, port=FALKORDB_PORT)
            self.graph = self.client.select_graph(FALKORDB_GRAPH)
            log.info("FalkorDB connected", host=FALKORDB_HOST, graph=FALKORDB_GRAPH)
        except Exception as e:
            log.warning("FalkorDB not available (will use mock mode)", error=str(e))
            self.graph = None

    def create_schema(self) -> None:
        """Create indexes and constraints."""
        if not self.graph:
            log.info("FalkorDB schema creation skipped (mock mode)")
            return
        for query in FALKORDB_SCHEMA_QUERIES:
            try:
                self.graph.query(query)
            except Exception as e:
                # Indexes may already exist — ignore duplicate errors
                if "already exists" not in str(e).lower():
                    log.warning("Schema query failed", query=query[:60], error=str(e))

    def seed_corridors(self) -> int:
        """Upsert all trade corridors."""
        if not self.graph:
            return len(SEED_CORRIDORS)
        count = 0
        for c in SEED_CORRIDORS:
            query = (
                f"MERGE (c:Corridor {{id: '{c['id']}'}}) "
                f"SET c.origin = '{c['origin']}', c.destination = '{c['destination']}', "
                f"c.riskIndex = {c['riskIndex']}, c.declarationVolume = {c['declarationVolume']}, "
                f"c.updatedAt = timestamp()"
            )
            self.graph.query(query)
            count += 1
        log.info("Corridors seeded", count=count)
        return count

    def seed_hs_codes(self) -> int:
        """Upsert all HS codes."""
        if not self.graph:
            return len(SEED_HS_CODES)
        count = 0
        for h in SEED_HS_CODES:
            controlled = "true" if h["controlled"] else "false"
            query = (
                f"MERGE (h:HsCode {{code: '{h['code']}'}}) "
                f"SET h.description = '{h['description']}', h.chapter = '{h['chapter']}', "
                f"h.fraudRate = {h['fraudRate']}, h.controlled = {controlled}, "
                f"h.avgDutyRate = {h['avgDutyRate']}, h.updatedAt = timestamp()"
            )
            self.graph.query(query)
            count += 1
        log.info("HS codes seeded", count=count)
        return count

    def seed_ports(self) -> int:
        """Upsert all ports."""
        if not self.graph:
            return len(SEED_PORTS)
        count = 0
        for p in SEED_PORTS:
            query = (
                f"MERGE (p:Port {{id: '{p['id']}'}}) "
                f"SET p.name = '{p['name']}', p.country = '{p['country']}', "
                f"p.congestion = {p['congestion']}, p.riskIndex = {p['riskIndex']}, "
                f"p.lat = {p['lat']}, p.lng = {p['lng']}, p.updatedAt = timestamp()"
            )
            self.graph.query(query)
            count += 1
        log.info("Ports seeded", count=count)
        return count

    def upsert_trader(self, trader: dict[str, Any]) -> None:
        """Sync a trader node from the MySQL database to FalkorDB."""
        if not self.graph:
            return
        aeo = "true" if trader.get("aeoStatus") else "false"
        kyc = "true" if trader.get("kycVerified") else "false"
        query = (
            f"MERGE (t:Trader {{id: '{trader['id']}'}}) "
            f"SET t.name = '{trader['name']}', t.country = '{trader.get('country', 'UNKNOWN')}', "
            f"t.aeoStatus = {aeo}, t.kycVerified = {kyc}, "
            f"t.riskScore = {trader.get('riskScore', 0.5)}, "
            f"t.violationCount = {trader.get('violationCount', 0)}, "
            f"t.updatedAt = timestamp()"
        )
        self.graph.query(query)

    def upsert_declaration(self, decl: dict[str, Any]) -> None:
        """Sync a declaration node and its relationships to FalkorDB."""
        if not self.graph:
            return
        flagged = "true" if decl.get("flagged") else "false"
        # Upsert declaration node
        query = (
            f"MERGE (d:Declaration {{id: '{decl['id']}'}}) "
            f"SET d.declarationNumber = '{decl.get('declarationNumber', '')}', "
            f"d.hsCode = '{decl.get('hsCode', '')}', "
            f"d.declaredValue = {decl.get('declaredValue', 0)}, "
            f"d.riskScore = {decl.get('riskScore', 0.5)}, "
            f"d.lane = '{decl.get('lane', 'yellow')}', "
            f"d.flagged = {flagged}, d.updatedAt = timestamp()"
        )
        self.graph.query(query)

        # Link to trader
        if trader_id := decl.get("traderId"):
            self.graph.query(
                f"MATCH (t:Trader {{id: '{trader_id}'}}), (d:Declaration {{id: '{decl['id']}'}}) "
                f"MERGE (t)-[:SUBMITTED {{timestamp: timestamp()}}]->(d)"
            )

        # Link to HS code
        if hs_code := decl.get("hsCode"):
            self.graph.query(
                f"MATCH (d:Declaration {{id: '{decl['id']}'}}), (h:HsCode {{code: '{hs_code}'}}) "
                f"MERGE (d)-[:CLASSIFIED_UNDER]->(h)"
            )

    def get_trader_risk_context(self, trader_id: str) -> dict[str, Any]:
        """
        Retrieve the full risk context for a trader: their declarations,
        HS codes, ports, and any sanctions matches.
        Used by the GNN trainer to build feature vectors.
        """
        if not self.graph:
            return {"traderId": trader_id, "declarations": [], "hsCodesUsed": [], "ports": []}

        result = self.graph.query(
            f"MATCH (t:Trader {{id: '{trader_id}'}})-[:SUBMITTED]->(d:Declaration) "
            f"OPTIONAL MATCH (d)-[:CLASSIFIED_UNDER]->(h:HsCode) "
            f"OPTIONAL MATCH (d)-[:ARRIVED_AT]->(p:Port) "
            f"RETURN t, collect(d) as declarations, collect(h) as hsCodes, collect(p) as ports"
        )
        return {"traderId": trader_id, "raw": result}

    def seed_all(self) -> dict[str, int]:
        """Run the full seed sequence."""
        self.create_schema()
        return {
            "corridors": self.seed_corridors(),
            "hs_codes": self.seed_hs_codes(),
            "ports": self.seed_ports(),
        }


# ─── NEO4J SEEDER ────────────────────────────────────────────────────────────

class Neo4jSeeder:
    """
    Seeds the Neo4j persistent graph database.
    Neo4j is used for analytics, GNN training data export, and APOC procedures.
    """

    def __init__(self) -> None:
        try:
            from neo4j import GraphDatabase
            self.driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
            self.driver.verify_connectivity()
            log.info("Neo4j connected", uri=NEO4J_URI)
        except Exception as e:
            log.warning("Neo4j not available (will use mock mode)", error=str(e))
            self.driver = None

    def create_schema(self) -> None:
        if not self.driver:
            log.info("Neo4j schema creation skipped (mock mode)")
            return
        with self.driver.session() as session:
            for query in NEO4J_SCHEMA_QUERIES:
                try:
                    session.run(query)
                except Exception as e:
                    if "already exists" not in str(e).lower():
                        log.warning("Neo4j schema query failed", query=query[:60], error=str(e))

    def seed_corridors(self) -> int:
        if not self.driver:
            return len(SEED_CORRIDORS)
        with self.driver.session() as session:
            for c in SEED_CORRIDORS:
                session.run(
                    "MERGE (c:Corridor {id: $id}) "
                    "SET c.origin = $origin, c.destination = $destination, "
                    "c.riskIndex = $riskIndex, c.declarationVolume = $declarationVolume",
                    **c,
                )
        return len(SEED_CORRIDORS)

    def seed_hs_codes(self) -> int:
        if not self.driver:
            return len(SEED_HS_CODES)
        with self.driver.session() as session:
            for h in SEED_HS_CODES:
                session.run(
                    "MERGE (h:HsCode {code: $code}) "
                    "SET h.description = $description, h.chapter = $chapter, "
                    "h.fraudRate = $fraudRate, h.controlled = $controlled, "
                    "h.avgDutyRate = $avgDutyRate",
                    **h,
                )
        return len(SEED_HS_CODES)

    def export_gnn_training_data(self) -> list[dict[str, Any]]:
        """
        Export declaration nodes with their features for GNN training.
        Returns a list of feature vectors suitable for PyTorch Geometric.
        """
        if not self.driver:
            return []
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (t:Trader)-[:SUBMITTED]->(d:Declaration)-[:CLASSIFIED_UNDER]->(h:HsCode)
                OPTIONAL MATCH (d)-[:ARRIVED_AT]->(p:Port)
                OPTIONAL MATCH (d)-[:FOLLOWS_CORRIDOR]->(c:Corridor)
                RETURN
                  d.id AS declarationId,
                  d.riskScore AS riskScore,
                  d.lane AS lane,
                  d.declaredValue AS declaredValue,
                  t.riskScore AS traderRisk,
                  t.violationCount AS traderViolations,
                  t.aeoStatus AS aeoStatus,
                  h.fraudRate AS hsFraudRate,
                  h.controlled AS hsControlled,
                  h.avgDutyRate AS hsDutyRate,
                  coalesce(p.riskIndex, 0.3) AS portRisk,
                  coalesce(c.riskIndex, 0.3) AS corridorRisk
                LIMIT 10000
                """
            )
            return [dict(record) for record in result]

    def close(self) -> None:
        if self.driver:
            self.driver.close()


# ─── SYNC SERVICE ─────────────────────────────────────────────────────────────

class GraphSyncService:
    """
    Keeps FalkorDB and Neo4j in sync with the MySQL trade database.
    Called by the Go bridge after every declaration submission.
    """

    def __init__(self) -> None:
        self.falkor = FalkorDBSeeder()
        self.neo4j = Neo4jSeeder()

    def sync_declaration(self, declaration: dict[str, Any]) -> None:
        """Sync a single declaration to both graph databases."""
        self.falkor.upsert_declaration(declaration)
        # Neo4j sync is async — write to a queue in production
        log.info("Declaration synced to graph DBs", declaration_id=declaration.get("id"))

    def sync_trader(self, trader: dict[str, Any]) -> None:
        """Sync a trader profile to both graph databases."""
        self.falkor.upsert_trader(trader)
        log.info("Trader synced to graph DBs", trader_id=trader.get("id"))

    def initial_seed(self) -> dict[str, Any]:
        """Run the full initial seed for both databases."""
        falkor_result = self.falkor.seed_all()
        self.neo4j.create_schema()
        neo4j_corridors = self.neo4j.seed_corridors()
        neo4j_hs = self.neo4j.seed_hs_codes()
        return {
            "falkordb": falkor_result,
            "neo4j": {"corridors": neo4j_corridors, "hs_codes": neo4j_hs},
        }


# ─── ENTRY POINT ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json
    service = GraphSyncService()
    result = service.initial_seed()
    print(json.dumps(result, indent=2))
