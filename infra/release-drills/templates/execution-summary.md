# Sprint 4 Release-Drill Execution Summary

**Drill ID:** `RD-__`
**Run ID / project:** `singlewindow-drill-________`
**Environment:** `staging`
**Date and UTC window:** `YYYY-MM-DD HH:MM–HH:MM UTC`
**Repository / commit:** `munisp/singlewindow @ <SHA>`
**Workflow run:** `<URL>`
**Scenario owner:** `<name / team>`
**Approvers:** `<platform>`, `<security>`, `<QA>`, `<release manager>`

## 1. Objective and safety boundary

State the production-relevant hypothesis being tested and the exact invariant that must hold. Confirm that the run used only the dedicated staging Docker host or namespace, a project name beginning with `singlewindow-drill-`, synthetic tenants/payments/documents, and local fakes. Confirm that no production endpoint, credential, database, payment gateway, notification provider, or agency integration was reachable.

| Safety control | Expected value | Observed evidence | Result |
| --- | --- | --- | --- |
| Explicit fault-injection consent | `DRILL_ENV=staging`, `ALLOW_FAULT_INJECTION=1` |  | Pass / Fail |
| Unique disposable project | `singlewindow-drill-*` |  | Pass / Fail |
| Test-only database | `tradegateway_drill*` |  | Pass / Fail |
| Local fake dependency endpoints | Compose service DNS names only |  | Pass / Fail |
| Bounded timeout | At or below approved limit |  | Pass / Fail |
| No production/public target | Validator result |  | Pass / Fail |

## 2. Scenario configuration

| Field | Value |
| --- | --- |
| Scenario ID and name |  |
| Fault type and target |  |
| Fault start / restore time |  |
| Synthetic tenant / declaration / payment references |  |
| Idempotency or correlation key |  |
| Expected invariant |  |
| Expected alert/dashboard behavior |  |
| Scenario script and version |  |

## 3. Execution timeline

| UTC time | Action | Expected observation | Actual observation | Status |
| --- | --- | --- | --- | --- |
|  | Environment validation | Fail-closed checks pass |  |  |
|  | Services ready | Health checks green |  |  |
|  | Fixture seeded | Synthetic records available |  |  |
|  | Fault injected | Fault is limited to named proxy/service |  |  |
|  | Invariant probe | Expected domain behavior occurs |  |  |
|  | Fault restored | Dependency path heals |  |  |
|  | Recovery probe | Retry/reconciliation result is correct |  |  |
|  | Artifact collection | Required evidence preserved |  |  |
|  | Exact-project cleanup | Only drill resources removed |  |  |

## 4. Invariant result

Describe the durable state before and after the fault. For declaration scenarios, record declaration status, timeline/audit records, event/outbox records, notifications, and authorization result. For payment scenarios, record payment intent, payment state, declaration state, ledger/account state, external fake-gateway request count, and reconciliation state.

| Invariant | Expected result | Observed result | Evidence path / query | Pass / Fail |
| --- | --- | --- | --- | --- |
| No duplicate domain action |  |  |  |  |
| Transaction is atomic or explicitly compensable |  |  |  |  |
| Retry/idempotency behavior |  |  |  |  |
| Tenant/role authorization is fail-closed |  |  |  |  |
| Audit/event consistency |  |  |  |  |
| PII/secret redaction |  |  |  |  |

## 5. Observability evidence

| Signal | Expected | Observed | Link / artifact | Pass / Fail |
| --- | --- | --- | --- | --- |
| Prometheus metric |  |  |  |  |
| Grafana panel |  |  |  |  |
| Alert state and receiver |  |  |  |  |
| Loki/journal diagnostic after container destruction |  |  |  |  |
| Collector lifecycle event/heartbeat |  |  |  |  |
| Redaction scan | No secret/PII exposure |  |  |  |

## 6. Cleanup and artifact integrity

| Check | Expected | Observed | Result |
| --- | --- | --- | --- |
| Compose project cleanup | Containers, network, and volumes for this project removed |  | Pass / Fail |
| Scope control | No unrelated host/container/volume was touched |  | Pass / Fail |
| Artifact bundle | Logs, Compose state, proxy config, metric snapshot, scenario JSON, and checksums retained |  | Pass / Fail |
| Artifact sensitivity | No production data, credential, token, or unredacted PII |  | Pass / Fail |

## 7. Exceptions and follow-up

State any deviation from the scenario plan. Classify every failed assertion as one of: **product defect**, **test defect**, **environment defect**, or **observability gap**. A failed release drill is not accepted by marking it as informational.

| Finding | Classification | Severity | Owner | Tracking issue | Target date |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## 8. Release disposition

> **Disposition:** `PASS / FAIL / PASS WITH APPROVED EXCEPTION`

A **PASS** requires all safety checks, invariants, observability checks, and exact-project cleanup to pass. A **PASS WITH APPROVED EXCEPTION** requires a documented compensating control, named owner, expiration date, and explicit platform/security/release-manager approval. A **FAIL** blocks release promotion until the issue is resolved or a formally approved exception exists.

| Role | Name | Decision | Date | Notes |
| --- | --- | --- | --- | --- |
| Scenario owner |  |  |  |  |
| Platform/SRE |  |  |  |  |
| QA/automation |  |  |  |  |
| Security/privacy |  |  |  |  |
| Release manager |  |  |  |  |
