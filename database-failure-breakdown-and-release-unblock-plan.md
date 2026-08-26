# Database Failure Breakdown and Release-Unblock Plan

**Repository:** `munisp/singlewindow`
**Assessment date:** 2026-08-26 EDT
**Current environment limitation:** Docker and Docker Compose are unavailable, so the real PostgreSQL harness has been validated structurally but not executed here.

## 1. Corrected classification of the 25 recorded failures

The recorded full-suite result was **4,524 passed / 25 failed**. It is important not to describe all 25 as database-dependent. **Twenty-three** failures are caused by a missing PostgreSQL dependency; the remaining **two** were stale `archived`-status assertions in the pure `businessRules` unit suite. Those two expectations have now been corrected to cover the persisted `payment_pending → payment_confirmed` transition and the actual terminal statuses (`cleared`, `cancelled`), and the repaired suite passes **42/42**.

| Suite | Database failures | Exact failed checks | Required real tables / behavior |
|---|---:|---|---|
| `server/v79.test.ts` | 6 | `getKafkaEventLog`: result/pagination, failed filter, published filter, required fields, limit; `retryFailedKafkaEvents`: no-argument retry | `kafka_event_log` must contain pending, failed, and published events. The retry path must update at least one failed event safely. |
| `server/v80.test.ts` | 2 | `getKafkaEventLog`: paginated result; `retryFailedKafkaEvents`: retry count | Same `kafka_event_log` dependency; assertions accept an actual numeric retry count. |
| `server/v81.test.ts` | 9 | Temporal: list result, row shape, IDs 1 and 2; WAF: bulk acknowledgement of `[1,2,3]` and `[5]`; Lakehouse: list result, row shape, ID 1 | `temporal_workflow_runs` needs at least six rows including IDs 1–2; `open_appsec_events` needs IDs 1–5; `lakehouse_jobs` needs at least six rows including ID 1. |
| `server/v82.test.ts` | 2 | Temporal: `getWorkflowRunById`; WAF: `bulkAcknowledge` count | Same Temporal/WAF persisted rows used by v81. |
| `server/v83.test.ts` | 4 | GeoIP upload creates seed job; workflow-schema upsert; default-schema seed; default-schema count | Writable `geoip_seed_jobs` and `workflow_input_schemas` tables. The schema registry starts empty so the real seed-default procedure writes its eight defaults. |
| `server/businessRules.test.ts` | 0 after remediation | Previously expected removed `archived` state | This was not a database failure. The corrected lifecycle tests now pass. |

The missing-PostgreSQL failures are direct consequences of real router/database behavior, not candidates for test skipping. For example, Kafka list/retry procedures explicitly require `getDb()`; Temporal and lakehouse read persisted rows; WAF bulk acknowledgement performs durable updates; GeoIP and workflow-schema mutations throw when no database is available.[1] [2]

## 2. Remediation implemented in the working tree

| Change | Purpose | Local verification |
|---|---|---|
| `scripts/seed-postgres-integration-fixtures.mjs` | Adds deterministic isolated fixtures for Kafka event log, Temporal workflow runs, WAF events, and lakehouse jobs. It resets only those test tables and restarts their identities so tests requiring IDs 1–5 use real rows. | JavaScript syntax check passed. Actual inserts require Docker PostgreSQL. |
| `scripts/test-with-postgres.sh` | Runs the integration-fixture seed after schema push and baseline seed. It now invokes the repository’s declared pnpm toolchain directly, rather than transient pnpm 10. | Shell syntax check passed. |
| `server/businessRules.test.ts` | Reconciles stale `archived` expectations with the schema-aligned state machine and adds payment-confirmation authorization coverage. | `42/42` passed. |
| `server/routers/cost.ts` | Logs structured diagnostics for unavailable/non-success upstream cost-service responses before an intentional durable-database fallback. The reachable random cost-data seed remains removed. | Type check, build, and no-fabrication guard passed. |
| `assurance/incomplete-implementation-inventory.md` | Records the completed cost-fallback observability remediation without closing the unresolved product-contract question. | Reviewed in current assurance record. |

## 3. Running the full suite with the Docker PostgreSQL harness

The harness launches an isolated **PostgreSQL 16** container with a tmpfs data directory, waits for readiness, points `DATABASE_URL` only at that container, pushes the Drizzle schema, applies the baseline seed plus deterministic integration fixtures, runs Vitest, and removes the Compose project on exit.[3] It does not use a mocked database.

> Run these commands only on a trusted runner or developer host where Docker access is authorized. The default port is `55432`, deliberately separate from typical local PostgreSQL ports.

