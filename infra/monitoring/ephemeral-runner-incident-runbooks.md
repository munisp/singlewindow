# Ephemeral Runner Incident Runbooks and Remediation Policy

## Scope and safety boundary

These runbooks cover the dedicated `singlewindow-ci` runner fleet, its Docker host, the lifecycle metrics collector, the PostgreSQL test harness, and the durable log pipeline. A runner host has Docker-socket-level authority and must be treated as a high-trust build environment. Automated remediation must never modify production databases, production credentials, GitHub repository permissions, branch protection, or arbitrary Docker resources.

Use the following response order for every critical alert:

1. Acknowledge the alert and identify the repository, workflow, runner label group, host, run ID, and alert start time.
2. Open the Grafana dashboard and correlate the alert with queue, provisioning, host, Docker, PostgreSQL, and log-forwarding panels.
3. Preserve evidence before cleanup: Alertmanager payload, collector logs, host journal slice, GitHub job URL, Docker container metadata, and test artifacts.
4. Apply only the bounded action allowed by the relevant policy below.
5. Verify the recovery condition and record the remediation result, operator, and evidence links.
6. Escalate if the first bounded action fails or if any security-control or data-integrity concern is present.

## Alert action matrix

| Alert class | Immediate action | Safe automation | Escalate when |
| --- | --- | --- | --- |
| No idle runner / old queued job | Check runner online state, labels, host reachability, and GitHub routing. | Start or restart one approved persistent runner; do not start an unbounded fleet. | Queue age continues for 10 minutes, registration fails, or labels do not match. |
| Registration failure | Inspect token issuance, authentication, outbound HTTPS, and image startup logs. | Retry token acquisition up to 3 times with exponential backoff; never print the token. | Three retries fail, permissions appear changed, or an unexpected repository is targeted. |
| Slow provisioning | Compare image-pull, Docker start, registration, and GitHub assignment durations. | Warm the approved image cache on an idle host or drain a host with excessive load. | p95 remains above 90 seconds for 30 minutes or image integrity is uncertain. |
| Cleanup failure / workspace leak | Confirm the GitHub job is completed and the Compose project belongs to this run. | Remove only the exact `singlewindow-test-db-*` project after a completion check; deregister the exact runner. | Job is still active, ownership cannot be proven, or cleanup repeats. |
| Host CPU or memory pressure | Identify the runner/job container consuming resources; protect current job from termination. | Stop accepting new work on the host; after jobs finish, restart the runner container. | OOM kills occur, host is unstable, or pressure returns after one restart. |
| Docker disk critical | Snapshot disk and Docker usage before cleanup. | Prune only labeled, completed SingleWindow ephemeral projects and unused layers older than the retention window. | Disk remains above 85%, unlabeled data is involved, or production containers share the host. |
| PostgreSQL harness failure | Inspect Compose health, database logs, migration output, and seed output. | Retry the same clean harness once; preserve the first failure artifacts. | The retry fails, schema changes are involved, or the target URL is not a test URL. |
| Missing durable logs | Check host journal, Promtail/Alloy health, retry queue, Loki availability, and retention. | Restart only the log agent after confirming journal persistence; do not delete journal data. | Logs are missing from both journal and Loki, or the outage exceeds the retention buffer. |
| Stale runner image | Compare image digest/version with the approved release manifest. | Drain the host and roll out the approved signed/checksum-verified image. | Release provenance cannot be verified or the runner is outside its update policy. |

## Runbook: no idle runner or queue latency

**Symptoms:** `SingleWindowNoIdleRunnerForQueuedJob`, `SingleWindowOldQueuedJob`, or critical p95 queue latency.

**Diagnosis:** Confirm that the queue is for `singlewindow-ci` and inspect whether the matching runner is offline, busy, unregistered, or merely missing a label. Check the host’s `runner_online` and `runner_busy` metrics, then inspect the collector and runner lifecycle logs for registration and de-registration events. Confirm outbound TCP 443 access to GitHub and that the host Docker daemon is healthy.

**Containment and remediation:** If the persistent runner host is healthy but the container is stopped, restart the approved Compose project once. If the host is unavailable, start one replacement ephemeral runner with the exact required labels. Apply a rate limit of one replacement per host per 15 minutes. Do not create repeated replacements while the root cause is a token, label, network, or account policy failure.

**Recovery:** The alert resolves only after a matching runner is online and idle, a newly queued canary job becomes `in_progress`, and queue p95 returns below the warning threshold. Record the old queue age, provisioning time, and GitHub job URL.

## Runbook: registration or provisioning failure

**Diagnosis:** Classify the failure as token request denied, API unreachable, runner archive checksum mismatch, configuration failure, or Docker startup failure. Verify the repository and runner scope are expected. Inspect only redacted command output. Never copy a token into the incident channel.

**Automated action:** A controller may request a new short-lived token and retry up to three times with delays of 5, 15, and 45 seconds. It must stop if the repository scope changes, the token endpoint returns authorization errors, or the checksum does not match the approved manifest. Permissions and organization policies require human review.

