# SingleWindow Comprehensive P0/P1 Release Checklist

**Decision rule:** The release is **BLOCKED** until every mandatory P0 and P1 line item is marked **Passed** with an immutable evidence reference. A local unit test, mock, structural validator, or configuration file is not sufficient evidence for a real-dependency, provider, deployment, recovery, or security gate.

> This checklist is intentionally fail-closed. “Not run,” “not supplied,” “not authorized,” “not available,” or “in progress” means the gate is **not passed**.

## Release-control record

| Field | Required value before approval |
|---|---|
| Candidate revision | Immutable commit SHA and signed/tagged release candidate |
| Source provenance | Clean checkout from reviewed revision; frozen dependency materialization with scripts enabled |
| Change authority | Named release manager, platform owner, security owner, finance/ledger owner, and business owner |
| Environment | Isolated authorized staging; target inventory checked and approved |
| Evidence archive | Immutable artifact location, retention period, access control, and digest |
| Final decision | Written release approval only after every P0/P1 row is passed |

## P0 — mandatory integrity, money, identity, and execution gates

| ID | Gate and owner | Required execution and evidence | Pass criterion | Current status |
|---|---|---|---|---|
| P0-01 | **Immutable candidate** — Release manager | Create reviewed commits, clean checkout, `pnpm install --frozen-lockfile`, build artifact digest/provenance, and change log. | Candidate SHA, artifact digest, and clean status are attached to the release record. | **Blocked:** working tree is uncommitted. |
| P0-02 | **Real PostgreSQL harness** — Platform/QA | Execute `scripts/test-with-postgres.sh` on an authorized Docker runner using a unique `TEST_COMPOSE_PROJECT`; retain full test and cleanup logs. | Full suite passes against isolated PostgreSQL 16; no DB-dependent test is skipped; containers/volumes are removed or explicitly retained for diagnosis. | **Blocked:** Docker/Compose unavailable here. |
| P0-03 | **Database migration, rollback, and restore** — DBA/Platform | Apply production-shaped migration to disposable staging data; execute approved rollback decision; restore backup; compare row counts, checksums, declarations, payments, ledgers, and audit trails. | Evidence proves forward migration, approved rollback/forward-fix choice, restore integrity, and RPO/RTO acceptance. | **Blocked:** no approved staging DB or recovery plan. |
| P0-04 | **Payment provider sandbox** — Treasury/Payments | Run official provider sandbox initiate, callback authentication, status lookup, duplicate request, timeout/unknown-outcome, retry, reversal/refund where applicable, and reconciliation drills. | Every terminal status has provider evidence, ledger evidence, durable audit/outbox evidence, and reconciliation result. | **Blocked:** provider contract, sandbox target, and credentials absent. |
| P0-05 | **Ledger/TigerBeetle integrity** — Finance/Ledger | Exercise real ledger posting with debit/credit legs, balanced invariant checks, idempotent replay, duplicate callback, partial failure, and reconciliation. | No unbalanced/duplicate postings; exact minor-unit amounts match provider/reconciliation records. | **Blocked:** authoritative ledger contract and staging endpoint absent. |
| P0-06 | **Confirmation callback trust** — Payments/Security | Define and test authenticated provider callback route, signature/JWS/HMAC verification, replay prevention, timestamp tolerance, status lookup, and unknown-outcome behavior. | Unauthenticated/replayed/invalid callbacks deny; only verified provider-and-ledger completion can make terminal state. | **Blocked:** authoritative callback scheme absent. |
| P0-07 | **Policy and authorization fail-closed** — Authorization owner | Deploy real Permify/identity endpoint; test tenant isolation, least privilege, outage denial, privileged fund-flow operations, officer/admin role mapping, and durable decision audit. | Every tested unauthorized or outage request is denied; correct authorized request succeeds with tenant-scoped audit evidence. | **Blocked:** policy resource/action model and endpoint absent. |
| P0-08 | **KYC/KYB, risk, and declaration gates** — Compliance/Product | Provide approved lifecycle and risk policy; test KYC pending/rejected/approved, ownership, officer decision, provider outage, declaration transition, and clearance effects. | No lifecycle or clearance bypass; exact policy outcomes match signed acceptance criteria. | **Blocked:** authoritative policy and provider sandbox evidence absent. |
| P0-09 | **Exact money and idempotency policy** — Finance/Payments | Approve currency exponent, rounding, amount bounds, stable client idempotency key/payload binding, expiry, replay, and conflicting-payload policy; test against real Postgres/Redis/provider. | No JavaScript precision loss; duplicate/conflict behavior matches policy and cannot double post. | **Blocked:** signed policy and real integration evidence absent. |
| P0-10 | **Payment queue concurrency/recovery** — Platform/Payments | On PostgreSQL/Redis staging, run multi-worker bounded-claim, provider timeout, worker crash, recovery, dead-letter, retry, and reconciliation drills. | At most one active claim/settlement per transfer; bounded batch behavior observed; no stranded/duplicated value transfer. | **Blocked:** Docker/Redis/provider environment unavailable. |
| P0-11 | **Release-drill scenarios RD-1–RD-8** — Release manager | Run only with approved target inventory and adapters; archive scenario inputs, faults, logs, metrics, and outcome reports. | Every mandatory scenario passes on real isolated dependencies/official sandbox; no fake adapter evidence is accepted. | **Blocked:** staging inventory, adapters, credentials, and authorization absent. |
| P0-12 | **Go/gRPC exposure decision** — Service owners | Either generate/commit bindings, compile, test, and call actual authenticated declaration/payment/OGA/profile services; or formally retire/remove the exposed interfaces. | No commented/unregistered production interface remains reachable or claimed as available. | **Blocked:** Go toolchain/bindings/owner decision absent. |

