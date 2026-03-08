"""
ollama_bridge.py — Ollama local LLM bridge for privacy-sensitive trade data.

Language choice: Python
  - Ollama Python client is Python-native
  - The bridge exposes a FastAPI HTTP server consumed by the Go microservice
  - Privacy-sensitive data (trader names, declaration values) never leaves
    the on-premise deployment when Ollama is used

What Ollama adds to TradeGateway:
  1. On-premise LLM inference — no data leaves the customs authority's network
  2. Model flexibility — swap between llama3.2, mistral, qwen2.5, codellama
  3. Structured output — JSON mode for risk factor extraction
  4. Streaming — real-time token streaming for the ART reasoning chain
  5. Embedding generation — local embeddings for CocoIndex (no external API)

Supported models:
  - llama3.2:3b — fast, good for classification and short explanations
  - llama3.2:8b — balanced, good for complex reasoning
  - qwen2.5:7b — multilingual (English/French/Arabic for West Africa)
  - mistral:7b — strong instruction following for compliance tasks
  - nomic-embed-text — local embeddings (replaces sentence-transformers)

API endpoints:
  POST /generate — single-turn generation
  POST /chat     — multi-turn conversation
  POST /embed    — text embeddings
  GET  /models   — list available models
  GET  /health   — health check
"""

from __future__ import annotations

import os
from typing import Any, AsyncGenerator

import structlog
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

log = structlog.get_logger(__name__)

# ─── CONFIGURATION ────────────────────────────────────────────────────────────

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
PORT = int(os.getenv("OLLAMA_BRIDGE_PORT", "8003"))

# ─── REQUEST/RESPONSE MODELS ─────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    prompt: str
    model: str = DEFAULT_MODEL
    system: str = ""
    temperature: float = 0.1
    max_tokens: int = 1024
    stream: bool = False
    format: str = ""  # "json" for structured output


class ChatMessage(BaseModel):
    role: str  # "system" | "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: str = DEFAULT_MODEL
    temperature: float = 0.1
    max_tokens: int = 1024
    stream: bool = False
    format: str = ""


class EmbedRequest(BaseModel):
    text: str | list[str]
    model: str = EMBED_MODEL


class GenerateResponse(BaseModel):
    text: str
    model: str
    tokens_used: int = 0
    done: bool = True


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    dimensions: int


# ─── OLLAMA CLIENT ────────────────────────────────────────────────────────────

class OllamaClient:
    """Thin wrapper around the Ollama Python client with error handling."""

    def __init__(self) -> None:
        self._client = None
        self._available = False
        self._connect()

    def _connect(self) -> None:
        try:
            import ollama
            self._client = ollama.Client(host=OLLAMA_HOST)
            # Verify connection
            models = self._client.list()
            available_models = [m.model for m in models.models]
            self._available = True
            log.info("Ollama connected", host=OLLAMA_HOST, models=available_models)
        except Exception as e:
            log.warning("Ollama not available", error=str(e), host=OLLAMA_HOST)

    def generate(self, req: GenerateRequest) -> GenerateResponse:
        if not self._available or not self._client:
            raise HTTPException(503, "Ollama service not available")

        try:
            import ollama
            messages = []
            if req.system:
                messages.append({"role": "system", "content": req.system})
            messages.append({"role": "user", "content": req.prompt})

            kwargs: dict[str, Any] = {
                "model": req.model,
                "messages": messages,
                "options": {
                    "temperature": req.temperature,
                    "num_predict": req.max_tokens,
                },
            }
            if req.format == "json":
                kwargs["format"] = "json"

            response = self._client.chat(**kwargs)
            return GenerateResponse(
                text=response.message.content,
                model=req.model,
                tokens_used=response.eval_count or 0,
                done=True,
            )
        except Exception as e:
            log.error("Ollama generate failed", error=str(e))
            raise HTTPException(500, f"Generation failed: {e}")

    async def stream_generate(self, req: GenerateRequest) -> AsyncGenerator[str, None]:
        if not self._available or not self._client:
            yield "data: {\"error\": \"Ollama not available\"}\n\n"
            return

        try:
            import ollama
            messages = []
            if req.system:
                messages.append({"role": "system", "content": req.system})
            messages.append({"role": "user", "content": req.prompt})

            stream = self._client.chat(
                model=req.model,
                messages=messages,
                stream=True,
                options={"temperature": req.temperature, "num_predict": req.max_tokens},
            )
            for chunk in stream:
                token = chunk.message.content
                if token:
                    import json
                    yield f"data: {json.dumps({'token': token, 'done': chunk.done})}\n\n"
        except Exception as e:
            import json
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    def embed(self, req: EmbedRequest) -> EmbedResponse:
        if not self._available or not self._client:
            raise HTTPException(503, "Ollama service not available")

        try:
            texts = req.text if isinstance(req.text, list) else [req.text]
            embeddings = []
            for text in texts:
                response = self._client.embeddings(model=req.model, prompt=text)
                embeddings.append(response.embedding)

            return EmbedResponse(
                embeddings=embeddings,
                model=req.model,
                dimensions=len(embeddings[0]) if embeddings else 0,
            )
        except Exception as e:
            log.error("Ollama embed failed", error=str(e))
            raise HTTPException(500, f"Embedding failed: {e}")

    def list_models(self) -> list[str]:
        if not self._available or not self._client:
            return []
        try:
            models = self._client.list()
            return [m.model for m in models.models]
        except Exception:
            return []

    @property
    def available(self) -> bool:
        return self._available