| Goal | Command |
|---|---|
| Verify prerequisites | `docker --version && docker compose version && pnpm --version` |
| Install exactly locked dependencies | `pnpm install --frozen-lockfile` |
| Run every Vitest suite against isolated PostgreSQL | `TEST_COMPOSE_PROJECT=singlewindow-full-$(date +%s) scripts/test-with-postgres.sh` |
| Re-run only the formerly DB-dependent suites | `TEST_COMPOSE_PROJECT=singlewindow-db-$(date +%s) scripts/test-with-postgres.sh server/v79.test.ts server/v80.test.ts server/v81.test.ts server/v82.test.ts server/v83.test.ts` |
| Retain the database after a failing run for inspection | `TEST_COMPOSE_PROJECT=singlewindow-debug TEST_POSTGRES_PORT=55433 scripts/test-with-postgres.sh --keep server/v81.test.ts` |
| Inspect retained data | `docker compose --project-name singlewindow-debug --file infra/test-environment/compose.yml exec postgres psql -U tradegateway -d tradegateway_test` |
| Remove retained database | `docker compose --project-name singlewindow-debug --file infra/test-environment/compose.yml down --volumes --remove-orphans` |

The harness sets `NODE_ENV=test` and exports `DATABASE_URL=postgresql://tradegateway:tradegateway@127.0.0.1:<port>/tradegateway_test`. It fails before migration if Docker/Compose or repository dependencies are unavailable. A successful Docker run must be retained as a new evidence artifact; structural validation is **not** a substitute for it.

## 4. Remaining release-unblock prerequisites

The following are prerequisites, not safe code-only changes that can be fabricated in this environment.

| Priority | Prerequisite | Why it is required | Evidence that closes it |
|---|---|---|---|
| P0 | Trusted Docker-capable runner | Required to execute the real PostgreSQL harness, Redis/Toxiproxy drill, container lifecycle tests, and isolated cleanup proof. | Clean checkout, complete harness/test logs, container cleanup log, artifact digest. |
| P0 | Approved declaration/payment rules | State transitions, amount/currency precision, idempotency payload binding, ledger posting, reconciliation, and provider-unknown-outcome rules are not authoritative in the repository. | Signed-off policy/acceptance criteria traced to tests and real staging results. |
| P0 | Approved staging target inventory and authorization | RD-2 through RD-8 deliberately refuse to run without target ownership, test-only database confirmation, and explicit consent. | Protected inventory file plus change approval; secrets referenced through the approved secret manager. |
| P0 | Official payment-provider sandbox credentials | Payment claims cannot be proven with a mock or invented endpoint. | Provider-sandbox transaction, status lookup, retry/unknown-outcome, duplicate request, ledger, and reconciliation artifacts. |
| P0 | Real identity/policy service endpoint | Authorization-outage and cross-tenant behavior require the actual policy/identity path. | Executed deny-by-default and outage tests with durable audit evidence. |
| P0 | gRPC exposure decision and Go toolchain | Four service registrations are commented and explicitly state that generated bindings are needed. Re-enabling without generated bindings and contract tests would be unsafe. | Generated bindings checked in, `go test`/build passes, authenticated real contract calls for declaration, payment, OGA, and profile services; or a signed decision to retire and remove exposed interfaces. |
| P1 | Immutable candidate and deployment controls | The assessed changes are uncommitted and therefore cannot support immutable release evidence. | Reviewed commits, clean checkout, frozen install with scripts enabled, artifact digest/provenance, staged deployment and rollback proof. |
| P1 | Migration, rollback, and restore exercise | Durable trade and financial data require demonstrated recovery, not schema syntax alone. | Production-shaped migration, rollback decision/result, restore verification, and integrity query artifacts. |
| P1 | Deployed observability and incident evidence | Collector, Prometheus, Grafana, Loki, and alert rules are currently configuration/local-unit-test assets. | Alert delivery and acknowledgement, durable logs after runner destruction, dashboard query screenshots/exports, incident record. |
| P1 | Security/SBOM tooling | Gitleaks, Trivy, Syft, and Go/Rust toolchains are unavailable here. | Secret scan, dependency/container scan, SBOM, license review, and exceptions approved by owners. |
| P1 | Semantic classification of remaining marker inventory | The lexical scan has 739 raw hits and is explicitly not a completion proof. | Owner, reachability, security/durability impact, disposition, and regression evidence for every reachable P0 marker. |
| P2 | Cost-service availability contract | The silent-fallback observability defect is remediated, but product ownership has not declared whether live cost service is optional or mandatory. | Approved SLO/error contract plus real upstream negative-path test. |
| P2 | Performance and capacity budgets | No approved load or latency thresholds have been supplied. | Load test on isolated staging, results against approved budgets, and operational sign-off. |

