"""
pg_to_graph_seeder.py
─────────────────────
Pulls live data from the PostgreSQL (TiDB-compatible) database and seeds
FalkorDB and Neo4j with the full trade knowledge graph.

Node types:   Trader · Declaration · HSCode · Port · OGA · Corridor · Agent
Relationship: SUBMITTED · CONTAINS · ROUTED_THROUGH · PROCESSED_BY
              CLEARED_BY · SHARES_AGENT · SAME_CORRIDOR · FLAGGED_BY

Run:
    python -m gnn.pg_to_graph_seeder --db-url $DATABASE_URL
    python -m gnn.pg_to_graph_seeder --db-url $DATABASE_URL --neo4j-only
    python -m gnn.pg_to_graph_seeder --db-url $DATABASE_URL --falkordb-only
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import psycopg2
import psycopg2.extras

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


# ─── Data models ──────────────────────────────────────────────────────────────

@dataclass
class GraphNode:
    label: str
    id: str
    props: dict[str, Any] = field(default_factory=dict)


@dataclass
class GraphEdge:
    rel_type: str
    src_label: str
    src_id: str
    dst_label: str
    dst_id: str
    props: dict[str, Any] = field(default_factory=dict)


@dataclass
class TradeGraph:
    nodes: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)

    def add_node(self, label: str, id_: str, **props: Any) -> None:
        self.nodes.append(GraphNode(label=label, id=id_, props=props))

    def add_edge(
        self,
        rel_type: str,
        src_label: str,
        src_id: str,
        dst_label: str,
        dst_id: str,
        **props: Any,
    ) -> None:
        self.edges.append(
            GraphEdge(
                rel_type=rel_type,
                src_label=src_label,
                src_id=src_id,
                dst_label=dst_label,
                dst_id=dst_id,
                props=props,
            )
        )


# ─── PostgreSQL extraction ─────────────────────────────────────────────────────

def extract_from_postgres(db_url: str) -> TradeGraph:
    """Pull all relevant rows from PostgreSQL and build a TradeGraph."""
    graph = TradeGraph()

    logger.info("Connecting to PostgreSQL …")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # ── Traders (from stakeholder_profiles) ──────────────────────────────────
    logger.info("Extracting traders …")
    cur.execute("""
        SELECT
            sp.id,
            sp.user_id,
            sp.company_name,
            sp.tin_number,
            sp.aeo_status,
            sp.risk_score,
            sp.country,
            sp.trader_type,
            u.email
        FROM stakeholder_profiles sp
        LEFT JOIN users u ON u.id = sp.user_id
    """)
    traders = cur.fetchall()
    for t in traders:
        graph.add_node(
            "Trader",
            str(t["id"]),
            user_id=str(t["user_id"]) if t["user_id"] else None,
            company_name=t["company_name"] or "",
            tin_number=t["tin_number"] or "",
            aeo_status=t["aeo_status"] or "none",
            risk_score=float(t["risk_score"] or 0.0),
            country=t["country"] or "GH",
            trader_type=t["trader_type"] or "importer",
            email=t["email"] or "",
        )
    logger.info("  → %d traders", len(traders))

    # ── Declarations ─────────────────────────────────────────────────────────
    logger.info("Extracting declarations …")
    cur.execute("""
        SELECT
            d.id,
            d.declaration_number,
            d.trader_id,
            d.declaration_type,
            d.status,
            d.risk_lane,
            d.risk_score,
            d.declared_value,
            d.currency,
            d.origin_country,
            d.destination_country,
            d.port_of_entry,
            d.hs_code,
            d.goods_description,
            d.weight_kg,
            d.created_at
        FROM declarations d
        ORDER BY d.created_at DESC
        LIMIT 50000
    """)
    declarations = cur.fetchall()
    seen_hs: set[str] = set()
    seen_ports: set[str] = set()
    seen_corridors: set[str] = set()

    for d in declarations:
        graph.add_node(
            "Declaration",
            str(d["id"]),
            declaration_number=d["declaration_number"] or "",
            declaration_type=d["declaration_type"] or "import",
            status=d["status"] or "pending",
            risk_lane=d["risk_lane"] or "green",
            risk_score=float(d["risk_score"] or 0.0),
            declared_value=float(d["declared_value"] or 0.0),
            currency=d["currency"] or "USD",
            origin_country=d["origin_country"] or "",
            destination_country=d["destination_country"] or "",
            weight_kg=float(d["weight_kg"] or 0.0),
            created_at=d["created_at"].isoformat() if d["created_at"] else "",
        )

        # Trader → SUBMITTED → Declaration
        if d["trader_id"]:
            graph.add_edge(
                "SUBMITTED",
                "Trader", str(d["trader_id"]),
                "Declaration", str(d["id"]),
                risk_score=float(d["risk_score"] or 0.0),
                risk_lane=d["risk_lane"] or "green",
            )

        # HS Code node
        hs = (d["hs_code"] or "").strip()
        if hs and hs not in seen_hs:
            seen_hs.add(hs)
            graph.add_node(
                "HSCode",
                hs,
                code=hs,
                description=d["goods_description"] or "",
                chapter=hs[:2] if len(hs) >= 2 else hs,
            )
        if hs:
            graph.add_edge(
                "CONTAINS",
                "Declaration", str(d["id"]),
                "HSCode", hs,
                declared_value=float(d["declared_value"] or 0.0),
            )

        # Port node
        port = (d["port_of_entry"] or "").strip()
        if port and port not in seen_ports:
            seen_ports.add(port)
            graph.add_node("Port", port, name=port, country=d["destination_country"] or "GH")
        if port:
            graph.add_edge(
                "ROUTED_THROUGH",
                "Declaration", str(d["id"]),
                "Port", port,
            )

        # Corridor node (origin → destination)
        origin = (d["origin_country"] or "").strip()
        dest = (d["destination_country"] or "").strip()
        if origin and dest:
            corridor_id = f"{origin}-{dest}"
            if corridor_id not in seen_corridors:
                seen_corridors.add(corridor_id)
                graph.add_node(
                    "Corridor",
                    corridor_id,
                    origin=origin,
                    destination=dest,
                    label=corridor_id,
                )
            graph.add_edge(
                "SAME_CORRIDOR",
                "Declaration", str(d["id"]),
                "Corridor", corridor_id,
            )

    logger.info("  → %d declarations, %d HS codes, %d ports, %d corridors",
                len(declarations), len(seen_hs), len(seen_ports), len(seen_corridors))

    # ── OGA Assignments ───────────────────────────────────────────────────────
    logger.info("Extracting OGA assignments …")
    cur.execute("""
        SELECT
            oa.id,
            oa.declaration_id,
            oa.oga_code,
            oa.oga_name,
            oa.status,
            oa.response_time_hours
        FROM oga_assignments oa
        LIMIT 100000
    """)
    oga_rows = cur.fetchall()
    seen_ogas: set[str] = set()
    for row in oga_rows:
        oga_id = row["oga_code"] or str(row["id"])
        if oga_id not in seen_ogas:
            seen_ogas.add(oga_id)
            graph.add_node(
                "OGA",
                oga_id,
                code=row["oga_code"] or "",
                name=row["oga_name"] or "",
            )
        graph.add_edge(
            "PROCESSED_BY",
            "Declaration", str(row["declaration_id"]),
            "OGA", oga_id,
            status=row["status"] or "pending",
            response_time_hours=float(row["response_time_hours"] or 0.0),
        )
    logger.info("  → %d OGA assignment edges, %d unique OGAs", len(oga_rows), len(seen_ogas))

    # ── Shared-agent edges (traders using same clearing agent) ────────────────
    logger.info("Building shared-agent edges …")
    cur.execute("""
        SELECT
            d1.trader_id AS trader_a,
            d2.trader_id AS trader_b,
            d1.clearing_agent_id AS agent_id,
            COUNT(*) AS shared_count
        FROM declarations d1
        JOIN declarations d2
          ON d1.clearing_agent_id = d2.clearing_agent_id
         AND d1.trader_id < d2.trader_id
        WHERE d1.clearing_agent_id IS NOT NULL
        GROUP BY d1.trader_id, d2.trader_id, d1.clearing_agent_id
        HAVING COUNT(*) >= 2
        LIMIT 10000
    """)
    shared_agent_rows = cur.fetchall()
    for row in shared_agent_rows:
        graph.add_edge(
            "SHARES_AGENT",
            "Trader", str(row["trader_a"]),
            "Trader", str(row["trader_b"]),
            agent_id=str(row["agent_id"]),
            shared_count=int(row["shared_count"]),
        )
    logger.info("  → %d shared-agent edges", len(shared_agent_rows))

    # ── Post-clearance audit flags ────────────────────────────────────────────
    logger.info("Extracting audit flags …")
    cur.execute("""
        SELECT
            pca.id,
            pca.declaration_id,
            pca.audit_type,
            pca.risk_indicators,
            pca.status
        FROM post_clearance_audits pca
        LIMIT 10000
    """)
    audit_rows = cur.fetchall()
    for row in audit_rows:
        graph.add_node(
            "AuditFlag",
            str(row["id"]),
            audit_type=row["audit_type"] or "random",
            status=row["status"] or "open",
        )
        graph.add_edge(
            "FLAGGED_BY",
            "Declaration", str(row["declaration_id"]),
            "AuditFlag", str(row["id"]),
        )
    logger.info("  → %d audit flags", len(audit_rows))

    cur.close()
    conn.close()
    logger.info("Extraction complete: %d nodes, %d edges total",
                len(graph.nodes), len(graph.edges))
    return graph


# ─── FalkorDB writer ──────────────────────────────────────────────────────────

def seed_falkordb(graph: TradeGraph, host: str, port: int, graph_name: str = "trade_kg") -> None:
    """Write the TradeGraph into FalkorDB using the Redis protocol."""
    try:
        import redis
        from redis.commands.graph import Graph as FalkorGraph  # type: ignore
        from redis.commands.graph.node import Node
        from redis.commands.graph.edge import Edge
    except ImportError:
        logger.warning("redis-py not installed — skipping FalkorDB seed. Run: pip install redis")
        return

    logger.info("Connecting to FalkorDB at %s:%d …", host, port)
    r = redis.Redis(host=host, port=port, decode_responses=True)
    fg = FalkorGraph(graph_name, r)

    # Drop and recreate for a clean seed
    try:
        fg.delete()
        logger.info("Dropped existing graph '%s'", graph_name)
    except Exception:
        pass

    BATCH = 500
    node_map: dict[tuple[str, str], Node] = {}

    # ── Insert nodes in batches ───────────────────────────────────────────────
    logger.info("Inserting %d nodes into FalkorDB …", len(graph.nodes))
    for i in range(0, len(graph.nodes), BATCH):
        batch = graph.nodes[i : i + BATCH]
        nodes_to_create: list[Node] = []
        for gn in batch:
            n = Node(label=gn.label, properties={"_id": gn.id, **gn.props})
            node_map[(gn.label, gn.id)] = n
            nodes_to_create.append(n)
        fg.add_node(*nodes_to_create)
        fg.flush()
        if (i // BATCH) % 10 == 0:
            logger.info("  nodes: %d / %d", min(i + BATCH, len(graph.nodes)), len(graph.nodes))

    # ── Insert edges in batches ───────────────────────────────────────────────
    logger.info("Inserting %d edges into FalkorDB …", len(graph.edges))
    skipped = 0
    for i in range(0, len(graph.edges), BATCH):
        batch = graph.edges[i : i + BATCH]
        edges_to_create: list[Edge] = []
        for ge in batch:
            src = node_map.get((ge.src_label, ge.src_id))
            dst = node_map.get((ge.dst_label, ge.dst_id))
            if src is None or dst is None:
                skipped += 1
                continue
            e = Edge(src, ge.rel_type, dst, properties=ge.props)
            edges_to_create.append(e)
        if edges_to_create:
            fg.add_edge(*edges_to_create)
            fg.flush()
        if (i // BATCH) % 10 == 0:
            logger.info("  edges: %d / %d (skipped: %d)", min(i + BATCH, len(graph.edges)), len(graph.edges), skipped)

    logger.info("FalkorDB seed complete. Skipped %d edges with missing endpoints.", skipped)


# ─── Neo4j writer ─────────────────────────────────────────────────────────────

def seed_neo4j(graph: TradeGraph, url: str, user: str, password: str) -> None:
    """Write the TradeGraph into Neo4j using the official Python driver."""
    try:
        from neo4j import GraphDatabase  # type: ignore
    except ImportError:
        logger.warning("neo4j driver not installed — skipping Neo4j seed. Run: pip install neo4j")
        return

    logger.info("Connecting to Neo4j at %s …", url)
    driver = GraphDatabase.driver(url, auth=(user, password))

    BATCH = 500

    def _create_nodes(tx: Any, batch: list[GraphNode]) -> None:
        for gn in batch:
            props = {"_id": gn.id, **gn.props}
            tx.run(
                f"MERGE (n:{gn.label} {{_id: $id}}) SET n += $props",
                id=gn.id,
                props=props,
            )

    def _create_edges(tx: Any, batch: list[GraphEdge]) -> None:
        for ge in batch:
            tx.run(
                f"""
                MATCH (a:{ge.src_label} {{_id: $src_id}})
                MATCH (b:{ge.dst_label} {{_id: $dst_id}})
                MERGE (a)-[r:{ge.rel_type}]->(b)
                SET r += $props
                """,
                src_id=ge.src_id,
                dst_id=ge.dst_id,
                props=ge.props,
            )

    with driver.session() as session:
        # Create constraints for fast MERGE
        for label in ["Trader", "Declaration", "HSCode", "Port", "OGA", "Corridor", "AuditFlag"]:
            try:
                session.run(f"CREATE CONSTRAINT IF NOT EXISTS FOR (n:{label}) REQUIRE n._id IS UNIQUE")
            except Exception:
                pass

        logger.info("Inserting %d nodes into Neo4j …", len(graph.nodes))
        for i in range(0, len(graph.nodes), BATCH):
            batch = graph.nodes[i : i + BATCH]
            session.execute_write(_create_nodes, batch)
            if (i // BATCH) % 10 == 0:
                logger.info("  nodes: %d / %d", min(i + BATCH, len(graph.nodes)), len(graph.nodes))

        logger.info("Inserting %d edges into Neo4j …", len(graph.edges))
        for i in range(0, len(graph.edges), BATCH):
            batch = graph.edges[i : i + BATCH]
            session.execute_write(_create_edges, batch)
            if (i // BATCH) % 10 == 0:
                logger.info("  edges: %d / %d", min(i + BATCH, len(graph.edges)), len(graph.edges))

    driver.close()
    logger.info("Neo4j seed complete.")


# ─── Entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Seed FalkorDB and Neo4j from PostgreSQL")
    parser.add_argument("--db-url", default=os.getenv("DATABASE_URL"), help="PostgreSQL connection URL")
    parser.add_argument("--falkordb-host", default=os.getenv("FALKORDB_HOST", "localhost"))
    parser.add_argument("--falkordb-port", type=int, default=int(os.getenv("FALKORDB_PORT", "6379")))
    parser.add_argument("--neo4j-url", default=os.getenv("NEO4J_URL", "bolt://localhost:7687"))
    parser.add_argument("--neo4j-user", default=os.getenv("NEO4J_USER", "neo4j"))
    parser.add_argument("--neo4j-password", default=os.getenv("NEO4J_PASSWORD", "ngswtp_neo4j_2026"))
    parser.add_argument("--falkordb-only", action="store_true")
    parser.add_argument("--neo4j-only", action="store_true")
    args = parser.parse_args()

    if not args.db_url:
        logger.error("DATABASE_URL is required. Pass --db-url or set the DATABASE_URL env var.")
        sys.exit(1)

    graph = extract_from_postgres(args.db_url)

    if not args.neo4j_only:
        seed_falkordb(graph, args.falkordb_host, args.falkordb_port)

    if not args.falkordb_only:
        seed_neo4j(graph, args.neo4j_url, args.neo4j_user, args.neo4j_password)

    logger.info("All done. Graph seeding complete.")


if __name__ == "__main__":
    main()
