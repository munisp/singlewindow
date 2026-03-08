"""
NGSWTP Python AI Service — FastAPI entry point
Aggregates: GNN training, FalkorDB/Neo4j seeding, CocoIndex, EPR-KGQA, ART, Ollama bridge
"""

from __future__ import annotations

import os
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Lazy-import AI modules (graceful degradation if deps missing) ──────────────

def _try_import(module_path: str, attr: str):
    try:
        import importlib
        mod = importlib.import_module(module_path)
        return getattr(mod, attr, None)
    except Exception as e:
        logger.warning(f"Could not import {module_path}.{attr}: {e}")
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("NGSWTP Python AI Service starting up...")
    yield
    logger.info("NGSWTP Python AI Service shutting down...")


app = FastAPI(
    title="NGSWTP Python AI Service",
    description="GNN training, knowledge graph seeding, CocoIndex, EPR-KGQA, ART reasoning, Ollama bridge",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ─────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ngswtp-python-ai",
        "modules": {
            "gnn_trainer": "available",
            "graph_schema": "available",
            "cocoindex": "available",
            "epr_kgqa": "available",
            "art_reasoning": "available",
            "ollama_bridge": "available",
        },
    }


# ── GNN Training ───────────────────────────────────────────────────────────────

class TrainRequest(BaseModel):
    epochs: int = 100
    learning_rate: float = 0.01
    hidden_channels: int = 64
    num_layers: int = 3


class TrainResponse(BaseModel):
    status: str
    final_loss: float
    accuracy: float
    model_path: str
    message: str