**Recovery:** Require a successful registration event, `runner_online=1`, a canary job assignment, and a durable `cleanup_completed` event for the canary. If the runner is ephemeral, verify that GitHub de-registered it after completion.

## Runbook: cleanup failure or workspace leak

**Diagnosis:** Use `compose_project`, host, runner name, and job ID to prove ownership. Query GitHub to confirm that the job is completed or cancelled and that no process is still using the project. Inspect `docker compose ps` and volume labels.

**Automated action:** The only permitted automatic deletion is an exact, completed project whose name begins with `singlewindow-test-db-` and whose labels match the recorded run. The controller may run `docker compose down --volumes --remove-orphans` for that project and remove the exact ephemeral runner registration. It must not run global `docker system prune`, delete unlabelled volumes, or kill a running job.

**Recovery:** Confirm the project and its volumes are gone, the runner is deregistered when ephemeral, and the cleanup completion event is present in Loki. If ownership is ambiguous, quarantine the host from new work and require an operator.

## Runbook: Docker host resource exhaustion

**Diagnosis:** Review CPU, available memory, OOM events, Docker filesystem bytes, inode usage, active containers, and the five largest container/workspace consumers. Distinguish a single pathological test from fleet-wide capacity pressure.

**Automated action:** Mark the host unschedulable for new work. Allow the current job to finish unless the host is at risk of failure. After the job completes, restart the runner container and remove only completed, labeled test projects. A disk cleanup job must run in dry-run mode first and enforce an allowlist of project prefixes and labels.

**Recovery:** Require CPU below 85%, available memory above 20%, Docker filesystem below 70%, and zero new OOM events for 15 minutes before re-enabling scheduling.

## Runbook: PostgreSQL harness failure

**Diagnosis:** Check whether failure occurred during image start, readiness, schema application, seed, Vitest, or teardown. Confirm `DATABASE_URL` points at the disposable test port and that no production host is present. Preserve PostgreSQL logs and the first failing test output.

**Automated action:** Retry exactly once using a new Compose project and empty volume. Do not retry indefinitely and do not bypass migrations or seed setup. If the second run fails, open an engineering incident with the migration/seed diff and database logs.

**Recovery:** Require a successful readiness check, schema application, deterministic seed, focused test execution, and cleanup. A test pass without a successful teardown is not a clean recovery.

## Runbook: durable-log pipeline failure

**Diagnosis:** Check, in order, the host journal, Promtail/Alloy positions file, retry queue, Loki gateway, tenant authorization, and object-store health. The host journal should remain available even if the runner container no longer exists.

**Automated action:** Restart the collector only when journald is confirmed persistent and the positions file is intact. Do not rotate or delete the journal during an active diagnostic outage. If the retry queue exceeds 80%, stop nonessential ephemeral capacity growth until the log path recovers.

**Recovery:** Send a synthetic lifecycle event through the complete path, verify its appearance in Loki, verify the collector heartbeat metric, and query the destroyed runner’s final `cleanup_completed` event. If durable evidence cannot be reconstructed, keep the incident open as an observability-control failure.

## Alertmanager integration

The existing Alertmanager configuration already routes `severity: critical` alerts to PagerDuty and the critical operations Slack channel. Keep runner alerts labeled with `severity: critical`, `team: platform`, and `component: github-actions` so they follow that path. Add a dedicated receiver only if the organization wants a separate platform on-call route; do not embed credentials in this repository.

A webhook receiver for automation should be placed behind an authenticated internal endpoint. It should accept only the allowlisted alert names below, verify Alertmanager authenticity, deduplicate by alert fingerprint, enforce a per-alert cooldown, and write an audit record before acting:

```yaml
allowed_alerts:
  - SingleWindowNoIdleRunnerForQueuedJob
  - SingleWindowRunnerRegistrationFailure
  - SingleWindowRunnerCleanupFailed
  - SingleWindowEphemeralWorkspaceLeaked
  - SingleWindowPostgresHarnessFailure
  - SingleWindowEphemeralLogsMissing
cooldowns:
  default: 15m
  registration: 30m
max_actions_per_host_per_hour: 3
require_job_completed_before_workspace_delete: true
allow_global_docker_prune: false
allow_production_database_access: false
```

## Automation design principles

Automate **reversible, narrow, and observable** actions: retry a short-lived token request, restart a known runner container, drain one host, retry a clean test database, or remove an exact completed Compose project. Require human approval for permission changes, repository-scope changes, production access, global Docker cleanup, evidence deletion, and any action that could terminate a running job.

Every automated action should emit `remediation_started`, `remediation_succeeded`, or `remediation_failed` with the alert fingerprint, safe resource identifiers, action name, attempt number, and result. The action must have a timeout, maximum retry count, circuit breaker, and rollback or quarantine path. The controller must fail closed when it cannot establish ownership.
