# PR-E — Runner lifecycle ingestion, signed webhook adapter, and release-drill tooling

## Change purpose

Describe the lifecycle collector, GitHub `workflow_job` adapter, metrics contract, queue-pressure test, fault-injection test, or related runbook change. This PR must never include a live webhook secret, collector bearer token, production URL, or a test that targets a production service.

## Security and data boundary

| Control | Evidence / design note |
| --- | --- |
| GitHub signature verification |  |
| Collector authentication |  |
| Secret-file or secret-manager injection |  |
| Delivery idempotency and replay behavior |  |
| Persistent delivery state and retention |  |
| Payload size, timeout, and retry limits |  |
| PII / sensitive metadata exclusion |  |
| Metric-label cardinality control |  |

## Required evidence

- [ ] Collector and adapter unit tests pass.
- [ ] A signed `workflow_job` fixture is accepted; invalid/missing signatures are rejected.
- [ ] Duplicate delivery IDs are acknowledged without duplicate metric emission.
- [ ] Collector forwarding failure leaves a retry-safe pending delivery and returns a retriable result to GitHub.
- [ ] Collector metrics, health endpoint, and dashboard panels are smoke-tested.
- [ ] Queue-pressure test runs only against a dedicated staging collector and validates queue depth/age plus expected alert state.
- [ ] Fault-injection test uses disposable services with a unique project/namespace and automatic cleanup.
- [ ] Release-drill artifacts include scenario manifest, logs, metrics snapshot, alert result, invariant result, cleanup result, and runbook link.
- [ ] No raw job secret, token, authorization header, or payment/PII payload enters logs, metrics, or test artifacts.

## Reviewer sign-off

| Reviewer role | Name | Required sign-off |
| --- | --- | --- |
| SRE/platform owner |  | I confirm collector availability, metrics, storage, dashboard, and release-drill behavior. |
| Security owner |  | I confirm webhook verification, secret injection, inbound exposure, and data handling. |
| QA/automation owner |  | I confirm fixtures, fault boundaries, assertions, and artifacts are deterministic. |
| Repository administrator |  | I confirm webhook registration is staged and scoped to the intended repository/event type. |

## Merge gate

- [ ] Staging endpoint proof is attached; production webhook registration is a separately approved change record.
- [ ] The fault-injection suite cannot run without explicit `DRILL_ENV=staging` and a unique disposable namespace/project.
- [ ] All four reviewer roles approved.
- [ ] A post-merge staging drill is scheduled, owned, and linked from the release record.
