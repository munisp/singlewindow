# Ephemeral Runner Observability and Durable Logs

## Reference topology

```text
Runner and CI containers
        │ stdout/stderr
        ▼
Docker journald log driver on dedicated runner host
        │ persistent systemd journal
        ▼
Host Promtail / Grafana Alloy agent
        │ disk-backed positions + retry queue over HTTPS
        ▼
Loki gateway
        │ replicated durable object storage
        ▼
Grafana / incident search
```

The critical design choice is that the first durable copy is created **outside** the ephemeral runner container. A container filesystem, a container-local log file, and a Docker volume mounted only into the runner are not sufficient: all can disappear during cleanup. The host journal and the Loki backend must have independent lifecycles from the runner container.

## Docker logging on the runner host

Apply this only to a dedicated runner host, not to a shared production Docker host. Configure Docker to use journald as its default log driver:

```json
{
  "log-driver": "journald",
  "log-opts": {
    "tag": "singlewindow.runner.{{.Name}}"
  }
}
```

The tag gives Promtail a stable way to recognize runner and job-container records. Restart Docker during a planned maintenance window after validating the configuration. Existing containers do not automatically change log drivers; recreate the runner and any relevant service containers after the daemon change.

Configure persistent journald storage on the host, for example:

```ini
# /etc/systemd/journald.conf.d/singlewindow-runner.conf
[Journal]
Storage=persistent
SystemMaxUse=10G
SystemKeepFree=5G
MaxRetentionSec=7day
Compress=yes
SyncIntervalSec=5s
```

Create the journal directory, restart `systemd-journald`, and verify that the filesystem has enough free space. The values above are starting points, not universal capacity limits. Set retention from the organization’s incident-response and regulatory requirements, then alert before the journal reaches its cap.

## Promtail or Grafana Alloy

Run the agent as a host-level system service or a privileged monitoring DaemonSet with access to the host journal. Use the supplied `ephemeral-runner-promtail.yaml` as the scrape fragment. Its important properties are a persistent positions file, HTTPS transport, a bounded retry queue, exponential backoff, JSON parsing, and low-cardinality labels.

The positions file must live on a durable host path such as `/var/lib/promtail/positions.yaml`, not in `/tmp` and not only in the ephemeral runner container. If the agent restarts, it resumes from the last recorded journal offset. If Loki is temporarily unavailable, the client retries from its local queue. The queue is a protection against short outages, not a replacement for durable Loki storage; size it for the expected outage window and monitor queue saturation.

For a Kubernetes deployment, mount the host journal read-only and mount a persistent volume for Promtail positions. For a VM deployment, run Promtail under systemd with a restricted service account that can read the journal. The collector should have outbound HTTPS access to the Loki gateway but no write access to the runner workspace or Docker socket.

## Loki durability

Use replicated Loki components and object storage such as S3-compatible storage for production retention. Do not use a single local filesystem volume as the only Loki copy. Configure object-store encryption, server-side retention, and access controls. Keep the log stream labels bounded to values such as `service`, `environment`, `repository`, `runner_mode`, `workflow`, `level`, and `failure_class`.

Do not use commit SHA, job ID, declaration ID, payment ID, token, arbitrary error text, or full runner name as Loki labels. Those fields belong in the structured log body and can be searched when needed. This prevents high-cardinality streams and protects storage performance.

## Structured runner lifecycle events

Emit one JSON record for each lifecycle transition:

```json
{"ts":"2026-08-25T20:15:02.112Z","level":"info","event":"registration_token_requested","repository":"munisp/singlewindow","runner_mode":"ephemeral","runner_name":"singlewindow-release-check-01","image_version":"2.336.0"}
{"ts":"2026-08-25T20:15:09.410Z","level":"info","event":"runner_configured","repository":"munisp/singlewindow","runner_mode":"ephemeral","compose_project":"singlewindow-ephemeral-1735167302"}
{"ts":"2026-08-25T20:15:12.001Z","level":"info","event":"runner_online","repository":"munisp/singlewindow","runner_mode":"ephemeral"}
{"ts":"2026-08-25T20:28:42.305Z","level":"info","event":"runner_exit","repository":"munisp/singlewindow","runner_mode":"ephemeral","result":"success"}
{"ts":"2026-08-25T20:28:43.021Z","level":"info","event":"cleanup_completed","repository":"munisp/singlewindow","runner_mode":"ephemeral","compose_project":"singlewindow-ephemeral-1735167302"}
```

The actual runner scripts must never write registration tokens, API tokens, authorization headers, passwords, or complete secret-bearing command lines. If a failure needs a diagnostic value, emit a controlled `failure_class` such as `token_request_denied`, `runner_config_failed`, `docker_unavailable`, `loki_push_failed`, or `workspace_cleanup_failed`.

The GitHub job ID and run ID should be included as structured fields when available, but not as metric or log labels. They allow correlation with the GitHub UI and webhook event archive without creating unbounded Loki streams.

## Diagnostic durability workflow

The durable workflow should be:

1. Docker writes runner and service-container stdout/stderr to the host’s persistent journald store.
2. Promtail or Grafana Alloy tails the journal, persists its read position, parses JSON, applies redaction, and sends batches to Loki over HTTPS.
3. The collector retries transient failures with a bounded disk-backed queue and exposes its own health metrics.
4. Loki stores the records in replicated object storage with an agreed retention period.
5. The GitHub workflow separately uploads test reports and coverage as GitHub artifacts, using `if: always()`, to preserve job-specific files that may not be present in stdout.
6. The ephemeral cleanup removes the runner container and workspace only after lifecycle logs have been emitted; host journald and Loki remain available after destruction.

Treat the GitHub artifact as a secondary, job-scoped diagnostic copy. Treat Loki as the searchable operational record. The host journal is the short-term source of truth when the network path to Loki is unhealthy.

## Redaction and access control

Redact secrets before ingestion whenever possible at the application or wrapper boundary. Add a collector replacement stage only as a defense in depth; do not rely on a regex as the primary secret-control mechanism. Restrict Loki tenant access to platform operations and security personnel, encrypt transport and storage, and audit queries that contain sensitive workflow identifiers.

Use separate retention and access policies for ordinary runner lifecycle logs, test output, and security audit logs. Never forward raw environment dumps. The runner’s Docker-socket access already makes the host high trust, so the logging system must not add cloud credentials or production database credentials to the runner environment merely to enable observability.

## Health checks and alerts

Monitor the log path itself, not just the runner. At minimum alert on:

| Condition | Initial alert |
| --- | --- |
| No lifecycle heartbeat received | `runner_last_log_timestamp_seconds` older than 10 minutes or absent. |
| Promtail cannot push to Loki | Client errors or retry queue above 80% for 5 minutes. |
| Host journal near capacity | More than 80% used; page at 90% if cleanup or expansion is not automatic. |
| Loki ingestion rejected | Any sustained 4xx/5xx rate, with tenant and reason captured in metrics rather than labels with raw messages. |
| Cleanup without completion event | Runner exit observed but no `cleanup_completed` event within 5 minutes. |
| Unexpected runner container | A container with the runner image exists outside an active lifecycle record. |

Test the path quarterly by launching one ephemeral runner, forcing a short Loki outage, completing a job, destroying the container, restoring Loki, and verifying that the complete lifecycle can still be found from `registration_token_requested` through `cleanup_completed`.

## Recovery procedure

If an ephemeral container is destroyed before its logs reach Loki, inspect the host journal first using the runner name, Compose project, or Docker container ID. If the journal has rotated, inspect the GitHub job logs and uploaded artifacts. If neither source is available, classify the incident as an observability-control failure, not merely a missing test log. Fix the forwarding or retention path before increasing ephemeral-runner volume.
