# SingleWindow Runner Lifecycle Metrics Collector

This small Python service accepts lifecycle events and exposes Prometheus metrics on port `9090`. It is intentionally not a durable event store. Send the raw event to the durable log pipeline as well, then post the normalized event to `POST /v1/events`.

## Run locally

```bash
cd infra/monitoring/runner-lifecycle-collector
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python collector.py
```

The endpoints are `GET /healthz`, `GET /metrics`, and `POST /v1/events`. Set `LIFECYCLE_EVENT_TOKEN` to require `Authorization: Bearer <token>` on event ingestion. Keep the token outside the container image and never place it in logs.

## Event examples

```json
{"event":"job_queued","job_id":"gh-job-123","repository":"munisp/singlewindow","workflow":"services","runner_label_group":"singlewindow-ci","pull_request":true,"timestamp":"2026-08-25T20:15:02.112Z"}
{"event":"job_in_progress","job_id":"gh-job-123","pull_request":true,"timestamp":"2026-08-25T20:16:14.112Z"}
{"event":"runner_requested","runner_name":"singlewindow-ephemeral-01","timestamp":"2026-08-25T20:15:04Z"}
{"event":"runner_online","runner_name":"singlewindow-ephemeral-01","runner_mode":"ephemeral","runner_label_group":"singlewindow-ci","image_version":"2.336.0","timestamp":"2026-08-25T20:15:40Z"}
{"event":"workspace_created","compose_project":"singlewindow-test-db-123","host":"runner-host-01","timestamp":"2026-08-25T20:15:44Z"}
{"event":"harness_stage","stage":"migration","duration_seconds":7.4,"timestamp":"2026-08-25T20:15:55Z"}
{"event":"harness_failure","stage":"seed","timestamp":"2026-08-25T20:16:03Z"}
{"event":"cleanup_completed","compose_project":"singlewindow-test-db-123","host":"runner-host-01","timestamp":"2026-08-25T20:20:00Z"}
{"event":"log_heartbeat","timestamp":"2026-08-25T20:20:01Z"}
```

A webhook adapter should translate GitHub `workflow_job` events into `job_queued`, `job_in_progress`, and `job_completed` events. The runner registration scripts should emit runner and workspace events. The PostgreSQL wrapper should emit `harness_stage` and `harness_failure` events. Preserve the original GitHub event and lifecycle JSON in Loki or object storage.

## Metrics exposed

The collector implements the names consumed by `infra/monitoring/prometheus/ephemeral-runner-alerts.yaml`: queue and provisioning histograms, registration/cleanup/harness failure counters, queue and runner gauges, workspace age, image staleness, and log-heartbeat timestamp. Prometheus should scrape `/metrics` every 15 seconds.

For production, run at least two collector replicas behind a stable service and route events to both replicas or provide a durable queue in front of them. The simplest collector keeps derived state in memory; restarting it resets active queue/workspace state. If exact continuity across restarts is required, place a durable event stream or database in front of the collector and replay recent events on startup.

## Container deployment

```bash
docker build -t singlewindow/runner-lifecycle-collector:1.0.0 .
docker run --rm --name runner-lifecycle-collector \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  -e LIFECYCLE_EVENT_TOKEN_FILE=/run/secrets/lifecycle-token \
  -p 9090:9090 \
  singlewindow/runner-lifecycle-collector:1.0.0
```

The example assumes the secret is injected by the deployment platform. Add a real reverse proxy or network policy so only the trusted webhook adapter and runner host can reach `POST /v1/events`; Prometheus needs only `GET /metrics`.

## GitHub workflow_job adapter

Build the adapter separately from the collector:

```bash
docker build -f Dockerfile.adapter -t singlewindow/workflow-job-adapter:1.0.0 .
docker run --rm --name workflow-job-adapter \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  -e GITHUB_WEBHOOK_SECRET_FILE=/run/secrets/github-webhook-secret \
  -e COLLECTOR_URL=http://runner-lifecycle-collector:9090/v1/events \
  -e COLLECTOR_TOKEN_FILE=/run/secrets/collector-token \
  -v workflow-adapter-state:/var/lib/adapter \
  -p 8089:8089 \
  singlewindow/workflow-job-adapter:1.0.0
```

The adapter currently reads `GITHUB_WEBHOOK_SECRET` and `COLLECTOR_TOKEN` environment variables. Inject equivalent values through the deployment platform; do not put secrets in the image or command line. Configure a GitHub repository webhook for `workflow_job`, select JSON payloads, use the same secret, and point it at `/github/webhook`. The adapter verifies `X-Hub-Signature-256`, ignores unrelated event types, normalizes `queued`, `in_progress`, and `completed`, and records the `X-GitHub-Delivery` ID in SQLite. A repeated forwarded delivery is acknowledged without sending a duplicate collector event.

## Queue-pressure load test

Start a collector and run a bounded pressure test:

```bash
python load_queue_pressure.py \
  --collector-url http://127.0.0.1:9090 \
  --jobs 500 \
  --concurrency 32 \
  --queue-wait-seconds 600 \
  --hold-queue-seconds 30 \
  --drain
```

To verify Prometheus observes the pressure and a queue alert is firing, pass the Prometheus URL and `--verify-alerts`. The alert rule must have had time to scrape and evaluate, so use a hold duration longer than the alert’s `for` period in a controlled staging test. Do not run this against a production collector unless the jobs are isolated test events and the resulting alert has an explicitly approved maintenance window.
