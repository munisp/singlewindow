#!/usr/bin/env python3
"""Small, dependency-light lifecycle metrics collector for SingleWindow CI.

The collector intentionally keeps only the short-lived state needed to derive
queue and lifecycle timings. Durable raw events should be retained by the
webhook receiver or log pipeline; Prometheus is not a durable event store.
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Gauge, Histogram, generate_latest


REGISTRY = CollectorRegistry()

QUEUE_WAIT = Histogram(
    "ci_job_queue_wait_seconds",
    "Time from GitHub job queued event to in-progress assignment.",
    ["repository", "workflow", "runner_label_group", "event"],
    buckets=(5, 15, 30, 60, 120, 300, 600, 1800, 3600),
    registry=REGISTRY,
)
PROVISION = Histogram(
    "runner_provision_seconds",
    "Time from runner provisioning request to runner online.",
    ["repository", "runner_mode", "image_version"],
    buckets=(5, 15, 30, 60, 90, 120, 300, 600),
    registry=REGISTRY,
)
HARNESS_STAGE = Histogram(
    "ci_postgres_harness_stage_seconds",
    "Duration of a PostgreSQL test-harness stage.",
    ["repository", "stage"],
    buckets=(1, 5, 15, 30, 60, 120, 300, 600),
    registry=REGISTRY,
)
REGISTRATION_FAILURES = Counter(
    "runner_registration_failure_total",
    "Runner registration failures.",
    ["repository", "failure_class"],
    registry=REGISTRY,
)
CLEANUP_FAILURES = Counter(
    "runner_cleanup_failure_total",
    "Runner cleanup failures.",
    ["repository", "failure_class"],
    registry=REGISTRY,
)
HARNESS_FAILURES = Counter(
    "ci_postgres_harness_setup_failures_total",
    "PostgreSQL harness setup failures.",
    ["repository", "stage"],
    registry=REGISTRY,
)
QUEUE_DEPTH = Gauge(
    "ci_queue_depth",
    "Current number of queued jobs observed by the collector.",
    ["repository", "runner_label_group"],
    registry=REGISTRY,
)
OLDEST_QUEUE_AGE = Gauge(
    "ci_oldest_queued_job_age_seconds",
    "Age of the oldest queued job observed by the collector.",
    ["repository", "runner_label_group"],
    registry=REGISTRY,
)
RUNNER_ONLINE = Gauge(
    "runner_online",
    "Whether an observed runner is online.",
    ["repository", "runner_label_group", "runner_mode"],
    registry=REGISTRY,
)
RUNNER_BUSY = Gauge(
    "runner_busy",
    "Whether an observed runner is busy.",
    ["repository", "runner_label_group", "runner_mode"],
    registry=REGISTRY,
)
WORKSPACE_AGE = Gauge(
    "runner_ephemeral_workspace_age_seconds",
    "Age of a live ephemeral workspace.",
    ["repository", "host", "compose_project"],
    registry=REGISTRY,
)
IMAGE_STALE = Gauge(
    "runner_image_stale",
    "Whether the runner image is outside the approved update window.",
    ["repository", "image_version"],
    registry=REGISTRY,
)
LAST_LOG = Gauge(
    "runner_last_log_timestamp_seconds",
    "Unix timestamp of the most recent durable runner lifecycle log.",
    ["repository"],
    registry=REGISTRY,
)
DRILL_DURATION = Histogram(
    "release_drill_duration_seconds",
    "Duration of a bounded staging release-drill scenario.",
    ["repository", "scenario_id", "result"],
    buckets=(5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600),
    registry=REGISTRY,
)
DRILL_RUNS = Counter(
    "release_drill_runs_total",
    "Completed staging release-drill scenarios.",
    ["repository", "scenario_id", "result"],
    registry=REGISTRY,
)
DRILL_ACTIVE = Gauge(
    "release_drill_active",
    "Whether a bounded staging release-drill scenario is active.",
    ["repository", "scenario_id"],
    registry=REGISTRY,
)
DRILL_LAST_COMPLETED = Gauge(
    "release_drill_last_completed_timestamp_seconds",
    "Unix timestamp of the most recent completed release-drill scenario.",
    ["repository", "scenario_id"],
    registry=REGISTRY,
)
DRILL_EVIDENCE = Gauge(
    "release_drill_evidence_present",
    "Whether a required bounded release-drill evidence class was recorded.",
    ["repository", "scenario_id", "evidence_class"],
    registry=REGISTRY,
)

MAX_BODY_BYTES = int(os.getenv("MAX_EVENT_BYTES", "65536"))
_token_file = os.getenv("LIFECYCLE_EVENT_TOKEN_FILE", "")
EVENT_TOKEN = os.getenv("LIFECYCLE_EVENT_TOKEN", "")
if _token_file:
    try:
        with open(_token_file, encoding="utf-8") as secret_stream:
            EVENT_TOKEN = secret_stream.read().strip()
    except OSError as exc:
        raise RuntimeError("LIFECYCLE_EVENT_TOKEN_FILE is configured but unreadable") from exc
MAX_TRACKED_JOBS = int(os.getenv("MAX_TRACKED_JOBS", "10000"))

_lock = threading.RLock()
_jobs: dict[str, dict[str, Any]] = {}
_workspaces: dict[str, tuple[str, str, float]] = {}
_runner_requests: dict[str, float] = {}
_drills: dict[str, tuple[str, str, float]] = {}


def _now(event: dict[str, Any]) -> float:
    value = event.get("timestamp") or event.get("ts")
    if value is None:
        return time.time()
    if isinstance(value, (int, float)):
        return float(value) / 1000 if float(value) > 10_000_000_000 else float(value)
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed.timestamp()


def _text(event: dict[str, Any], key: str, default: str = "unknown") -> str:
    value = event.get(key, default)
    return str(value)[:128] if value is not None else default


def _repo(event: dict[str, Any]) -> str:
    return _text(event, "repository", "munisp/singlewindow")


def _observe_queue_gauges(repository: str, group: str, now: float) -> None:
    pending = [job for job in _jobs.values() if job["repository"] == repository and job["group"] == group and job["state"] == "queued"]
    QUEUE_DEPTH.labels(repository, group).set(len(pending))
    OLDEST_QUEUE_AGE.labels(repository, group).set(max((now - job["queued_at"] for job in pending), default=0))


def handle_event(event: dict[str, Any]) -> None:
    kind = _text(event, "event", "")
    repository = _repo(event)
    now = _now(event)
    group = _text(event, "runner_label_group", "singlewindow-ci")

    with _lock:
        if kind == "job_queued":
            job_id = _text(event, "job_id", str(uuid.uuid4()))
            _jobs[job_id] = {"repository": repository, "group": group, "workflow": _text(event, "workflow"), "queued_at": now, "state": "queued"}
            if len(_jobs) > MAX_TRACKED_JOBS:
                oldest = next(iter(_jobs))
                del _jobs[oldest]
            _observe_queue_gauges(repository, group, time.time())
        elif kind == "job_in_progress":
            job_id = _text(event, "job_id", "")
            job = _jobs.get(job_id)
            if job:
                QUEUE_WAIT.labels(repository, job["workflow"], job["group"], "pull_request" if event.get("pull_request") else "all").observe(max(0, now - job["queued_at"]))
                job["state"] = "in_progress"
                job["started_at"] = now
                _observe_queue_gauges(repository, group, time.time())
        elif kind == "job_completed":
            job_id = _text(event, "job_id", "")
            job = _jobs.pop(job_id, None)
            if job and job["state"] == "queued":
                _observe_queue_gauges(repository, group, time.time())
        elif kind == "runner_requested":
            _runner_requests[_text(event, "runner_name")] = now
        elif kind == "runner_online":
            mode = _text(event, "runner_mode", "persistent")
            image = _text(event, "image_version")
            runner_name = _text(event, "runner_name")
            requested = _runner_requests.pop(runner_name, None)
            if requested is not None:
                PROVISION.labels(repository, mode, image).observe(max(0, now - requested))
            RUNNER_ONLINE.labels(repository, group, mode).set(1)
            RUNNER_BUSY.labels(repository, group, mode).set(0)
        elif kind in {"runner_offline", "runner_deregistered"}:
            RUNNER_ONLINE.labels(repository, group, _text(event, "runner_mode", "persistent")).set(0)
        elif kind == "runner_busy":
            RUNNER_BUSY.labels(repository, group, _text(event, "runner_mode", "persistent")).set(1 if event.get("busy", True) else 0)
        elif kind == "runner_registration_failed":
            REGISTRATION_FAILURES.labels(repository, _text(event, "failure_class")).inc()
        elif kind == "cleanup_failed":
            CLEANUP_FAILURES.labels(repository, _text(event, "failure_class")).inc()
        elif kind == "workspace_created":
            project = _text(event, "compose_project")
            host = _text(event, "host")
            _workspaces[project] = (repository, host, now)
            WORKSPACE_AGE.labels(repository, host, project).set(0)
        elif kind in {"workspace_removed", "cleanup_completed"}:
            project = _text(event, "compose_project")
            workspace = _workspaces.pop(project, None)
            workspace_repository, workspace_host, _ = workspace or (repository, _text(event, "host"), now)
            WORKSPACE_AGE.remove(workspace_repository, workspace_host, project)
        elif kind == "image_stale":
            IMAGE_STALE.labels(repository, _text(event, "image_version")).set(1 if event.get("stale", True) else 0)
        elif kind == "log_heartbeat":
            LAST_LOG.labels(repository).set(now)
        elif kind == "harness_stage":
            HARNESS_STAGE.labels(repository, _text(event, "stage")).observe(max(0, float(event.get("duration_seconds", 0))))
        elif kind == "harness_failure":
            HARNESS_FAILURES.labels(repository, _text(event, "stage")).inc()
        elif kind == "drill_started":
            scenario_id = _text(event, "scenario_id")
            drill_id = _text(event, "drill_id")
            if scenario_id not in {"RD-1", "RD-2", "RD-3", "RD-4", "RD-5", "RD-6", "RD-7", "RD-8"}:
                raise ValueError(f"unsupported drill scenario: {scenario_id}")
            _drills[drill_id] = (repository, scenario_id, now)
            DRILL_ACTIVE.labels(repository, scenario_id).set(1)
        elif kind == "drill_completed":
            drill_id = _text(event, "drill_id")
            drill = _drills.pop(drill_id, None)
            drill_repository, scenario_id, started_at = drill or (repository, _text(event, "scenario_id"), now)
            result = _text(event, "result", "failed")
            if result not in {"passed", "failed", "blocked"}:
                raise ValueError(f"unsupported drill result: {result}")
            DRILL_ACTIVE.labels(drill_repository, scenario_id).set(0)
            DRILL_DURATION.labels(drill_repository, scenario_id, result).observe(max(0, now - started_at))
            DRILL_RUNS.labels(drill_repository, scenario_id, result).inc()
            DRILL_LAST_COMPLETED.labels(drill_repository, scenario_id).set(now)
            evidence_classes = event.get("evidence_classes", [])
            if not isinstance(evidence_classes, list):
                raise ValueError("drill evidence_classes must be a list")
            for evidence_class in evidence_classes:
                normalized = str(evidence_class)
                if normalized not in {"database", "audit", "outbox", "provider", "reconciliation", "authorization", "cleanup", "logs", "metrics", "dashboard", "alert", "redaction"}:
                    raise ValueError(f"unsupported drill evidence class: {normalized}")
                DRILL_EVIDENCE.labels(drill_repository, scenario_id, normalized).set(1)
        else:
            raise ValueError(f"unsupported event: {kind or '<missing>'}")


def _refresh_ages() -> None:
    now = time.time()
    with _lock:
        for project, (repository, host, created) in _workspaces.items():
            WORKSPACE_AGE.labels(repository, host, project).set(max(0, now - created))


class Handler(BaseHTTPRequestHandler):
    server_version = "singlewindow-lifecycle-collector/1.0"

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self._json(200, {"status": "ok"})
        elif self.path == "/metrics":
            payload = generate_latest(REGISTRY)
            self.send_response(200)
            self.send_header("Content-Type", CONTENT_TYPE_LATEST)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/v1/events":
            self._json(404, {"error": "not found"})
            return
        if EVENT_TOKEN and self.headers.get("Authorization") != f"Bearer {EVENT_TOKEN}":
            self._json(401, {"error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                raise ValueError("invalid event size")
            event = json.loads(self.rfile.read(length))
            if not isinstance(event, dict):
                raise ValueError("event must be a JSON object")
            handle_event(event)
            self._json(202, {"accepted": True})
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self._json(400, {"error": str(exc)})

    def log_message(self, fmt: str, *args: Any) -> None:
        # Keep access logs structured and free of request bodies or credentials.
        print(json.dumps({"event": "http_access", "message": fmt % args}), flush=True)


def _age_loop() -> None:
    while True:
        _refresh_ages()
        time.sleep(15)


def main() -> None:
    host = os.getenv("LISTEN_HOST", "0.0.0.0")
    port = int(os.getenv("LISTEN_PORT", "9090"))
    server = ThreadingHTTPServer((host, port), Handler)
    threading.Thread(target=_age_loop, name="workspace-age-refresh", daemon=True).start()
    print(json.dumps({"event": "collector_started", "host": host, "port": port}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