## 5. Truthful completion status

The feasible local defects above have been remediated and locally checked. The remaining items cannot responsibly be marked fixed without credentials, contracts, infrastructure authorization, Docker capability, or missing language/security tooling. The release remains **BLOCKED** until each P0/P1 mandatory gate is executed successfully on an immutable candidate.

## References

[1]: [Recorded full Vitest failure log](file:///home/ubuntu/singlewindow-audit/assurance-vitest-after-remediation.log)
[2]: [Database helper implementation](file:///home/ubuntu/singlewindow/server/db.ts)
[3]: [PostgreSQL harness](file:///home/ubuntu/singlewindow/scripts/test-with-postgres.sh)
[4]: [Incomplete-implementation inventory](file:///home/ubuntu/singlewindow/assurance/incomplete-implementation-inventory.md)

## 6. Additional implementation pass — current task

The following repository-only unblock recommendations were implemented after the earlier breakdown. Each removes a reachable fail-open, fabricated-success, or bounded-work defect without inventing provider behavior.

| Recommendation | Implementation | Verification | Remaining boundary |
|---|---|---|---|
| Do not simulate successful provider settlement | `server/paymentWorker.ts` returns a retryable failure when Mojaloop is unavailable. | Type check and `server/paymentWorker.test.ts` passed 33/33. | Official provider status lookup and unknown-outcome reconciliation remain required. |
| Do not claim terminal payment settlement from a request handler | `server/routers/payments.ts` requires a transfer reference, rejects unavailable/rejected workflow triggers, and returns `confirmation_submitted` without local terminal state writes. | Type check and `server/payments.test.ts` passed 8/8. | A signed callback/authentication/ledger contract and real sandbox exercise are still mandatory. |
| Fail closed when payment/fund-flow idempotency storage is unavailable | `server/_core/distributedLock.ts` and `server/routers/fund-flow.ts` now throw typed unavailable errors instead of emitting synthetic locks or processing as new. | Type check; payment suite passed 8/8; fund-flow suite passed 57/57. | Real Redis outage, concurrency, and recovery drills need the Docker-capable runner. |
| Restrict arbitrary direct account-pair queue writes | `server/routers/batchPayments.ts` changed `enqueue` to `adminProcedure`. | Type check and `server/batchPayments.test.ts` passed 12/12. | Database transaction/unique-conflict semantics and administrator step-up/account scope still require design and real DB tests. |
| Bound worker claims at the database | `server/paymentWorker.ts` selects at most `WORKER_BATCH_SIZE` candidate IDs before the status-changing update, then rechecks status in the update. | Type check, worker suite passed 33/33, and production build passed. | PostgreSQL concurrency execution is required to establish actual multi-worker behavior. |
| Report real worker processed count | `runPaymentWorkerCycle()` now returns its claimed count and caller telemetry increments from that value. | Type check and worker suite passed 33/33. | Dashboard/Prometheus deployed telemetry drill remains required. |
| Prevent phantom developer API keys and rate-limit allow-on-error response | `server/routers/devPortal.ts` requires `API_KEY_HASH_SECRET` or `JWT_SECRET`, rejects unpersistable keys, and returns `allowed: false` on rate-limit storage failure. | Type check and production build passed. No dedicated developer-portal test suite exists. | Add focused negative-path tests and trace the external API-key enforcement middleware before claiming end-to-end rate-limit coverage. |

## 7. Current gate status

| Gate | Current status | Evidence or blocker |
|---|---|---|
| Type check / production build / diff hygiene | Passed | Current validation logs in `singlewindow-audit/release-unblock/`. |
| Focused payment, queue, fund-flow, worker tests | Passed | 33 worker + 8 payment + 57 fund-flow + 12 queue tests in verified focused runs. |
| Full Vitest suite with PostgreSQL | **Not executed** | Docker and Docker Compose are unavailable in this sandbox. |
| Isolated PostgreSQL fixture/harness execution | **Not executed** | Requires the Docker commands in Section 3 on an authorized runner. |
| Redis/Toxiproxy fault test | **Not executed** | Requires Docker/Compose. |
| Official provider sandbox callback/settlement/reconciliation | **Not executed** | No approved provider target, credentials, or contract supplied. |
| Go/Rust/security/SBOM checks | **Not executed** | Go, Cargo, Gitleaks, Trivy, and Syft are not available in the environment. |
| Immutable candidate / deployment / rollback / restore | **Not executed** | Worktree remains uncommitted and no staging deployment authorization was supplied. |

The release remains **BLOCKED**. The implemented changes reduce confirmed reachable risk but cannot close a release gate that requires real PostgreSQL, Redis, provider, identity/policy, deployment, recovery, and security evidence.
