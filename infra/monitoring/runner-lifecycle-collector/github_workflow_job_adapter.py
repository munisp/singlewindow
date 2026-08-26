#!/usr/bin/env python3
"""Forward signed GitHub workflow_job webhooks to the lifecycle collector.

The adapter is intentionally separate from the metrics collector. It verifies
GitHub signatures, persists delivery IDs for idempotency, and forwards only the
job lifecycle events needed by the collector.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib import request


LISTEN_HOST = os.getenv("LISTEN_HOST", "0.0.0.0")
LISTEN_PORT = int(os.getenv("LISTEN_PORT", "8089"))
COLLECTOR_URL = os.getenv("COLLECTOR_URL", "http://runner-lifecycle-collector:9090/v1/events")
COLLECTOR_TOKEN = os.getenv("COLLECTOR_TOKEN", "")
WEBHOOK_SECRET = os.getenv("GITHUB_WEBHOOK_SECRET", "")
DELIVERY_DB = os.getenv("DELIVERY_DB", "/var/lib/adapter/deliveries.sqlite3")


def _secret_from_env_or_file(value_name: str, file_name: str, value: str) -> str:
    path = os.getenv(file_name, "")
    if not path:
        return value
    try:
        with open(path, encoding="utf-8") as secret_stream:
            return secret_stream.read().strip()
    except OSError as exc:
        raise RuntimeError(f"{file_name} is configured but unreadable") from exc


COLLECTOR_TOKEN = _secret_from_env_or_file("COLLECTOR_TOKEN", "COLLECTOR_TOKEN_FILE", COLLECTOR_TOKEN)
WEBHOOK_SECRET = _secret_from_env_or_file("GITHUB_WEBHOOK_SECRET", "GITHUB_WEBHOOK_SECRET_FILE", WEBHOOK_SECRET)
MAX_BODY_BYTES = int(os.getenv("MAX_BODY_BYTES", "1048576"))
FORWARD_TIMEOUT_SECONDS = float(os.getenv("FORWARD_TIMEOUT_SECONDS", "10"))

_db_lock = threading.Lock()


def _init_db() -> None:
    parent = os.path.dirname(DELIVERY_DB)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with sqlite3.connect(DELIVERY_DB) as db:
        db.execute(
            """CREATE TABLE IF NOT EXISTS deliveries (
                delivery_id TEXT PRIMARY KEY,
                received_at REAL NOT NULL,
                status TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT
            )"""
        )
        db.commit()


def verify_signature(body: bytes, header: str | None, secret: str | None = None) -> bool:
    secret = WEBHOOK_SECRET if secret is None else secret
    if not secret or not header or not header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)


def _iso(value: Any, fallback: float | None = None) -> str | float:
    if value:
        return str(value)
    return fallback if fallback is not None else time.time()


def _label_group(labels: Any) -> str:
    values = {str(label) for label in labels or []}
    if "singlewindow-ci" in values:
        return "singlewindow-ci"
    if "docker" in values:
        return "docker"
    return "other"


def normalize_workflow_job(payload: dict[str, Any], delivery_id: str) -> dict[str, Any] | None:
    job = payload.get("workflow_job") or {}
    action = str(payload.get("action", ""))
    event_name = {"queued": "job_queued", "in_progress": "job_in_progress", "completed": "job_completed"}.get(action)
    if event_name is None:
        return None
    repository = ((payload.get("repository") or {}).get("full_name") or "unknown/unknown")
    labels = job.get("labels") or []
    return {
        "event": event_name,
        "delivery_id": delivery_id,
        "job_id": str(job.get("id", "")),
        "run_id": str(job.get("run_id", "")),
        "workflow": str(job.get("workflow_name") or "unknown"),
        "repository": repository,
        "runner_label_group": _label_group(labels),
        "pull_request": bool(payload.get("pull_request") or job.get("pull_requests")),
        "timestamp": _iso(job.get("completed_at") if action == "completed" else job.get("started_at") if action == "in_progress" else job.get("created_at")),
    }


def _delivery_state(delivery_id: str) -> str | None:
    with _db_lock, sqlite3.connect(DELIVERY_DB) as db:
        row = db.execute("SELECT status FROM deliveries WHERE delivery_id = ?", (delivery_id,)).fetchone()
        return row[0] if row else None


def _begin_delivery(delivery_id: str) -> None:
    with _db_lock, sqlite3.connect(DELIVERY_DB) as db:
        db.execute(
            """INSERT INTO deliveries(delivery_id, received_at, status, attempts)
               VALUES (?, ?, 'pending', 1)
               ON CONFLICT(delivery_id) DO UPDATE SET
                 attempts = attempts + 1, status = 'pending', last_error = NULL""",
            (delivery_id, time.time()),
        )
        db.commit()


def _finish_delivery(delivery_id: str, status: str, error: str | None = None) -> None:
    with _db_lock, sqlite3.connect(DELIVERY_DB) as db:
        db.execute("UPDATE deliveries SET status = ?, last_error = ? WHERE delivery_id = ?", (status, error, delivery_id))
        db.commit()


def forward_event(event: dict[str, Any]) -> None:
    body = json.dumps(event, separators=(",", ":")).encode()
    headers = {"Content-Type": "application/json", "User-Agent": "singlewindow-github-workflow-job-adapter/1.0"}
    if COLLECTOR_TOKEN:
        headers["Authorization"] = f"Bearer {COLLECTOR_TOKEN}"
    req = request.Request(COLLECTOR_URL, data=body, headers=headers, method="POST")
    with request.urlopen(req, timeout=FORWARD_TIMEOUT_SECONDS) as response:
        if response.status >= 300:
            raise RuntimeError(f"collector returned HTTP {response.status}")


class Handler(BaseHTTPRequestHandler):
    server_version = "singlewindow-github-workflow-job-adapter/1.0"

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self._json(200, {"status": "ok"})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/github/webhook":
            self._json(404, {"error": "not found"})
            return
        delivery_id = self.headers.get("X-GitHub-Delivery", "")
        event_name = self.headers.get("X-GitHub-Event", "")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                raise ValueError("invalid payload size")
            body = self.rfile.read(length)
            if event_name != "workflow_job":
                self._json(202, {"accepted": True, "ignored": True})
                return
            if not delivery_id or not verify_signature(body, self.headers.get("X-Hub-Signature-256")):
                self._json(401, {"error": "invalid signature"})
                return
            payload = json.loads(body)
            if not isinstance(payload, dict):
                raise ValueError("payload must be a JSON object")
            normalized = normalize_workflow_job(payload, delivery_id)
            if normalized is None:
                self._json(202, {"accepted": True, "ignored": True})
                return
            if _delivery_state(delivery_id) == "forwarded":
                self._json(202, {"accepted": True, "duplicate": True})
                return
            _begin_delivery(delivery_id)
            try:
                forward_event(normalized)
            except Exception as exc:  # noqa: BLE001
                _finish_delivery(delivery_id, "pending", str(exc)[:500])
                self._json(502, {"error": "collector forwarding failed", "delivery_id": delivery_id})
                return
            _finish_delivery(delivery_id, "forwarded")
            self._json(202, {"accepted": True, "event": normalized["event"]})
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self._json(400, {"error": str(exc)})

    def log_message(self, fmt: str, *args: Any) -> None:
        print(json.dumps({"event": "http_access", "message": fmt % args}), flush=True)


def main() -> None:
    if not WEBHOOK_SECRET:
        raise RuntimeError("GITHUB_WEBHOOK_SECRET must be configured")
    _init_db()
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(json.dumps({"event": "webhook_adapter_started", "host": LISTEN_HOST, "port": LISTEN_PORT}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