@app.post("/gnn/train", response_model=TrainResponse)
async def train_gnn(req: TrainRequest):
    """Train the GraphSAGE GNN model on historical declaration data."""
    try:
        from gnn.gnn_trainer import GNNTrainer
        trainer = GNNTrainer(
            hidden_channels=req.hidden_channels,
            num_layers=req.num_layers,
        )
        result = trainer.train(epochs=req.epochs, lr=req.learning_rate)
        return TrainResponse(
            status="success",
            final_loss=result.get("final_loss", 0.0),
            accuracy=result.get("accuracy", 0.0),
            model_path=result.get("model_path", "/app/models/gnn_model.pt"),
            message=f"Training complete after {req.epochs} epochs",
        )
    except Exception as e:
        logger.error(f"GNN training error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Graph Schema Seeding ───────────────────────────────────────────────────────

class SeedRequest(BaseModel):
    target: str = "both"  # "falkordb" | "neo4j" | "both"
    declarations_limit: int = 1000


class SeedResponse(BaseModel):
    status: str
    nodes_created: int
    relationships_created: int
    message: str


@app.post("/graph/seed", response_model=SeedResponse)
async def seed_graph(req: SeedRequest):
    """Seed FalkorDB and/or Neo4j with trade knowledge graph from PostgreSQL."""
    try:
        from gnn.graph_schema import TradeGraphSeeder
        seeder = TradeGraphSeeder()
        result = await seeder.seed(
            target=req.target,
            declarations_limit=req.declarations_limit,
        )
        return SeedResponse(
            status="success",
            nodes_created=result.get("nodes_created", 0),
            relationships_created=result.get("relationships_created", 0),
            message=f"Graph seeded successfully into {req.target}",
        )
    except Exception as e:
        logger.error(f"Graph seeding error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── CocoIndex Document Indexing ────────────────────────────────────────────────

class IndexRequest(BaseModel):
    document_type: str = "all"  # "declarations" | "hs_codes" | "permits" | "sanctions" | "all"
    force_reindex: bool = False


class IndexResponse(BaseModel):
    status: str
    documents_indexed: int
    index_name: str
    message: str


@app.post("/cocoindex/index", response_model=IndexResponse)
async def index_documents(req: IndexRequest):
    """Run CocoIndex pipeline to index trade documents."""
    try:
        from cocoindex.trade_index import TradeDocumentIndexer
        indexer = TradeDocumentIndexer()
        result = await indexer.index(
            document_type=req.document_type,
            force_reindex=req.force_reindex,
        )
        return IndexResponse(
            status="success",
            documents_indexed=result.get("documents_indexed", 0),
            index_name=result.get("index_name", "trade_documents"),
            message=f"Indexed {result.get('documents_indexed', 0)} documents",
        )
    except Exception as e:
        logger.error(f"CocoIndex error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class SearchRequest(BaseModel):
    query: str
    document_type: str = "all"
    top_k: int = 5


@app.post("/cocoindex/search")
async def search_documents(req: SearchRequest):
    """Semantic search across indexed trade documents."""
    try:
        from cocoindex.trade_index import TradeDocumentIndexer
        indexer = TradeDocumentIndexer()
        results = await indexer.search(
            query=req.query,
            document_type=req.document_type,
            top_k=req.top_k,
        )
        return {"status": "ok", "results": results}
    except Exception as e:
        logger.error(f"CocoIndex search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── EPR-KGQA Question Answering ────────────────────────────────────────────────

class KGQARequest(BaseModel):
    question: str
    graph_target: str = "falkordb"  # "falkordb" | "neo4j"
    max_results: int = 10


class KGQAResponse(BaseModel):
    status: str
    answer: str
    cypher_query: str
    raw_results: list[dict[str, Any]]
    intent: str
    confidence: float


@app.post("/kgqa/ask", response_model=KGQAResponse)
async def ask_knowledge_graph(req: KGQARequest):
    """Answer natural-language questions about the trade knowledge graph."""
    try:
        from kgqa.epr_kgqa import EPRKGQAService
        service = EPRKGQAService()
        result = await service.answer(
            question=req.question,
            graph_target=req.graph_target,
            max_results=req.max_results,
        )
        return KGQAResponse(
            status="success",
            answer=result.get("answer", ""),
            cypher_query=result.get("cypher_query", ""),
            raw_results=result.get("raw_results", []),
            intent=result.get("intent", "unknown"),
            confidence=result.get("confidence", 0.0),
        )
    except Exception as e:
        logger.error(f"KGQA error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── ART Reasoning ──────────────────────────────────────────────────────────────

class ARTRequest(BaseModel):
    query: str
    declaration_id: str | None = None
    trader_id: str | None = None
    max_iterations: int = 5


class ARTResponse(BaseModel):
    status: str
    reasoning_chain: list[dict[str, Any]]
    final_answer: str
    iterations: int
    evidence: list[dict[str, Any]]


@app.post("/art/reason", response_model=ARTResponse)
async def art_reason(req: ARTRequest):
    """Run ART adaptive retrieval-augmented thinking for complex trade queries."""
    try:
        from art.art_reasoning import ARTReasoningService
        service = ARTReasoningService()
        result = await service.reason(
            query=req.query,
            context={
                "declaration_id": req.declaration_id,
                "trader_id": req.trader_id,
            },
            max_iterations=req.max_iterations,
        )
        return ARTResponse(
            status="success",
            reasoning_chain=result.get("reasoning_chain", []),
            final_answer=result.get("final_answer", ""),
            iterations=result.get("iterations", 0),
            evidence=result.get("evidence", []),
        )
    except Exception as e:
        logger.error(f"ART reasoning error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Ollama Bridge ──────────────────────────────────────────────────────────────

class OllamaRequest(BaseModel):
    model: str = "qwen3:8b"
    prompt: str
    system: str | None = None
    temperature: float = 0.7
    max_tokens: int = 2048


@app.post("/ollama/generate")
async def ollama_generate(req: OllamaRequest):
    """Generate text using local Ollama LLM."""
    try:
        from llm.ollama_bridge import OllamaBridge
        bridge = OllamaBridge()
        result = await bridge.generate(
            model=req.model,
            prompt=req.prompt,
            system=req.system,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )
        return {"status": "ok", "response": result}
    except Exception as e:
        logger.error(f"Ollama bridge error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/ollama/models")
async def ollama_list_models():
    """List available Ollama models."""
    try:
        from llm.ollama_bridge import OllamaBridge
        bridge = OllamaBridge()
        models = await bridge.list_models()
        return {"status": "ok", "models": models}
    except Exception as e:
        logger.error(f"Ollama list models error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── GNN Batch Scoring ──────────────────────────────────────────────────────────

class BatchScoreRequest(BaseModel):
    declaration_ids: list[str] | None = None  # None = score all cleared
    limit: int = 500


class BatchScoreResult(BaseModel):
    declaration_id: str
    gnn_risk_score: float
    risk_lane: str
    graph_features: dict[str, Any]


class BatchScoreResponse(BaseModel):
    status: str
    scored: int
    results: list[BatchScoreResult]
    model_version: str


@app.post("/gnn/batch-score", response_model=BatchScoreResponse)
async def batch_score_declarations(req: BatchScoreRequest):
    """Score declarations using the trained GNN model."""
    try:
        from gnn.gnn_trainer import GNNTrainer
        trainer = GNNTrainer()
        results = await trainer.batch_score(
            declaration_ids=req.declaration_ids,
            limit=req.limit,
        )
        return BatchScoreResponse(
            status="success",
            scored=len(results),
            results=[
                BatchScoreResult(
                    declaration_id=r["declaration_id"],
                    gnn_risk_score=r["gnn_risk_score"],
                    risk_lane=r["risk_lane"],
                    graph_features=r.get("graph_features", {}),
                )
                for r in results
            ],
            model_version=results[0].get("model_version", "1.0.0") if results else "1.0.0",
        )
    except Exception as e:
        logger.error(f"GNN batch score error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Fraud Network ──────────────────────────────────────────────────────────────

@app.get("/graph/fraud-network")
async def get_fraud_network(limit: int = 200, min_risk: float = 0.4):
    """Return trader nodes and risk edges for D3 fraud network visualisation."""
    try:
        from gnn.graph_schema import TradeGraphSeeder
        seeder = TradeGraphSeeder()
        network = await seeder.get_fraud_network(limit=limit, min_risk=min_risk)
        return {"status": "ok", "network": network}
    except Exception as e:
        logger.error(f"Fraud network error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/graph/stats")
async def get_graph_stats():
    """Return node/edge counts and last sync timestamp."""
    try:
        from gnn.graph_schema import TradeGraphSeeder
        seeder = TradeGraphSeeder()
        stats = await seeder.get_stats()
        return {"status": "ok", "stats": stats}
    except Exception as e:
        logger.error(f"Graph stats error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
