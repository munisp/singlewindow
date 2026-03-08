"""
epr_kgqa.py — EPR-KGQA (Entity-Predicate-Relation Knowledge Graph QA) service.

Language choice: Python
  - EPR-KGQA is a research framework (EMNLP 2021) implemented in Python
  - Sentence-transformers and BERT are Python-native
  - The SPARQL/Cypher query generation is tightly coupled to the Python
    graph client (FalkorDB / Neo4j)

What EPR-KGQA adds to TradeGateway:
  1. Natural language queries over the trade knowledge graph
     e.g., "Which traders submitted high-risk declarations for HS 8517.12 in Q1 2026?"
  2. Entity linking — maps free-text mentions to graph nodes
     e.g., "Tema port" → Port:port-tema
  3. Relation extraction — identifies the predicate between entities
     e.g., "submitted" → SUBMITTED relationship
  4. Cypher generation — converts NL question to executable Cypher query
  5. Answer extraction — formats graph query results as natural language

Architecture (EPR pipeline):
  Question → Entity Detection → Entity Linking (FalkorDB lookup)
           → Predicate Detection (sentence-transformer similarity)
           → Cypher Generation (template + linked entities)
           → Graph Execution (FalkorDB / Neo4j)
           → Answer Formatting (LLM or template)

EPR = Entity-Predicate-Relation:
  - Entity: the subject/object in the question (trader, HS code, port, OGA)
  - Predicate: the relationship type (SUBMITTED, CLASSIFIED_UNDER, ARRIVED_AT)
  - Relation: the direction and cardinality (one-to-many, many-to-many)
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any

import structlog

log = structlog.get_logger(__name__)

# ─── CONFIGURATION ────────────────────────────────────────────────────────────

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
FALKORDB_HOST = os.getenv("FALKORDB_HOST", "localhost")
FALKORDB_PORT = int(os.getenv("FALKORDB_PORT", "6379"))
FALKORDB_GRAPH = os.getenv("FALKORDB_GRAPH", "trade_kg")

# ─── PREDICATE CATALOGUE ─────────────────────────────────────────────────────
# Maps natural language phrases to Cypher relationship types

PREDICATE_CATALOGUE = {
    "SUBMITTED": [
        "submitted", "filed", "declared", "lodged", "registered",
        "created declaration", "made declaration",
    ],
    "CLASSIFIED_UNDER": [
        "classified under", "hs code", "tariff code", "commodity code",
        "chapter", "heading",
    ],
    "ARRIVED_AT": [
        "arrived at", "port of entry", "port of discharge", "landed at",
        "cleared through", "entered via",
    ],
    "REQUIRES_PERMIT_FROM": [
        "requires permit", "needs approval", "regulated by", "controlled by",
        "licensed by", "approved by",
    ],
    "MATCHES_SANCTION": [
        "sanctioned", "blacklisted", "restricted", "embargoed",
        "on sanctions list", "OFAC", "UN sanctions",
    ],
    "FOLLOWS_CORRIDOR": [
        "corridor", "trade route", "origin destination", "from to",
        "transit through",
    ],
}

# ─── ENTITY TYPES ────────────────────────────────────────────────────────────

ENTITY_PATTERNS = {
    "HsCode": re.compile(r"\b(\d{4}[\.\s]?\d{2,6})\b"),
    "Port": re.compile(
        r"\b(tema|apapa|mombasa|dar es salaam|durban|abidjan|cotonou|"
        r"djibouti|dakar|casablanca|lagos|accra)\b",
        re.IGNORECASE,
    ),
    "Country": re.compile(
        r"\b(ghana|nigeria|kenya|tanzania|rwanda|south africa|ivory coast|"
        r"benin|ethiopia|djibouti|senegal|morocco|china|uae|GH|NG|KE|TZ|RW|ZA|CI|BJ|ET|DJ|SN|MA|CN|AE)\b",
        re.IGNORECASE,
    ),
    "RiskLane": re.compile(r"\b(green|yellow|red)\s*lane\b", re.IGNORECASE),
    "TimeRange": re.compile(
        r"\b(Q[1-4]\s*\d{4}|last\s+\d+\s+days?|this\s+month|this\s+year|yesterday|today)\b",
        re.IGNORECASE,
    ),
}

# ─── CYPHER TEMPLATES ────────────────────────────────────────────────────────

CYPHER_TEMPLATES = {
    "trader_by_hs_code": (
        "MATCH (t:Trader)-[:SUBMITTED]->(d:Declaration)-[:CLASSIFIED_UNDER]->(h:HsCode {{code: '{hs_code}'}}) "
        "WHERE d.riskScore > {min_risk} "
        "RETURN t.id, t.name, count(d) AS declarationCount, avg(d.riskScore) AS avgRisk "
        "ORDER BY avgRisk DESC LIMIT 20"
    ),
    "declarations_by_port": (
        "MATCH (d:Declaration)-[:ARRIVED_AT]->(p:Port) "
        "WHERE toLower(p.name) CONTAINS '{port_name}' "
        "RETURN d.id, d.declarationNumber, d.riskScore, d.lane, p.name "
        "ORDER BY d.riskScore DESC LIMIT 20"
    ),
    "high_risk_corridors": (
        "MATCH (d:Declaration)-[:FOLLOWS_CORRIDOR]->(c:Corridor) "
        "WHERE c.riskIndex > {min_risk} "
        "RETURN c.origin, c.destination, c.riskIndex, count(d) AS declarationCount "
        "ORDER BY c.riskIndex DESC LIMIT 10"
    ),
    "oga_backlog": (
        "MATCH (d:Declaration)-[:REQUIRES_PERMIT_FROM]->(o:OGA) "
        "WHERE d.lane IN ['yellow', 'red'] "
        "RETURN o.id, o.name, count(d) AS pendingDeclarations, "
        "avg(o.avgProcessingHours) AS avgHours "
        "ORDER BY pendingDeclarations DESC LIMIT 10"
    ),
    "sanctions_matches": (
        "MATCH (t:Trader)-[r:MATCHES_SANCTION]->(s:SanctionedEntity) "
        "WHERE r.similarity > {min_similarity} "
        "RETURN t.id, t.name, s.name, s.listSource, r.similarity "
        "ORDER BY r.similarity DESC LIMIT 20"
    ),
    "trader_risk_profile": (
        "MATCH (t:Trader {{id: '{trader_id}'}})-[:SUBMITTED]->(d:Declaration) "
        "OPTIONAL MATCH (d)-[:CLASSIFIED_UNDER]->(h:HsCode) "
        "OPTIONAL MATCH (d)-[:ARRIVED_AT]->(p:Port) "
        "RETURN t, collect(DISTINCT h.code) AS hsCodes, "
        "collect(DISTINCT p.name) AS ports, "
        "count(d) AS totalDeclarations, "
        "avg(d.riskScore) AS avgRisk, "
        "sum(CASE WHEN d.lane = 'red' THEN 1 ELSE 0 END) AS redLaneCount"
    ),
}


# ─── EPR PIPELINE ────────────────────────────────────────────────────────────

@dataclass
class ParsedQuestion:
    """Result of the EPR parsing step."""
    original: str
    entities: dict[str, list[str]] = field(default_factory=dict)
    predicates: list[str] = field(default_factory=list)
    intent: str = "unknown"
    cypher: str = ""
    confidence: float = 0.0


class EPRKGQAService:
    """
    EPR-KGQA question answering service for the trade knowledge graph.

    The pipeline:
    1. Entity detection — regex + NER to find entities in the question
    2. Entity linking — map detected entities to graph node IDs
    3. Predicate detection — sentence-transformer similarity to PREDICATE_CATALOGUE
    4. Intent classification — determine the query type (trader lookup, risk analysis, etc.)
    5. Cypher generation — fill a template with linked entities
    6. Graph execution — run Cypher on FalkorDB
    7. Answer formatting — convert graph results to natural language
    """

    def __init__(self) -> None:
        self._encoder = None
        self._predicate_embeddings: dict[str, Any] = {}
        self._graph = None
        self._load_encoder()
        self._load_graph()

    def _load_encoder(self) -> None:
        try:
            from sentence_transformers import SentenceTransformer
            self._encoder = SentenceTransformer(EMBEDDING_MODEL)
            # Pre-compute predicate embeddings
            for pred, phrases in PREDICATE_CATALOGUE.items():
                embs = self._encoder.encode(phrases, normalize_embeddings=True)
                self._predicate_embeddings[pred] = embs
            log.info("EPR-KGQA encoder loaded")
        except ImportError:
            log.warning("sentence-transformers not installed — EPR-KGQA in regex-only mode")

    def _load_graph(self) -> None:
        try:
            import falkordb
            client = falkordb.FalkorDB(host=FALKORDB_HOST, port=FALKORDB_PORT)
            self._graph = client.select_graph(FALKORDB_GRAPH)
            log.info("EPR-KGQA graph connected")
        except Exception as e:
            log.warning("FalkorDB not available for EPR-KGQA", error=str(e))

    def detect_entities(self, question: str) -> dict[str, list[str]]:
        """Extract entity mentions from the question text."""
        entities: dict[str, list[str]] = {}
        for entity_type, pattern in ENTITY_PATTERNS.items():
            matches = pattern.findall(question)
            if matches:
                entities[entity_type] = list(set(matches))
        return entities

    def detect_predicates(self, question: str) -> list[str]:
        """
        Detect which relationship types the question is asking about.
        Uses sentence-transformer similarity if available, otherwise regex.
        """
        if self._encoder and self._predicate_embeddings:
            import numpy as np
            q_emb = self._encoder.encode([question], normalize_embeddings=True)[0]
            scores: dict[str, float] = {}
            for pred, embs in self._predicate_embeddings.items():
                sim = float(np.max(np.dot(embs, q_emb)))
                scores[pred] = sim
            # Return predicates with similarity > 0.3
            return [p for p, s in sorted(scores.items(), key=lambda x: -x[1]) if s > 0.3]
        else:
            # Regex fallback
            q_lower = question.lower()
            detected = []
            for pred, phrases in PREDICATE_CATALOGUE.items():
                if any(phrase in q_lower for phrase in phrases):
                    detected.append(pred)
            return detected

    def classify_intent(self, question: str, entities: dict, predicates: list[str]) -> str:
        """Classify the question intent to select the right Cypher template."""
        q_lower = question.lower()

        if "hs" in q_lower or "HsCode" in entities:
            return "trader_by_hs_code"
        if "port" in q_lower or "Port" in entities:
            return "declarations_by_port"
        if "corridor" in q_lower or "route" in q_lower:
            return "high_risk_corridors"
        if "oga" in q_lower or "agency" in q_lower or "permit" in q_lower:
            return "oga_backlog"
        if "sanction" in q_lower or "blacklist" in q_lower:
            return "sanctions_matches"
        if "trader" in q_lower or "importer" in q_lower or "exporter" in q_lower:
            return "trader_risk_profile"

        return "high_risk_corridors"  # default

    def generate_cypher(self, intent: str, entities: dict, question: str) -> str:
        """Fill the Cypher template with linked entities."""
        template = CYPHER_TEMPLATES.get(intent, "")
        if not template:
            return ""

        params: dict[str, Any] = {
            "min_risk": 0.5,
            "min_similarity": 0.7,
            "hs_code": "",
            "port_name": "",
            "trader_id": "",
        }

        if hs_codes := entities.get("HsCode"):
            params["hs_code"] = hs_codes[0].replace(" ", ".")
        if ports := entities.get("Port"):
            params["port_name"] = ports[0].lower()
        if "RiskLane" in entities:
            lane = entities["RiskLane"][0].lower().replace(" lane", "")
            if lane == "red":
                params["min_risk"] = 0.65
            elif lane == "yellow":
                params["min_risk"] = 0.35

        try:
            return template.format(**params)
        except KeyError:
            return template

    def execute_cypher(self, cypher: str) -> list[dict[str, Any]]:
        """Execute the Cypher query on FalkorDB."""
        if not self._graph or not cypher:
            return []
        try:
            result = self._graph.query(cypher)
            return [dict(zip(result.header, row)) for row in result.result_set]
        except Exception as e:
            log.warning("Cypher execution failed", error=str(e), cypher=cypher[:100])
            return []

    def format_answer(self, intent: str, results: list[dict], question: str) -> str:
        """Convert graph query results to a natural language answer."""
        if not results:
            return "No matching records found in the trade knowledge graph."

        count = len(results)

        if intent == "trader_by_hs_code":
            top = results[0]
            return (
                f"Found {count} trader(s) with declarations for this HS code. "
                f"The highest-risk trader is '{top.get('t.name', 'Unknown')}' "
                f"with {top.get('declarationCount', 0)} declarations and an average "
                f"risk score of {top.get('avgRisk', 0):.2f}."
            )
        elif intent == "declarations_by_port":
            top = results[0]
            return (
                f"Found {count} declaration(s) at this port. "
                f"The highest-risk declaration is #{top.get('d.declarationNumber', 'N/A')} "
                f"with a risk score of {top.get('d.riskScore', 0):.2f} "
                f"(lane: {top.get('d.lane', 'unknown')})."
            )
        elif intent == "high_risk_corridors":
            top = results[0]
            return (
                f"Found {count} high-risk corridor(s). "
                f"The highest-risk corridor is {top.get('c.origin', '?')} → "
                f"{top.get('c.destination', '?')} with a risk index of "
                f"{top.get('c.riskIndex', 0):.2f} and "
                f"{top.get('declarationCount', 0)} declarations."
            )
        elif intent == "oga_backlog":
            top = results[0]
            return (
                f"Found {count} OGA(s) with pending declarations. "
                f"The most backlogged is '{top.get('o.name', 'Unknown')}' "
                f"with {top.get('pendingDeclarations', 0)} pending declarations "
                f"and an average processing time of {top.get('avgHours', 0):.1f} hours."
            )
        elif intent == "sanctions_matches":
            return (
                f"Found {count} potential sanctions match(es). "
                f"Review the results immediately and escalate to the compliance team."
            )
        else:
            return f"Found {count} result(s) matching your query."

    def answer(self, question: str) -> dict[str, Any]:
        """
        Full EPR-KGQA pipeline: question → natural language answer.
        """
        # Step 1: Entity detection
        entities = self.detect_entities(question)

        # Step 2: Predicate detection
        predicates = self.detect_predicates(question)

        # Step 3: Intent classification
        intent = self.classify_intent(question, entities, predicates)

        # Step 4: Cypher generation
        cypher = self.generate_cypher(intent, entities, question)

        # Step 5: Graph execution
        results = self.execute_cypher(cypher)

        # Step 6: Answer formatting
        answer_text = self.format_answer(intent, results, question)

        return {
            "question": question,
            "answer": answer_text,
            "intent": intent,
            "entities": entities,
            "predicates": predicates,
            "cypher": cypher,
            "result_count": len(results),
            "results": results[:5],  # Return top 5 results
        }


# ─── SINGLETON ───────────────────────────────────────────────────────────────

_kgqa_instance: EPRKGQAService | None = None


def get_kgqa_service() -> EPRKGQAService:
    global _kgqa_instance
    if _kgqa_instance is None:
        _kgqa_instance = EPRKGQAService()
    return _kgqa_instance


# ─── ENTRY POINT ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    service = get_kgqa_service()

    test_questions = [
        "Which traders submitted high-risk declarations for HS code 8517.12?",
        "How many declarations arrived at Tema port in the red lane?",
        "What are the highest-risk trade corridors from Nigeria?",
        "Which OGAs have the most backlogged declarations?",
        "Are there any traders matching the sanctions list?",
    ]

    for q in test_questions:
        result = service.answer(q)
        print(f"\nQ: {q}")
        print(f"A: {result['answer']}")
        print(f"   Intent: {result['intent']} | Entities: {result['entities']}")
        print(f"   Cypher: {result['cypher'][:80]}...")
