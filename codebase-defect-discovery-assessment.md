# Codebase Defect-Discovery Assessment

**Standard applied:** `codebase-defect-discovery-prompt.pdf`
**Assessment target:** current dirty SingleWindow worktree
**Decision:** **BLOCKED** — this is a partial evidence-bound audit, not a claim that the 16-family defect universe is exhausted.

## Executive summary

The traced financial execution paths contained a confirmed critical composition chain: a caller could invoke payment confirmation with no verified provider callback, the router could fabricate a Mojaloop-looking ID, a workflow outage was caught, and local payment/declaration status was written as terminal. Separately, the worker converted a Mojaloop outage into simulated success and committed the queue. Fund-flow authorization and idempotency were declared but either unused or fail-open, while direct batch queue insertion allowed caller-selected account pairs.

The following fail-closed remediations have been implemented and locally verified: provider-outage simulation has been removed from the payment worker; payment confirmation now requires a transfer reference, fails closed on workflow rejection/unavailability, and only reports `confirmation_submitted` rather than terminal settlement; Redis-backed payment locks and fund-flow idempotency now fail closed; and direct batch queue insertion is administrator-only. The builds and focused regression suites passed, but no real PostgreSQL/Redis/provider/staging verification was possible in this Docker-less environment.

| Classification | Count | Notes |
|---|---:|---|
| Confirmed critical findings | 10 | DD-001, DD-003, DD-004, DD-007, DD-008, DD-010 through DD-014 |
| Confirmed high findings | 3 | DD-002, DD-005, DD-006, DD-015 (one additional high makes four total high records) |
| Confirmed medium findings | 2 | DD-009, DD-016 |
| Suspected findings | 8 | Require complete caller/deployment trace before severity or remediation claim |
| Verified local remediations | 4 | Payment worker, payment confirmation, locks/idempotency, queue authorization |

> The numerical count is a discovery count, not a release score. Mandatory gates remain failed until real dependencies and the full F1–F16 sweep are completed.

## Ground-truth coverage

The source-derived service, money, trust-boundary, gate, and configuration baseline is in [`assurance/defect-discovery-ground-truth.md`](assurance/defect-discovery-ground-truth.md). It identifies the Node gateway, PostgreSQL test harness, RustFS listener, Go gRPC registration gap, payment/ledger tables, Permify, TigerBeetle, Mojaloop, Keycloak, Kafka, and the environment-default surface.

| Map | Coverage | Limitation |
|---|---|---|
| Service map | Partial | Every configured internal URL still requires listener/route/deployment cross-check. |
| Money map | Partial | Payment, batch queue, bonds, declarations, and cost paths identified; all value mutations not yet traced. |
| Trust-boundary map | Partial | Provider, ledger, policy, identity, broker, and notification clients identified; no live endpoint verification. |
| Gate map | Partial | tRPC procedures, fund-flow Permify declaration, idempotency, and CSRF path reviewed; all privileged mutations not covered. |
| Config map | Partial | Extensive localhost/defaults and address conflicts recorded; production environment validation not run. |

## Confirmed findings and current disposition

| ID | Title | Evidence | Disposition |
|---|---|---|---|
| DD-001 | Local terminal payment confirmation after workflow acceptance | `server/routers/payments.ts:145-226` | **Locally remediated:** no fake transfer ID; workflow failure rejects; no terminal writes in request handler. Real callback still absent. |
| DD-002 | Initiation reports queued despite queue/idempotency failure | `server/routers/payments.ts:62-133` | Open; needs transactional outbox/queue contract. |
| DD-003 | Fund-flow idempotency fail-open | `server/routers/fund-flow.ts:49-71` | **Locally remediated:** Redis outage returns typed failure. |
| DD-004 | Import duty lacks owner/policy check and uses `Number` amount conversion | `server/routers/fund-flow.ts:122-147` | Open; needs authoritative ownership/policy and exact-money contract. |
| DD-005 | Bond retry uses random identity as idempotency key | `server/routers/fund-flow.ts:241-265` | Open; needs stable request idempotency contract. |
| DD-006 | Drawback durable status is draft while API reports submitted | `server/routers/fund-flow.ts:168-193` | Open; needs lifecycle specification and ownership trace. |
| DD-007 | Developer portal issues phantom API keys and uses fallback secret | `server/routers/devPortal.ts:19,51-101` | Open; must fail closed on persistence/configuration failure. |
| DD-008 | Direct batch queue accepts arbitrary account pairs, non-atomic idempotency | `server/routers/batchPayments.ts:33-64` | **Partially remediated:** direct enqueue now administrator-only. Transaction/uniqueness design remains open. |
| DD-009 | Account balances convert precise values through `Number` | `server/routers/batchPayments.ts:107-126` | Open; preserve integer/decimal representation through API. |
| DD-010 | Shared payment lock fail-open during Redis outage | `server/_core/distributedLock.ts:71-110` | **Locally remediated:** unavailable lock service now rejects. |
| DD-011 | Declared Permify gate is unused by fund-flow routes | `server/routers/fund-flow.ts:4-12,92-115` | Open; requires resource/action map and policy-service integration. |
| DD-012 | Worker simulates successful settlement on provider outage | `server/paymentWorker.ts:88-100` | **Locally remediated:** outage becomes retryable failure. |
| DD-013 | Local fulfilment and HTTP 202 treated as settlement | `server/paymentWorker.ts:65-76,146-169` | Open; requires official Mojaloop lifecycle/status-query contract. |
| DD-014 | Queue commit, account mirror, and transaction record not atomic | `server/paymentWorker.ts:215-247` | Open; requires ledger/outbox/reconciliation design. |
| DD-015 | Worker marks all eligible rows processing, then slices only 50 | `server/paymentWorker.ts:329-384` | Open; requires bounded database-side claim query. |
| DD-016 | Worker processed-total telemetry never receives a count | `server/paymentWorker.ts:318,397-416` | Open; return actual processed count and test metric. |

