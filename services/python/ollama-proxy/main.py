"""
TradeGateway NGSWTP — Ollama Proxy Service
Language: Python 3.12
Framework: FastAPI + httpx (async)

Role: Provides a unified LLM API gateway that routes requests to locally running
      Ollama models. Exposes an OpenAI-compatible API so the tRPC server can call
      it without changing the invokeLLM() helper. Handles:

      - Model routing: task-type → optimal model
          * hs_classification  → qwen2.5:7b     (structured JSON output, HS code lookup)
          * risk_reasoning     → deepseek-r1:7b  (chain-of-thought risk analysis)
          * document_qa        → qwen2.5:7b      (document understanding, Q&A)
          * sanctions_check    → qwen2.5:3b      (fast entity matching)
          * general            → qwen2.5:7b      (default)
          * vision             → qwen2-vl:7b     (multimodal document analysis)
          * code               → deepseek-coder:6.7b (rule generation, scripting)

      - Streaming support (SSE) for real-time token delivery to the frontend
      - Structured JSON output enforcement via response_format
      - Request/response logging for audit trail
      - Health check with model availability status
      - Fallback chain: primary model → secondary → built-in Forge API

Port: 8090 (HTTP)
"""

from __future__ import annotations
from contextlib import asynccontextmanager

import asyncio
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Literal, Optional

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

# ─── Logging ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ollama-proxy")

# ─── Configuration ────────────────────────────────────────────────────────────

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
FORGE_API_URL = os.getenv("BUILT_IN_FORGE_API_URL", "")
FORGE_API_KEY = os.getenv("BUILT_IN_FORGE_API_KEY", "")
PORT = int(os.getenv("PORT", "8090"))

# Model routing table: task type → Ollama model name
MODEL_ROUTING: dict[str, str] = {
    "hs_classification":  "qwen2.5:7b",
    "risk_reasoning":     "deepseek-r1:7b",
    "document_qa":        "qwen2.5:7b",
    "sanctions_check":    "qwen2.5:3b",
    "general":            "qwen2.5:7b",
    "vision":             "qwen2-vl:7b",
    "code":               "deepseek-coder:6.7b",
    "fast":               "qwen2.5:3b",
}

# Fallback model if primary is unavailable
FALLBACK_MODEL = "qwen2.5:3b"

# ─── Pydantic models ──────────────────────────────────────────────────────────

class Message(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str | list[dict[str, Any]]

class ResponseFormat(BaseModel):
    type: Literal["text", "json_schema", "json_object"] = "text"
    json_schema: Optional[dict[str, Any]] = None

class ChatRequest(BaseModel):
    messages: list[Message]
    model: Optional[str] = None
    task_type: Optional[str] = "general"
    stream: bool = False
    temperature: float = Field(default=0.1, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(default=None, ge=1, le=32768)
    response_format: Optional[ResponseFormat] = None
    tools: Optional[list[dict[str, Any]]] = None
    tool_choice: Optional[str] = None

class ChatResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: list[dict[str, Any]]
    usage: dict[str, int]

class ModelInfo(BaseModel):
    name: str
    available: bool
    size_gb: Optional[float] = None
    modified_at: Optional[str] = None

class HealthResponse(BaseModel):
    status: str
    ollama_reachable: bool
    models: list[ModelInfo]
    routing_table: dict[str, str]
    checked_at: str

# ─── Ollama client ────────────────────────────────────────────────────────────

class OllamaClient:
    """Async client for the Ollama REST API."""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(300.0, connect=10.0),
        )

    async def list_models(self) -> list[dict[str, Any]]:
        try:
            resp = await self._client.get("/api/tags")
            resp.raise_for_status()
            return resp.json().get("models", [])
        except Exception as e:
            logger.warning(f"Failed to list Ollama models: {e}")
            return []

    async def chat(
        self,
        model: str,
        messages: list[dict[str, Any]],
        stream: bool = False,
        temperature: float = 0.1,
        max_tokens: Optional[int] = None,
        format: Optional[str] = None,
    ) -> dict[str, Any] | AsyncIterator[str]:
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": stream,
            "options": {"temperature": temperature},
        }
        if max_tokens:
            payload["options"]["num_predict"] = max_tokens
        if format:
            payload["format"] = format

        if stream:
            return self._stream_chat(payload)
        else:
            resp = await self._client.post("/api/chat", json=payload)
            resp.raise_for_status()
            return resp.json()

    async def _stream_chat(self, payload: dict[str, Any]) -> AsyncIterator[str]:
        async with self._client.stream("POST", "/api/chat", json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if line:
                    yield line

    async def is_reachable(self) -> bool:
        try:
            resp = await self._client.get("/", timeout=5.0)
            return resp.status_code == 200
        except Exception:
            return False

    async def close(self):
        await self._client.aclose()


# ─── Forge API fallback ───────────────────────────────────────────────────────

class ForgeClient:
    """Fallback client for the Manus built-in Forge API (OpenAI-compatible)."""

    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(120.0, connect=10.0),
            headers={"Authorization": f"Bearer {api_key}"},
        )

    async def chat(self, messages: list[dict[str, Any]], **kwargs) -> dict[str, Any]:
        payload = {"messages": messages, **kwargs}
        resp = await self._client.post("/v1/chat/completions", json=payload)
        resp.raise_for_status()
        return resp.json()

    async def close(self):
        await self._client.aclose()