# ─── FASTAPI APP ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="TradeGateway Ollama Bridge",
    description="Privacy-preserving local LLM inference for trade compliance",
    version="1.0.0",
)

_client: OllamaClient | None = None


def get_client() -> OllamaClient:
    global _client
    if _client is None:
        _client = OllamaClient()
    return _client


@app.get("/health")
async def health() -> dict[str, Any]:
    client = get_client()
    return {
        "status": "ok" if client.available else "degraded",
        "ollama_available": client.available,
        "ollama_host": OLLAMA_HOST,
        "default_model": DEFAULT_MODEL,
        "available_models": client.list_models(),
    }


@app.get("/models")
async def list_models() -> dict[str, Any]:
    client = get_client()
    return {"models": client.list_models()}


@app.post("/generate")
async def generate(req: GenerateRequest) -> GenerateResponse | StreamingResponse:
    client = get_client()
    if req.stream:
        return StreamingResponse(
            client.stream_generate(req),
            media_type="text/event-stream",
        )
    return client.generate(req)


@app.post("/chat")
async def chat(req: ChatRequest) -> GenerateResponse:
    """Multi-turn chat endpoint."""
    client = get_client()
    # Convert to GenerateRequest format
    gen_req = GenerateRequest(
        prompt=req.messages[-1].content if req.messages else "",
        model=req.model,
        system=next((m.content for m in req.messages if m.role == "system"), ""),
        temperature=req.temperature,
        max_tokens=req.max_tokens,
        format=req.format,
    )
    return client.generate(gen_req)


@app.post("/embed")
async def embed(req: EmbedRequest) -> EmbedResponse:
    client = get_client()
    return client.embed(req)


@app.post("/explain-risk")
async def explain_risk(declaration: dict[str, Any]) -> dict[str, Any]:
    """
    Generate a natural language risk explanation for a declaration.
    Uses ART reasoning chain with Ollama as the LLM backend.
    """
    try:
        import sys
        sys.path.insert(0, "/home/ubuntu/tradegateway-ngswtp/services/python-ai")
        from art.art_reasoning import get_art_engine
        engine = get_art_engine()
        result = engine.explain_risk(declaration)
        return {
            "answer": result.answer,
            "confidence": result.confidence,
            "engine": result.reasoning_engine,
            "steps": len(result.steps),
            "sources": result.sources,
        }
    except Exception as e:
        log.error("Risk explanation failed", error=str(e))
        raise HTTPException(500, f"Risk explanation failed: {e}")


# ─── ENTRY POINT ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    log.info("Starting Ollama bridge", port=PORT)
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
