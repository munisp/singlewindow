# Defect-Discovery Ground-Truth Baseline

**Standard:** attached codebase-defect-discovery prompt
**Assessment target:** current dirty `singlewindow` worktree
**Status:** Phase 0 baseline in progress; this document is not a release approval.

## Service map — partial, source-derived

| Component | Source evidence | Listener / route evidence | Status |
|---|---|---|---|
| Node trade gateway | `server/_core/index.ts` and compiled `dist/index.js` | Compiled server calls `server.listen(port)` and logs `http://localhost:<port>/`. Exact source bind and deployment port reconciliation remain required. | Partial |
| RustFS service | `rustfs-svc/main.go:419-421` | `http.ListenAndServe(addr, mux)` | Confirmed listener; route inventory pending |
| Go declaration/payment/OGA/profile services | `services/go/*/grpc_server.go` | gRPC server starts, but application-service registration calls are commented. | Confirmed high-risk interface gap |
| PostgreSQL integration harness | `infra/test-environment/compose.yml:1-18` | Isolated PostgreSQL 16 host port `55432` by default | Confirmed test-only dependency |

## Money map — initial scope

| Value-bearing component | Source evidence | Mutation surface requiring end-to-end trace |
|---|---|---|
| Payments | `drizzle/schema.ts:228`; `server/routers/payments.ts`; `server/routers/batchPayments.ts` | initiation, confirmation, cancellation, queue retry, reconciliation |
| Payment accounts and idempotency | `drizzle/schema.ts:1567-1602`; `server/routers/batchPayments.ts:43-102` | account updates, idempotency-key creation, retry/dead-letter transitions |
| Bonds and duty drawback | `drizzle/schema.ts:572`, `2322`; `server/routers/fund-flow.ts`; `server/routers/bondedWarehouse.ts` | lodgement, release, claim, inventory/value transitions |
| Declaration duties / clearance | `server/routers/declarations.ts`; `server/businessRules.ts` | declaration lifecycle, duty calculation, payment-confirmed / clearance transitions |
| Cost records | `drizzle/schema.ts:1779`; `server/routers/cost.ts` | authorized record entry and upstream-to-database fallback |

## Trust-boundary map — initial scope

| Boundary | Source evidence | Required verification |
|---|---|---|
| TigerBeetle bridge | `server/routes/health.ts:113`; TigerBeetle router/client references | Verify deployed service, API method, durable ledger legs, failure polarity |
| Permify authorization | `server/routes/health.ts:133`; `server/_core/permify.ts` | Verify endpoint, tuple write/read failure polarity, tenant scope |
| Payment / Mojaloop integration | `services/go/mojaloop-gateway`; payments/fund-flow routers | Verify official sandbox URL, signatures, idempotency, callbacks/reconciliation |
| Keycloak / OAuth | server auth middleware and OAUTH configuration | Verify real session/token validation and privileged-route enforcement |
| Kafka / notifications / KYC providers | router and helper fetch/client calls | Cross-check each URL/route to a running service map and failure result |

## Gate map — initial scope

| Gate | Declaration | Required trace |
|---|---|---|
| tRPC authentication / administrator checks | `protectedProcedure`, `adminProcedure` across routers | Ownership and tenant constraint after role check |
| KYC / risk / declaration lifecycle | `server/routers/declarations.ts`, `server/businessRules.ts` | Least-privileged call path and provider-outage polarity |
| Idempotency | payment queues and payment router | Unique DB constraint plus payload binding and retry behavior |
| Step-up / MFA | security/auth helpers and financial mutations | Top money-at-risk mutations must consume a fail-closed step-up gate |

## Config map — initial scope

| Configuration class | Source evidence | Required finding sweep |
|---|---|---|
| Localhost/default external endpoints | `server/routes/health.ts`; integration helpers | Confirm defaults cannot be selected in production and route/port exists |
| Test-only database behavior | `server/db.ts` `VITEST`/`NODE_ENV=test` branches | Prove unreachable in production and exclude from release evidence |
| Payment, ledger, identity and policy environment | environment-use inventory at `singlewindow-audit/defect-discovery/phase0-raw-inventory.log` | Identify every default, fallback secret, mock/sandbox selector, and production kill switch |

## Baseline limits

The attached standard requires complete service, money, trust, gate, and config maps before declaring a broad defect sweep complete. The current source-derived baseline identifies high-risk systems and exact evidence locations, but does **not** yet cross-check every internal URL, every money mutation, or every environment default. All later findings must remain `SUSPECTED` unless their complete executable path is traced.