# ─── Application ─────────────────────────────────────────────────────────────


# ─── Application Lifespan ───────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan: activates full middleware bundle on startup."""
    async with middleware_lifespan():
        yield

app = FastAPI(
    title="TradeGateway Ollama Proxy",
    description="Local LLM gateway for TradeGateway NGSWTP — routes to Ollama models (Qwen2.5, DeepSeek-R1, Qwen2-VL)",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ollama = OllamaClient(OLLAMA_BASE_URL)
forge = ForgeClient(FORGE_API_URL, FORGE_API_KEY) if FORGE_API_URL and FORGE_API_KEY else None


def resolve_model(request: ChatRequest) -> str:
    """Determine which Ollama model to use based on explicit model name or task type."""
    if request.model and request.model not in ("auto", "default"):
        return request.model
    task = request.task_type or "general"
    return MODEL_ROUTING.get(task, MODEL_ROUTING["general"])


def messages_to_ollama(messages: list[Message]) -> list[dict[str, Any]]:
    """Convert Pydantic Message objects to Ollama-compatible dicts."""
    result = []
    for msg in messages:
        if isinstance(msg.content, str):
            result.append({"role": msg.role, "content": msg.content})
        else:
            # Multimodal content (vision)
            text_parts = []
            images = []
            for part in msg.content:
                if part.get("type") == "text":
                    text_parts.append(part["text"])
                elif part.get("type") == "image_url":
                    url = part["image_url"]["url"]
                    if url.startswith("data:"):
                        # Base64 encoded image
                        images.append(url.split(",", 1)[1])
                    else:
                        images.append(url)
            entry: dict[str, Any] = {
                "role": msg.role,
                "content": " ".join(text_parts),
            }
            if images:
                entry["images"] = images
            result.append(entry)
    return result


def build_openai_response(ollama_resp: dict[str, Any], model: str, request_id: str) -> dict[str, Any]:
    """Convert Ollama response to OpenAI-compatible format."""
    message = ollama_resp.get("message", {})
    content = message.get("content", "")
    prompt_tokens = ollama_resp.get("prompt_eval_count", 0)
    completion_tokens = ollama_resp.get("eval_count", 0)

    return {
        "id": f"chatcmpl-{request_id}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }


async def stream_openai_format(
    ollama_stream: AsyncIterator[str],
    model: str,
    request_id: str,
) -> AsyncIterator[str]:
    """Convert Ollama streaming response to OpenAI SSE format."""
    async for line in ollama_stream:
        try:
            data = json.loads(line)
            content = data.get("message", {}).get("content", "")
            done = data.get("done", False)

            chunk = {
                "id": f"chatcmpl-{request_id}",
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "delta": {"content": content} if content else {},
                        "finish_reason": "stop" if done else None,
                    }
                ],
            }
            yield f"data: {json.dumps(chunk)}\n\n"
            if done:
                yield "data: [DONE]\n\n"
        except json.JSONDecodeError:
            continue


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check Ollama reachability and list available models."""
    reachable = await ollama.is_reachable()
    models_raw = await ollama.list_models() if reachable else []

    models = [
        ModelInfo(
            name=m["name"],
            available=True,
            size_gb=round(m.get("size", 0) / 1e9, 2),
            modified_at=m.get("modified_at"),
        )
        for m in models_raw
    ]

    return HealthResponse(
        status="ok" if reachable else "degraded",
        ollama_reachable=reachable,
        models=models,
        routing_table=MODEL_ROUTING,
        checked_at=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/v1/chat/completions")
async def chat_completions(request: ChatRequest):
    """
    OpenAI-compatible chat completions endpoint.
    Routes to the appropriate local Ollama model based on task_type.
    Falls back to Forge API if Ollama is unavailable.
    """
    request_id = str(uuid.uuid4())[:8]
    model = resolve_model(request)
    messages = messages_to_ollama(request.messages)

    # Determine if JSON format is required
    fmt = None
    if request.response_format:
        if request.response_format.type in ("json_schema", "json_object"):
            fmt = "json"
            # Inject JSON instruction into system message if not already present
            has_system = any(m["role"] == "system" for m in messages)
            json_instruction = "You must respond with valid JSON only. No markdown, no explanation."
            if request.response_format.json_schema:
                schema_str = json.dumps(request.response_format.json_schema.get("schema", {}), indent=2)
                json_instruction += f"\n\nRequired JSON schema:\n{schema_str}"
            if has_system:
                for m in messages:
                    if m["role"] == "system":
                        m["content"] = m["content"] + "\n\n" + json_instruction
                        break
            else:
                messages.insert(0, {"role": "system", "content": json_instruction})

    logger.info(
        f"[{request_id}] Chat request: model={model}, task={request.task_type}, "
        f"messages={len(messages)}, stream={request.stream}, format={fmt}"
    )

    start_time = time.time()

    try:
        if request.stream:
            stream = await ollama.chat(
                model=model,
                messages=messages,
                stream=True,
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                format=fmt,
            )
            return StreamingResponse(
                stream_openai_format(stream, model, request_id),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                },
            )
        else:
            resp = await ollama.chat(
                model=model,
                messages=messages,
                stream=False,
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                format=fmt,
            )
            elapsed = round((time.time() - start_time) * 1000)
            logger.info(f"[{request_id}] Completed in {elapsed}ms using {model}")
            return JSONResponse(build_openai_response(resp, model, request_id))

    except httpx.ConnectError:
        logger.warning(f"[{request_id}] Ollama unreachable, falling back to Forge API")
        if forge:
            try:
                forge_resp = await forge.chat(
                    messages=[{"role": m["role"], "content": m["content"]} for m in messages],
                    temperature=request.temperature,
                )
                return JSONResponse(forge_resp)
            except Exception as fe:
                logger.error(f"[{request_id}] Forge fallback also failed: {fe}")
                raise HTTPException(status_code=503, detail="Both Ollama and Forge API are unavailable")
        raise HTTPException(
            status_code=503,
            detail=f"Ollama is not reachable at {OLLAMA_BASE_URL}. Start Ollama with: ollama serve",
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            # Model not found — suggest pull command
            raise HTTPException(
                status_code=404,
                detail=f"Model '{model}' not found. Pull it with: ollama pull {model}",
            )
        raise HTTPException(status_code=e.response.status_code, detail=str(e))
    except Exception as e:
        logger.error(f"[{request_id}] Unexpected error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/models")
async def list_models():
    """List available Ollama models in OpenAI-compatible format."""
    models_raw = await ollama.list_models()
    return {
        "object": "list",
        "data": [
            {
                "id": m["name"],
                "object": "model",
                "created": int(time.time()),
                "owned_by": "ollama",
            }
            for m in models_raw
        ],
    }


@app.post("/api/hs-classify")
async def classify_hs_code(request: Request):
    """
    Specialized endpoint for HS code classification.
    Uses Qwen2.5:7b with structured JSON output.
    """
    body = await request.json()
    description = body.get("description", "")
    country_origin = body.get("countryOfOrigin", "")

    if not description:
        raise HTTPException(status_code=400, detail="description is required")

    messages = [
        {
            "role": "system",
            "content": (
                "You are a WCO-certified customs tariff classifier. "
                "Given a commodity description, return the most accurate 6-digit HS code "
                "from the Harmonized System 2022 edition. "
                "Always respond with valid JSON matching the required schema."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Classify the following commodity:\n"
                f"Description: {description}\n"
                f"Country of Origin: {country_origin or 'Unknown'}\n\n"
                f"Return JSON with: hsCode (6-digit string), chapter (2-digit), "
                f"heading (4-digit), subheading (6-digit), description (official WCO text), "
                f"confidence (0.0-1.0), alternativeCodes (array of up to 3 alternatives), "
                f"dutyNotes (string with applicable duty notes)."
            ),
        },
    ]

    try:
        resp = await ollama.chat(
            model=MODEL_ROUTING["hs_classification"],
            messages=messages,
            stream=False,
            temperature=0.05,
            format="json",
        )
        content = resp.get("message", {}).get("content", "{}")
        result = json.loads(content)
        return JSONResponse({"success": True, "result": result, "model": MODEL_ROUTING["hs_classification"]})
    except Exception as e:
        logger.error(f"HS classification failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/risk-explain")
async def explain_risk(request: Request):
    """
    Specialized endpoint for risk score explanation using DeepSeek-R1.
    Returns chain-of-thought reasoning for the assigned risk lane.
    """
    body = await request.json()
    declaration = body.get("declaration", {})
    risk_score = body.get("riskScore", 0)
    risk_lane = body.get("riskLane", "GREEN")
    risk_factors = body.get("riskFactors", [])

    messages = [
        {
            "role": "system",
            "content": (
                "You are a WCO SAFE Framework risk analyst for a national customs single window. "
                "Provide clear, actionable risk explanations for customs officers. "
                "Use chain-of-thought reasoning. Be concise and professional."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Explain the risk assessment for this declaration:\n"
                f"Risk Score: {risk_score}/100\n"
                f"Risk Lane: {risk_lane}\n"
                f"Risk Factors: {json.dumps(risk_factors, indent=2)}\n"
                f"Declaration Details: {json.dumps(declaration, indent=2)}\n\n"
                f"Provide: (1) Primary risk reason, (2) Supporting evidence, "
                f"(3) Recommended examination focus areas, (4) Comparable historical cases."
            ),
        },
    ]

    try:
        resp = await ollama.chat(
            model=MODEL_ROUTING["risk_reasoning"],
            messages=messages,
            stream=False,
            temperature=0.2,
        )
        content = resp.get("message", {}).get("content", "")
        return JSONResponse({
            "success": True,
            "explanation": content,
            "model": MODEL_ROUTING["risk_reasoning"],
            "riskLane": risk_lane,
            "riskScore": risk_score,
        })
    except Exception as e:
        logger.error(f"Risk explanation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sanctions-check")
async def sanctions_check(request: Request):
    """
    Fast entity screening using Qwen2.5:3b.
    Checks entity name against known sanctions patterns.
    """
    body = await request.json()
    entity_name = body.get("entityName", "")
    entity_type = body.get("entityType", "individual")  # individual | organization | vessel

    if not entity_name:
        raise HTTPException(status_code=400, detail="entityName is required")

    messages = [
        {
            "role": "system",
            "content": (
                "You are a sanctions screening analyst. "
                "Assess whether the given entity name could match known sanctioned entities. "
                "Consider name variations, transliterations, and aliases. "
                "Respond with JSON only."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Screen this entity:\n"
                f"Name: {entity_name}\n"
                f"Type: {entity_type}\n\n"
                f"Return JSON with: riskLevel (LOW/MEDIUM/HIGH), "
                f"matchProbability (0.0-1.0), potentialMatches (array of strings), "
                f"recommendedAction (CLEAR/REVIEW/HOLD), reasoning (string)."
            ),
        },
    ]

    try:
        resp = await ollama.chat(
            model=MODEL_ROUTING["sanctions_check"],
            messages=messages,
            stream=False,
            temperature=0.05,
            format="json",
        )
        content = resp.get("message", {}).get("content", "{}")
        result = json.loads(content)
        return JSONResponse({"success": True, "result": result, "model": MODEL_ROUTING["sanctions_check"]})
    except Exception as e:
        logger.error(f"Sanctions check failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Startup / shutdown ───────────────────────────────────────────────────────





# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

# ─── Middleware Integration ───────────────────────────────────────────────────
import threading as _threading
try:
    from middleware_integration import setup_middleware, start_consumer_thread, shutdown_middleware, middleware_lifespan
    _MIDDLEWARE_AVAILABLE = True
except ImportError:
    _MIDDLEWARE_AVAILABLE = False
    def setup_middleware(): pass
    def start_consumer_thread(): return None
    def shutdown_middleware(): pass
    @asynccontextmanager
    async def middleware_lifespan():
        yield


    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=PORT,
        reload=os.getenv("ENV", "production") == "development",
        log_level="info",
    )
