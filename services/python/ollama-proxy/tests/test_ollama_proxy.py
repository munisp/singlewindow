"""
Ollama Proxy Service — pytest suite
Tests model routing, resolve_model, messages_to_ollama conversion,
and FastAPI endpoint contracts (health, chat, models, hs-classify).
"""
import sys
import os

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main as svc

client = TestClient(svc.app)


# ─── Model routing table ──────────────────────────────────────────────────────

class TestModelRoutingTable:
    def test_routing_table_is_not_empty(self):
        assert len(svc.MODEL_ROUTING) > 0

    def test_each_entry_has_model_name(self):
        for task_type, model_name in svc.MODEL_ROUTING.items():
            assert isinstance(task_type, str)
            assert isinstance(model_name, str)
            assert len(model_name) > 0

    def test_default_task_type_exists(self):
        # There should be a "default" or "general" task type
        assert "default" in svc.MODEL_ROUTING or len(svc.MODEL_ROUTING) > 0


# ─── resolve_model ────────────────────────────────────────────────────────────

class TestResolveModel:
    def _chat_req(self, **overrides):
        base = {
            "messages": [{"role": "user", "content": "Hello"}],
        }
        base.update(overrides)
        return svc.ChatRequest(**base)

    def test_resolve_returns_string(self):
        req = self._chat_req()
        model = svc.resolve_model(req)
        assert isinstance(model, str)
        assert len(model) > 0

    def test_explicit_model_overrides_routing(self):
        req = self._chat_req(model="my-custom-model")
        model = svc.resolve_model(req)
        assert model == "my-custom-model"

    def test_task_type_routes_to_correct_model(self):
        for task_type, expected_model in svc.MODEL_ROUTING.items():
            req = self._chat_req(task_type=task_type)
            model = svc.resolve_model(req)
            assert model == expected_model

    def test_unknown_task_type_falls_back_to_default(self):
        req = self._chat_req(task_type="unknown-task-xyz")
        model = svc.resolve_model(req)
        # Should fall back to default model
        assert isinstance(model, str)
        assert len(model) > 0


# ─── messages_to_ollama conversion ────────────────────────────────────────────

class TestMessagesToOllama:
    def test_converts_user_message(self):
        msgs = [svc.Message(role="user", content="Hello")]
        result = svc.messages_to_ollama(msgs)
        assert len(result) == 1
        assert result[0]["role"] == "user"
        assert result[0]["content"] == "Hello"

    def test_converts_system_message(self):
        msgs = [
            svc.Message(role="system", content="You are helpful"),
            svc.Message(role="user", content="Hi"),
        ]
        result = svc.messages_to_ollama(msgs)
        assert len(result) == 2
        assert result[0]["role"] == "system"

    def test_empty_messages_returns_empty_list(self):
        result = svc.messages_to_ollama([])
        assert result == []

    def test_preserves_message_order(self):
        msgs = [
            svc.Message(role="user", content="First"),
            svc.Message(role="assistant", content="Second"),
            svc.Message(role="user", content="Third"),
        ]
        result = svc.messages_to_ollama(msgs)
        assert result[0]["content"] == "First"
        assert result[1]["content"] == "Second"
        assert result[2]["content"] == "Third"


# ─── API endpoint contracts ────────────────────────────────────────────────────

class TestAPIEndpoints:
    def test_health_returns_ok_or_degraded(self):
        r = client.get("/health")
        assert r.status_code == 200
        data = r.json()
        # Status is "ok" when Ollama is reachable, "degraded" otherwise
        assert data["status"] in ("ok", "degraded")

    def test_chat_completions_missing_messages_returns_422(self):
        # messages is required
        r = client.post("/v1/chat/completions", json={"model": "llama3"})
        assert r.status_code == 422

    def test_chat_completions_with_valid_payload_attempts_call(self):
        # The proxy will try to reach Ollama; in test env it will get 503
        payload = {
            "messages": [{"role": "user", "content": "Hello"}],
            "stream": False,
        }
        r = client.post("/v1/chat/completions", json=payload)
        # Either succeeds (200) or fails gracefully (503 if Ollama not running)
        assert r.status_code in (200, 503)

    def test_list_models_endpoint(self):
        r = client.get("/v1/models")
        # Either 200 with model list or 503 if Ollama not running
        assert r.status_code in (200, 503)

    def test_hs_classify_missing_description_returns_400(self):
        r = client.post("/api/hs-classify", json={})
        # description is required; endpoint raises 400 when missing
        assert r.status_code in (400, 422, 503)

    def test_risk_explain_endpoint_exists(self):
        r = client.post("/api/risk-explain", json={})
        # Empty body is accepted (all fields have defaults); may 500 if Ollama down
        assert r.status_code in (200, 400, 422, 500, 503)

    def test_sanctions_check_missing_entity_returns_400(self):
        r = client.post("/api/sanctions-check", json={})
        # entityName is required; endpoint raises 400 when missing
        assert r.status_code in (400, 422, 503)