## P1 — mandatory security, deployment, observability, and operational gates

| ID | Gate and owner | Required execution and evidence | Pass criterion | Current status |
|---|---|---|---|---|
| P1-01 | **Secrets and dependency security** — Security | Run secret scan, production dependency audit, container/image scan, SBOM, license review, and exception workflow on immutable candidate. | No unapproved high/critical finding; SBOM and scan reports are attached. | **Blocked:** Gitleaks, Trivy, and Syft unavailable. |
| P1-02 | **Configuration validation** — Platform/Security | Validate production config rejects localhost/test/default secrets, mismatched service addresses, missing required keys, and unapproved sandbox selection. | Deployment fails before serving traffic on invalid/unsafe configuration. | **Blocked:** production config contract and deployed validation evidence absent. |
| P1-03 | **Deployment and rollback** — Platform/Release | Deploy immutable candidate using approved method; run smoke/readiness checks; execute rollback or approved forward-fix decision; retain manifests and logs. | Deployment and rollback meet budget; no data loss or silent degraded dependency. | **Blocked:** no staging deployment authorization. |
| P1-04 | **Observability/alert delivery** — SRE | Deploy Prometheus, Loki/log forwarding, dashboards, and alert routes; perform queue delay, runner loss, failed/blocked drill, and post-destruction log-retrieval tests. | Alerts fire, route, acknowledge, and resolve; durable logs and dashboard evidence are retained. | **Blocked:** observability assets are not deployed. |
| P1-05 | **Audit and reconciliation durability** — Compliance/Finance | Verify durable DB audit/outbox writes, event delivery/replay, provider/ledger/payment reconciliation, and investigation queries under failure. | Critical action remains traceable; reconciliation variance is zero or formally resolved. | **Blocked:** no real services or approved audit retention rules. |
| P1-06 | **Performance and capacity** — Product/SRE | Establish approved latency, throughput, queue age, concurrency, RPO/RTO, and error budgets; run load and soak tests against isolated staging. | Results meet signed budgets; capacity risks have accepted mitigations. | **Blocked:** budgets and staging capacity absent. |
| P1-07 | **Incomplete-marker disposition** — Engineering/Security | Semantically classify every reachable P0/P1 marker in `assurance/incomplete-implementation-inventory.md` by owner, reachability, risk, disposition, and regression proof. | No reachable critical marker lacks a fix, retirement decision, or accepted exception. | **Blocked:** 739 raw marker hits are not fully classified. |
| P1-08 | **Test coverage for new hardening** — Engineering | Add focused negative-path tests for developer API-key secret/persistence/rate-limit failure, lock unavailability, queue bounded claim/concurrency, and payment confirmation failure. | Tests exist, run in CI, and complement—not replace—real dependency drills. | **Blocked:** no dedicated developer-portal or distributed-lock test suite. |
| P1-09 | **Release governance and incident readiness** — Release/SRE/Business | Approve on-call roster, rollback authority, support/communication plan, runbooks, incident command, and finance/compliance sign-off. | Named owners acknowledge readiness and decision authority before release. | **Blocked:** approvals not supplied. |

## Docker PostgreSQL execution gate

Run only on an authorized Docker-capable host. The commands below create an isolated PostgreSQL 16 environment rather than connecting to developer or shared production data.

```bash
cd /path/to/singlewindow

docker --version
docker compose version
pnpm install --frozen-lockfile

# All Vitest suites with a uniquely named disposable database project.
TEST_COMPOSE_PROJECT="singlewindow-full-$(date +%s)" \
  scripts/test-with-postgres.sh

# Only the formerly database-dependent suites.
TEST_COMPOSE_PROJECT="singlewindow-db-$(date +%s)" \
  scripts/test-with-postgres.sh \
  server/v79.test.ts server/v80.test.ts server/v81.test.ts server/v82.test.ts server/v83.test.ts

# Diagnose a failure while retaining the container.
TEST_COMPOSE_PROJECT=singlewindow-debug TEST_POSTGRES_PORT=55433 \
  scripts/test-with-postgres.sh --keep server/v81.test.ts

docker compose --project-name singlewindow-debug \
  --file infra/test-environment/compose.yml exec postgres \
  psql -U tradegateway -d tradegateway_test

docker compose --project-name singlewindow-debug \
  --file infra/test-environment/compose.yml down --volumes --remove-orphans
```

## Final approval record

| Approver | Role | Decision | Date/time | Evidence digest |
|---|---|---|---|---|
| Release manager | Release authority | Pending | — | — |
| Security owner | Security gate | Pending | — | — |
| Finance/ledger owner | Funds and reconciliation | Pending | — | — |
| Authorization/compliance owner | Policy/KYC/tenant controls | Pending | — | — |
| Platform/SRE owner | Deployment, rollback, observability | Pending | — | — |
| Business owner | Product/legal operating acceptance | Pending | — | — |

## References

[1]: [Database-dependent failure breakdown and harness runbook](database-failure-breakdown-and-release-unblock-plan.md)
[2]: [Incomplete implementation inventory](assurance/incomplete-implementation-inventory.md)
[3]: [Defect-discovery register](assurance/defect-discovery-register.md)
[4]: [Exact requested source diff](file:///home/ubuntu/singlewindow-audit/release-checklist/bounded-worker-and-devportal-exact.diff)
