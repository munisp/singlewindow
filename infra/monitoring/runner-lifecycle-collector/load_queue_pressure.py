#!/usr/bin/env python3
"""Generate bounded GitHub Actions queue pressure against the lifecycle collector."""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import sys
import time
import urllib.parse
import urllib.request
import uuid
from typing import Any



def post(base_url: str, event: dict[str, Any], token: str = "") -> None:
    body = json.dumps(event, separators=(",", ":")).encode()
    headers = {"Content-Type": "application/json", "User-Agent": "singlewindow-queue-load-test/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(f"{base_url.rstrip('/')}/v1/events", data=body, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status >= 300:
            raise RuntimeError(f"collector returned HTTP {response.status}")


def get_metrics(base_url: str) -> str:
    with urllib.request.urlopen(f"{base_url.rstrip('/')}/metrics", timeout=10) as response:
        return response.read().decode()


def metric_value(metrics: str, name: str) -> float:
    for line in metrics.splitlines():
        if line.startswith(name) and not line.startswith(f"{name}_"):
            try:
                return float(line.rsplit(" ", 1)[1])
            except (IndexError, ValueError):
                continue
    return 0.0


def query_prometheus(prometheus_url: str, expression: str) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({"query": expression})
    with urllib.request.urlopen(f"{prometheus_url.rstrip('/')}/api/v1/query?{query}", timeout=10) as response:
        payload = json.loads(response.read())
    if payload.get("status") != "success":
        raise RuntimeError(f"Prometheus query failed: {payload}")
    return payload.get("data", {}).get("result", [])


def scalar_result(result: list[dict[str, Any]]) -> float:
    if not result:
        return 0.0
    return float(result[0]["value"][1])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collector-url", default="http://127.0.0.1:9090")
    parser.add_argument("--prometheus-url", help="Optional Prometheus base URL for instant-query verification")
    parser.add_argument("--verify-alerts", action="store_true", help="Require queue metrics and a firing queue alert in Prometheus")
    parser.add_argument("--repository", default="munisp/singlewindow")
    parser.add_argument("--workflow", default="services")
    parser.add_argument("--runner-label-group", default="singlewindow-ci")
    parser.add_argument("--jobs", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=16)
    parser.add_argument("--queue-wait-seconds", type=float, default=360)
    parser.add_argument("--hold-queue-seconds", type=float, default=15)
    parser.add_argument("--process-duration-seconds", type=float, default=0.2)
    parser.add_argument("--token", default="")
    parser.add_argument("--drain", action="store_true", help="Assign and complete every generated job after the hold period")
    args = parser.parse_args()
    if args.jobs < 1 or args.concurrency < 1:
        parser.error("--jobs and --concurrency must be positive")

    now = time.time()
    runner_name = f"load-test-{uuid.uuid4().hex[:10]}"
    post(args.collector_url, {"event": "runner_requested", "runner_name": runner_name, "repository": args.repository, "timestamp": now - 3})
    post(args.collector_url, {"event": "runner_online", "runner_name": runner_name, "repository": args.repository, "runner_mode": "ephemeral", "runner_label_group": args.runner_label_group, "image_version": "load-test", "timestamp": now - 2})

    jobs = []
    for index in range(args.jobs):
        job_id = f"load-{uuid.uuid4().hex}"
        jobs.append(job_id)
        post(args.collector_url, {"event": "job_queued", "job_id": job_id, "repository": args.repository, "workflow": args.workflow, "runner_label_group": args.runner_label_group, "pull_request": True, "timestamp": now - args.queue_wait_seconds + index * 0.001}, args.token)

    queued_metrics = get_metrics(args.collector_url)
    queued_depth = metric_value(queued_metrics, "ci_queue_depth")
    oldest_age = metric_value(queued_metrics, "ci_oldest_queued_job_age_seconds")
    print(f"queued jobs={args.jobs} observed_depth={queued_depth:.0f} oldest_age={oldest_age:.1f}s")
    if queued_depth < args.jobs:
        print("WARNING: collector did not retain the expected queue depth", file=sys.stderr)

    if args.hold_queue_seconds:
        time.sleep(args.hold_queue_seconds)

    if args.verify_alerts:
        repository_selector = '{repository="' + args.repository + '"}'
        expressions = {
            "queue_depth": 'sum(ci_queue_depth' + repository_selector + ')',
            "oldest_queue_age": 'max(ci_oldest_queued_job_age_seconds' + repository_selector + ')',
        }
        pressure_values = {name: scalar_result(query_prometheus(args.prometheus_url, expression)) for name, expression in expressions.items()}
        if pressure_values["queue_depth"] < args.jobs or pressure_values["oldest_queue_age"] < args.queue_wait_seconds - 30:
            raise RuntimeError("Prometheus did not observe the expected queue pressure")
        alert_result = query_prometheus(args.prometheus_url, 'ALERTS{alertname=~"SingleWindowPRQueueLatencyHigh|SingleWindowOldQueuedJob",alertstate="firing"}')
        if not alert_result:
            raise RuntimeError("Prometheus has not observed a firing queue-pressure alert; increase --hold-queue-seconds and retry")
        serialized_pressure = json.dumps(pressure_values, separators=(",", ":"))
        serialized_alerts = json.dumps(alert_result, separators=(",", ":"))
        print(f"verified queue pressure: {serialized_pressure}")
        print(f"verified queue alerts: {serialized_alerts}")

    def assign_and_complete(job_id: str) -> None:
        started = time.time()
        post(args.collector_url, {"event": "job_in_progress", "job_id": job_id, "repository": args.repository, "workflow": args.workflow, "runner_label_group": args.runner_label_group, "pull_request": True, "timestamp": started}, args.token)
        time.sleep(args.process_duration_seconds)
        post(args.collector_url, {"event": "job_completed", "job_id": job_id, "repository": args.repository, "workflow": args.workflow, "runner_label_group": args.runner_label_group, "timestamp": time.time()}, args.token)

    selected = jobs if args.drain else jobs[: min(args.concurrency, args.jobs)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        list(executor.map(assign_and_complete, selected))

    final_metrics = get_metrics(args.collector_url)
    observed_waits = metric_value(final_metrics, "ci_job_queue_wait_seconds_count")
    final_depth = metric_value(final_metrics, "ci_queue_depth")
    print(f"completed jobs={len(selected)} observed_queue_wait_samples={observed_waits:.0f} final_depth={final_depth:.0f}")
    if observed_waits < len(selected):
        print("WARNING: not all assignments produced queue-wait observations", file=sys.stderr)

    if args.verify_alerts and not args.prometheus_url:
        parser.error("--verify-alerts requires --prometheus-url")
    if args.prometheus_url and not args.verify_alerts:
        repository_selector = '{repository="' + args.repository + '"}'
        queue_selector = '{repository="' + args.repository + '",event="pull_request"}'
        expressions = {
            "queue_p95": 'histogram_quantile(0.95, sum by (le) (rate(ci_job_queue_wait_seconds' + queue_selector + '[10m])))',
            "queue_depth": 'sum(ci_queue_depth' + repository_selector + ')',
            "oldest_queue_age": 'max(ci_oldest_queued_job_age_seconds' + repository_selector + ')',
        }
        prometheus_values = {}
        for name, expression in expressions.items():
            result = query_prometheus(args.prometheus_url, expression)
            prometheus_values[name] = scalar_result(result)
            serialized_result = json.dumps(result, separators=(",", ":"))
            print(f"prometheus {name}={serialized_result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
