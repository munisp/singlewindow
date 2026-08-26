# Real-Integration Release-Drill Adapter Contract

RD-2 through RD-8 are **not valid release evidence** until an approved adapter invokes the actual staging deployment, isolated PostgreSQL/database, identity/authorization implementation, and official payment-provider sandbox or a documented protocol-faithful equivalent approved by the control owner. This repository intentionally does not invent endpoint paths, credentials, money semantics, authorization policies, or reconciliation queries.

## Required deployment inputs

The staging platform owner supplies the following at runtime through secret files or the CI environment. Do not commit any value, certificate, DSN, access token, payment credential, or target hostname.

| Input | Purpose |
| --- | --- |
| `DRILL_APPROVED_TARGETS_FILE` | One exact allowed staging/sandbox hostname per line. |
| `DRILL_API_BASE_URL` | HTTPS public/API-gateway endpoint of the isolated staging deployment. |
| `DRILL_PAYMENT_SANDBOX_URL` | HTTPS endpoint of the approved official payment sandbox or approved real implementation. |
| `DRILL_AUTHORIZATION_URL` | HTTPS endpoint of the real staging policy/identity service. |
| `DRILL_DATABASE_DSN_FILE` | Protected file containing the isolated staging PostgreSQL DSN. |
| `DRILL_REAL_ADAPTER_DIR` | Protected path containing scenario adapters reviewed by domain, security, and SRE owners. |

The environment validator checks the explicit staging consent, unique project, HTTPS targets, target inventory, and rejects local fake services, loopback, and production-like names before Docker is called.

## Adapter interface

For scenario `RD-N`, provide an executable `${DRILL_REAL_ADAPTER_DIR}/RD-N.sh`. The harness passes one argument: the absolute destination path for a result JSON file. The adapter must exit nonzero on every failed safety check, failed operation, missing evidence query, or invariant failure. It must never convert a failure into a passing JSON result.

The adapter must use real protocol clients and actual staging/sandbox credentials supplied at runtime. It must issue only synthetic data with a unique drill correlation ID and must clean up or mark test data according to the approved staging retention policy.

The adapter writes JSON in the following common shape:

```json
{
  "scenario_id": "RD-4",
  "result": "passed",
  "environment": "staging",
  "started_at": "2026-08-25T20:00:00Z",
  "finished_at": "2026-08-25T20:03:00Z",
  "invariant": "Exactly one durable payment identity exists for the idempotency key.",
  "evidence": {
    "provider_mode": "official-sandbox",
    "test_double": false
  }
}
```

The common fields are mandatory. `result` must equal `passed`, `environment` must equal `staging`, and `evidence.test_double` must not be `true`. `provider_mode` must not be `fake` or `mock`.

## Required evidence fields

| Scenario | Required `evidence` keys |
| --- | --- |
| RD-2 | `declaration_before`, `declaration_after`, `audit_records`, `outbox_records`, `retry_result`, `database_fault` |
| RD-3 | `payment_before`, `payment_after`, `declaration_after`, `ledger_records`, `reconciliation`, `database_fault` |
| RD-4 | `payment_intent`, `provider_operation`, `provider_status_lookup`, `duplicate_request_result`, `reconciliation` |
| RD-5 | `domain_state`, `notification_delivery`, `retry_or_outbox`, `redaction_scan` |
| RD-6 | `authorization_request`, `deny_result`, `cross_tenant_result`, `audit_records` |
| RD-7 | `project_resources_before`, `project_resources_after`, `unrelated_resources_untouched`, `artifact_bundle` |
| RD-8 | `destroyed_runner_log`, `collector_metric`, `prometheus_query`, `grafana_panel`, `alert_state` |

Evidence values should be privacy-safe paths, record counts, redacted query output, or signed/correlated references. Do not include credentials, raw PII, account details, or full payment payloads in JSON, logs, metrics, or artifacts.

## Required business decisions before RD-2 through RD-4

The authoritative owner must supply the declaration state-transition table, payment amount/precision/currency policy, idempotency-key scope and payload-binding policy, external provider operation identity, transaction/ledger invariants, reconciliation definition, retry/unknown-outcome policy, and approval/authorization rules. Missing or conflicting rules block the corresponding scenario rather than being inferred from existing UI text or tests.