The full file/line evidence, negative results, and suspected register are in [`assurance/defect-discovery-register.md`](assurance/defect-discovery-register.md).

## Suspected findings needing completion traces

The audit recorded suspected issues for developer-portal rate limiting, ASEAN offline synthetic status, AI risk fallbacks, operational dashboard zero/empty results, service-default address conflicts, and audit durability. They are deliberately not promoted to confirmed findings until their callers, user-facing consumers, and deployment paths are traced.

## Remediation verification

| Check | Result |
|---|---|
| `pnpm check` | Passed after every remediation round. |
| Focused payment-worker, payment, fund-flow, batch-payment, and business-rule suites | Passed: 112 tests in the consolidated run. |
| `pnpm build` | Passed; existing analytics-environment and large-chunk warnings remain. |
| `validate-no-fabricated-cost-data.mjs` | Passed. |
| Structural assurance-manifest validation | Passed; release enforcement remains intentionally blocked. |
| Full suite / PostgreSQL harness / Redis fault tests | Not run; Docker and Compose unavailable. |

## Release prerequisites and residual register

| Required item | Owner needed | Trigger to revisit |
|---|---|---|
| Official Mojaloop callback, signature, status-query, unknown-outcome, and reconciliation contract | Payments/treasury owner and provider | Before enabling terminal payment confirmation or fulfilment handling. |
| TigerBeetle ledger posting and durable outbox atomicity contract | Ledger/platform owner | Before resolving DD-002, DD-013, DD-014. |
| Permify resource/action model for every fund-flow scenario | Authorization owner | Before wiring mandatory fail-closed gate to DD-004/DD-011. |
| Exact money representation and rounding policy | Finance/ledger owner | Before replacing `Number` paths. |
| Docker-capable trusted runner and isolated PostgreSQL/Redis environment | Platform owner | Before full tests, worker concurrency tests, and release drills. |
| Provider sandbox credentials and staging target inventory | Release owner | Before real transaction, callback, timeout, and reconciliation evidence. |
| Go bindings, service registration decision, and Go toolchain | Service owners | Before closing gRPC reachability gap. |
| Complete F1–F16 caller/deployment sweep | Engineering/security owners | Before any claim of defect-discovery completeness. |

## Release disposition

**BLOCKED.** The implemented changes remove several direct fabrication and fail-open paths, but unresolved confirmed critical findings remain and real-dependency proof is absent. Release approval would violate the attached standard until the open items are remediated, every internal dependency and money mutation is fully traced, and the completed fixes are independently exercised against real isolated dependencies and the official provider sandbox.

## References

[1]: [Attached defect-discovery standard](file:///home/ubuntu/upload/codebase-defect-discovery-prompt.pdf)
[2]: [Ground-truth baseline](assurance/defect-discovery-ground-truth.md)
[3]: [Defect register](assurance/defect-discovery-register.md)
[4]: [Consolidated local validation log](file:///home/ubuntu/singlewindow-audit/defect-discovery/consolidated-remediation-validation.log)

## Latest repository-only P1 remediation

A central production configuration gate is now implemented in `server/_core/env.ts`. `validateProductionConfig()` rejects missing core database, identity, authorization, Redis, payment-provider, workflow, ledger, and key-hash settings, as well as localhost/loopback endpoints for the core production dependency set. It executes at process initialization only when `NODE_ENV=production`, preserving explicit local/test behavior. Focused coverage in `server/env.production.test.ts` verifies a valid non-local configuration and rejection of missing payment-provider and loopback policy-service configuration.

The latest feasible verification used a frozen script-disabled dependency materialization, peer validation, a zero-vulnerability production dependency audit, TypeScript checking, production build, 188 focused tests, no-fabricated-cost-data validation, structural assurance-manifest validation, release-drill workflow validation, and whitespace checks. Docker/Compose, provider sandbox, staging identity/policy/ledger dependencies, Go/Rust toolchains, security scanners/SBOM tooling, deployment/rollback, and restore evidence remain unavailable; these are still mandatory release gates rather than completed P0/P1 fixes.
