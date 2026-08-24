# Codebase defect discovery audit — TradeGateway / NGSWTP single window

**Repository:** `munisp/singlewindow` (`main`)
**Method:** static, evidence-bound tracing of executable source and deployment manifests. Every finding carries `file:line` evidence and a quoted offending line. `CONFIRMED` means the reachable path was traced end to end in source; `SUSPECTED` means the defect is present but reachability or deployment exposure was not fully established.

## Executive summary

The platform presents itself as a national single window that assesses duties, settles them over Mojaloop, mirrors settlement into a TigerBeetle ledger, screens traders against sanctions/risk services, and produces an audit trail for regulators. In the code, most of those guarantees degrade into locally fabricated success:

1. **Money can be marked settled without any payment rail participating.** `payments.confirm` writes `status: "confirmed"` after a *failed* Temporal call; `mojaloop.getPaymentStatus` — a read query — flips a transfer to `COMMITTED` and posts a revenue-credit ledger entry purely on elapsed wall-clock time; the payment worker treats "Mojaloop unreachable" as a successful transfer.
2. **The ledger of record is optional.** Every value-bearing `ledger.*` procedure falls back to writing a `status: "posted"` row directly into Postgres when the TigerBeetle bridge is unreachable, so bonds, penalties, guarantees and duty transfers exist as authoritative ledger entries that no double-entry system ever accepted.
3. **Compliance gates fail open.** Payment risk scoring defaults to `LOW / APPROVE` when the scorer is down; the fund-flow Permify helper returns `true` on error (and is never called anyway); the final risk-scoring fallback can never produce a red lane; valuation checks return `flagged: false` on DB outage.
4. **Authorization can be self-granted.** Any authenticated user can set their own role to `customs_officer`, `oga_officer`, `inspector` or `finance`; the entire post-clearance audit engine is `publicProcedure`; payment amounts, trader IDs and ledger account IDs are caller-supplied.
5. **Webhook authentication is nominal.** The Mojaloop settlement callback is a public procedure comparing a body field to a hardcoded `"dev-webhook-secret"` default; OGA and CEP webhooks ship committed dev secrets; the sanctions and Keycloak webhooks disable verification entirely when their env var is unset — and the `validateWebhookSecrets()` guard written to prevent exactly this is **never called**.
6. **`JWT_SECRET` has an empty-string default** and is absent from the production env validation list.

Ranked by money-at-risk × reachability, the top chain is: *self-assign `finance` role → initiate a Mojaloop payment for an arbitrary amount → poll `getPaymentStatus` twice → declaration duty shows settled and customs revenue is credited in the ledger*, with no external system involved and a complete-looking audit trail attributing the settlement to `system`.

---

## Phase 0 — ground truth maps

### 1. Service map (from source and manifests, not docs)

| Component | Entry point | Notes |
|---|---|---|
| TypeScript monolith (API + tRPC + SSR) | `server/_core/index.ts:1516` (`PORT` default 3000) | ~102 tRPC routers mounted at `/api/trpc` (`server/_core/index.ts:1500-1508`) |
| Container / k8s base | `Dockerfile:60` `EXPOSE 3000`, `k8s/base/service.yaml:11` | agrees with source |
| Helm chart | `helm/tradegateway/values.yaml:24-25` (port/targetPort 9000) | **disagrees** with source and base manifests |
| Go microservices | `microservices/trade-finance-service/cmd/main.go:597`, `microservices/ucr-service/cmd/main.go:526`, `services/go/declaration-service/main.go:549`, `services/go/wazuh-svc/internal/server/server.go:450` | several duplicate service families in `microservices/` and `services/go/` with different declared ports |
| Python services | `microservices/sanctions-service/main.py:305`, `services/python/deltalake-svc/main.py` | risk/AI/analytics |
| Rust services | `services/rust/tigerbeetle-bridge-rs/`, `services/rust/hs-classifier/` | duplicate of Go TB bridge |
| External dependencies | Temporal, Kafka, Redis, TigerBeetle (via bridge), Mojaloop switch, Keycloak, Permify, OpenSearch, Wazuh, OpenCTI | all reached over HTTP with per-call health probes |

### 2. Money map

| Value-bearing table | Written by | Debit / credit / hold semantics |
|---|---|---|
| `declarations.dutyAmount/vatAmount/totalDue` | `server/routers/declarations.ts:269-271` | assessed as flat 10% duty + 15% VAT of the *client-supplied* invoice value; no tariff table, no CIF freight/insurance, no FX conversion |
| `payments` | `server/routers/payments.ts` (`initiate`, `confirm`) | `pending → confirmed`; confirmation is terminal and reversible only by admin paths |
| `payment_queue` | `server/paymentWorker.ts` | `pending → committed`; commit drives balance mirrors |
| `mojaloop_transactions` | `server/routers/mojaloop.ts` | `PENDING → PROCESSING → COMMITTED/ABORTED` |
| `ledger_entries` | `server/routers/ledger.ts`, `server/routers/mojaloop.ts:389`, `:504` | double-entry mirror of TigerBeetle: duty payments, bond deposits/releases, penalties, transit guarantees — `status: "posted"` |
| `drawback_claims`, bonds, guarantees, penalties, refunds | `server/routers/fund-flow.ts` | debits/credits/holds and releases against trader and revenue accounts |

Holds and releases (bonds, transit guarantees) are represented only as ledger rows; there is no balance invariant check anywhere in the TypeScript path.

### 3. Trust-boundary map

* **Unauthenticated HTTP ingress:** `POST /api/webhooks/sanctions-hit` (`server/webhooks/sanctions.ts:40`), `POST /api/webhooks/keycloak-event` (`server/_core/index.ts:1306`), `POST /api/webhooks/oga`, `POST /api/webhooks/cep-event`, `GET /api/verify/:certNumber`, seven `POST /api/scheduled/*` handlers (`server/_core/index.ts:1451-1499`, only the tenant-domain poller authenticates), `mojaloop.webhookCallback` (public tRPC procedure).
* **Payment rails / banks:** Mojaloop switch (`MOJALOOP_URL`), TigerBeetle bridge (`TB_BRIDGE_URL`), payment risk scorer (`PAYMENT_RISK_URL`).
* **KYC / AML / sanctions / risk:** sanctions service, Python ML risk scorer, LLM risk fallback (`invokeLLM`), GNN risk, CEN (WCO), OpenCTI.
* **Identity:** Keycloak (bearer + `X-Auth-Request-Groups` header), Nigeria NIN IdP, Manus session cookie, Permify PDP.
* **Admin control plane:** Wazuh playbooks, OpenSearch ILM (`POST /api/admin/opensearch/setup-ilm`), tenant/site settings, bulk export.

### 4. Gate map

| Gate | Where | Actual strength |
|---|---|---|
| `publicProcedure` | `server/_core/trpc.ts:83` | none — used by `auditEngine.*` and `mojaloop.webhookCallback` |
| `protectedProcedure` | `server/_core/trpc.ts:106` | session only; no role, no ownership |
| `adminProcedure` | `server/_core/trpc.ts:108` | role check on `ctx.user.role` — which the user can set themselves (F-01) |
| `keycloakRoleProcedure` | `server/_core/trpc.ts:147` | Keycloak realm/client role **or** DB role equivalence |
| CSRF | `server/_core/trpc.ts` `validateCsrf` | disabled unless `NODE_ENV=production` or `CSRF_ENFORCE_DEV=1` |
| Permify PBAC | `server/_core/permify.ts` | fail-closed, but fully bypassed when `DEMO_MODE=true` (`:53-55`); the `fund-flow` copy fails open and is never called |
| KYC tier gate | `server/routers/declarations.ts:230-238` | genuinely enforced on `submit` |
| Rate limits | `server/_core/security.ts`, mounted `server/_core/index.ts:1288-1297` | Redis-backed with in-memory fallback (per-process, bypassable by fan-out) |
| Amount thresholds | `SUPPORTED_FSPS` min/max (`server/routers/mojaloop.ts:63-130`) | per-FSP only; no aggregate or duty-matching check |
| 2FA / step-up | — | no step-up gate on any money movement |

### 5. Configuration map (fallback-bearing defaults)

| Variable | Default | Consequence |
|---|---|---|
| `JWT_SECRET` | `""` (`server/_core/env.ts:3`) | session signing key empty by default; **not** in the production required list (`:169-177`) |
| `MOJALOOP_WEBHOOK_SECRET` | `"dev-webhook-secret"` (`server/routers/mojaloop.ts:47`) | public settlement callback accepts a committed constant |
| `OGA_WEBHOOK_SECRET` | `"tradegateway-oga-webhook-secret-dev"` (`server/webhooks/oga.ts:17`) | permit approvals forgeable |
| `CEP_WEBHOOK_SECRET` | `"tradegateway-cep-webhook-secret-dev"` (`server/webhooks/cep.ts:28`) | alert injection |
| `SANCTIONS_WEBHOOK_SECRET` | `""` (`server/webhooks/sanctions.ts:25`) | empty secret **disables** verification |
| `KEYCLOAK_WEBHOOK_SECRET` | unset | verification block skipped entirely (`server/_core/index.ts:1308`) |
| `DEMO_MODE` | `false` | when `true`: Permify returns `true` for everything and `POST /api/demo/session` mints year-long privileged sessions |
| `REDIS_PASSWORD` | `"tradegateway_redis_2026"` (`server/_core/env.ts:35`) | committed credential |
| `TB_BRIDGE_URL` / `PAYMENT_RISK_URL` | `env.ts` says 8094/8104, `server/routers/ledger.ts` says `tigerbeetle-bridge:8093` / `localhost:8092` | divergent port maps; `8092` and `8093` are each claimed by three different services |
| App port | 3000 in source/Dockerfile/k8s base, 9000 in Helm | one deployment path health-checks a closed port |

---

## Findings

Severity is money/compliance impact × reachability. "User-facing lie" is the claim the system makes that the code does not honour.

### F1/F2 — phantom settlement and fabricated integration results (money)

| # | Title | Evidence | Status | Sev | Blast radius | User-facing lie |
|---|---|---|---|---|---|---|
| 01 | `payments.confirm` marks a payment `confirmed` after the Temporal workflow call fails | `server/routers/payments.ts:196-213` | CONFIRMED | CRITICAL | Every duty payment; declaration proceeds to clearance unpaid | "Payment confirmed" — no workflow, no rail, no ledger participation |
| 02 | `mojaloop.getPaymentStatus` (a **query**) settles the transfer on elapsed time and posts a revenue-credit ledger entry | `server/routers/mojaloop.ts:373-412` | CONFIRMED | CRITICAL | Any transfer ID, by any authenticated user (no ownership check) | "Settled via Mojaloop, fulfilment `<random 43 chars>`" — nothing left the process |
| 03 | Payment worker treats an unreachable Mojaloop switch as a successful transfer | `server/paymentWorker.ts:88-100` | CONFIRMED | CRITICAL | Whole payment queue; commits and updates balance mirrors | "Committed" with a derived ILP fulfilment |
| 04 | `mojaloop.webhookCallback` is public and compares a body field to a hardcoded default secret with `!==` | `server/routers/mojaloop.ts:47`, `:481-490` | CONFIRMED | CRITICAL | Any internet caller can commit/abort any known transfer ID | "Settlement confirmed by the Mojaloop switch" |
| 05 | Every value-bearing `ledger.*` procedure writes `status: "posted"` straight to Postgres when the TigerBeetle bridge is down | `server/routers/ledger.ts:160-174`, `:357-370`, `:400-413`, `:443-456`, `:486-499` | CONFIRMED | CRITICAL | Duty transfers, bond deposits/releases, penalties, transit guarantees | "Posted to the ledger" — the double-entry system never saw it; `_tag: "offline-stub"` is the only trace |
| 06 | Live Mojaloop transfer response is never inspected; errors are swallowed and the flow continues in simulation | `server/routers/mojaloop.ts:302-327` | CONFIRMED | HIGH | All Mojaloop initiations | "Transfer requested" regardless of a 4xx/5xx from the switch |
| 07 | `mojaloop.initiatePayment` accepts a client-supplied `amount` and an arbitrary `declarationId` with no ownership check and no comparison to `totalDue` | `server/routers/mojaloop.ts:215-232` | CONFIRMED | CRITICAL | Any declaration; pay 1 GHS against a 10 M assessment, then self-settle via #02 | "Duty paid in full" |
| 08 | ILP packet and fulfilment condition are fabricated: fixed 500000 amount, `Math.random()` condition unrelated to the packet | `server/routers/mojaloop.ts:135-145` | CONFIRMED | HIGH | All transfers; ILP crypto is decorative | "ILP packet / condition" implies interledger cryptographic commitment |
| 09 | FX rates are a hardcoded table serving `source: "Bank of Ghana (simulated)"` | `server/routers/mojaloop.ts:170-206` | CONFIRMED | MEDIUM | Any duty conversion | "Bank of Ghana rate, valid 5 minutes" |
| 10 | Mojaloop/ledger money is denominated in **GHS** (Ghana) while the platform, IdP and email identity are **Nigerian** (NGSWTP, NIMC, `tradegateway.gov.ng`) | `server/routers/mojaloop.ts:63-130` vs `server/_core/env.ts:23,62` | CONFIRMED | HIGH | Every amount and ledger entry | jurisdictional coherence of the whole money map |

### F3 — declared-but-unenforced gates

| # | Title | Evidence | Status | Sev | Blast radius | User-facing lie |
|---|---|---|---|---|---|---|
| 11 | `onboarding.selectRole` lets any authenticated user write `customs_officer` / `oga_officer` / `inspector` / `finance` into `users.role` | `server/routers/onboarding.ts:272-284` | CONFIRMED | CRITICAL | Every role-gated procedure, including `adminProcedure` peers | "Restricted to roles a user can self-assign" (code comment) |
| 12 | The entire post-clearance audit engine is `publicProcedure`: create/assign/submit findings/close/appeal | `server/routers/auditEngine.ts:7,50,89,102,135-182` | CONFIRMED | CRITICAL | Fabricate or close audits and duty-discrepancy records without a session | "Controlled audit actions" |
| 13 | `validateWebhookSecrets()` / `getWebhookSecret()` — the guard against dev webhook secrets in production — is **never called** anywhere | `server/_core/webhookSecretsValidator.ts:44,135`; no call sites | CONFIRMED | CRITICAL | All four webhook secrets | file header claims "Called at server startup. Throws a fatal error…" |
| 14 | `fund-flow`'s local `checkPermify()` has no call sites — the router's authorization is decorative *and* the helper fails open | `server/routers/fund-flow.ts:88-113` | CONFIRMED | HIGH | ~22 fund-flow money procedures | "Permify-authorized fund flow" |
| 15 | `tradeFinance.createLC` / `createBankGuarantee` / `listBGByTrader` forward caller-supplied `applicantId` / `traderId` | `server/routers/tradeFinance.ts:15-59,63-93,169-177` | CONFIRMED | HIGH | LCs and guarantees issued/enumerated under another trader's identity | "Your instruments" |
| 16 | `batchPayments` queue, account listing and balance queries are `protectedProcedure` with no role or tenant scoping | `server/routers/batchPayments.ts:107,128,180` | CONFIRMED | HIGH | Any trader reads all accounts, balances and the settlement queue | tenant isolation |
| 17 | `emitSecurityEvent`, `verifyAmountSignature`, `signAmount`, `checkIdempotency` are defined and never called, while `systemRouter` renders `getRecentSecurityEvents()` | `server/_core/security.ts`; `server/_core/systemRouter.ts:3,393` | CONFIRMED | MEDIUM | Security event feed is always empty; amount signing unused | "Security events" dashboard |

### F10/F6 — secrets, crypto and session integrity

| # | Title | Evidence | Status | Sev | Blast radius | User-facing lie |
|---|---|---|---|---|---|---|
| 18 | `JWT_SECRET` defaults to `""` and is not validated in production | `server/_core/env.ts:3,169-177` | CONFIRMED | CRITICAL | Session forgery for any `openId`, including admin | "Authenticated session" |
| 19 | Sanctions webhook verification is skipped when the secret is empty (the default) | `server/webhooks/sanctions.ts:25,44-52` | CONFIRMED | CRITICAL | Inject sanctions hits; auto-reject arbitrary declarations | "Only the sanctions service can report a hit" |
| 20 | Keycloak webhook skips HMAC entirely when the secret is unset and uses `!==` when set | `server/_core/index.ts:1306-1317` | CONFIRMED | HIGH | Forged identity-management audit events | "Signature-protected" |
| 21 | OGA and CEP webhooks ship working committed dev secrets as defaults | `server/webhooks/oga.ts:17`, `server/webhooks/cep.ts:28` | CONFIRMED | CRITICAL | Forge OGA permit approvals / CEP alerts | "HMAC-SHA256 verified" |
| 22 | Session revocation (JTI blacklist) fails open when Redis is unavailable | `server/_core/sdk.ts:255-263` | CONFIRMED | HIGH | Revoked/compromised sessions keep working | "Session revoked" |
| 23 | Default session lifetime is one year | `server/_core/sdk.ts:211`, `shared/const` `ONE_YEAR_MS` | CONFIRMED | MEDIUM | All sessions | — |
| 24 | `permify.can()` returns `true` for everything when `DEMO_MODE=true`, with no production interlock | `server/_core/permify.ts:53-55` | CONFIRMED | HIGH | All PBAC decisions | "Permify-enforced authorization" |
| 25 | `DEMO_MODE=true` also mounts `POST /api/demo/session`, minting year-long `admin`/`security`/`developer` sessions without authentication | `server/_core/index.ts:1429-1434`, `server/routes/demoAuth.ts:38-83` | SUSPECTED (flag-dependent) | HIGH | Full admin takeover in any environment with the flag on | "Demo mode is isolated presentation access" |

### F12 — error polarity / fail-open compliance

| # | Title | Evidence | Status | Sev | Blast radius | User-facing lie |
|---|---|---|---|---|---|---|
| 26 | Payment risk scorer unavailable ⇒ `riskScore 0.10 / LOW / APPROVE` | `server/routers/ledger.ts:300-312` | CONFIRMED | CRITICAL | Every payment risk decision | "Risk assessed LOW — approve" |
| 27 | Final risk-scoring fallback is an HS-code hash bounded to 10–49, so **no declaration can ever be red-laned** when both scorers are down | `server/routers/declarations.ts:150-160` | CONFIRMED | HIGH | All submissions during an outage; physical inspection never triggered | "Automated assessment", lane green/yellow |
| 28 | Fund-flow Redis idempotency returns "not duplicate" on any Redis error | `server/routers/fund-flow.ts:53-61` | CONFIRMED | HIGH | Duplicate refunds/drawbacks/penalties | idempotency-key guarantee |
| 29 | `valuation.checkUndervaluation` returns `flagged: false` when the DB is unavailable | `server/routers/valuation.ts:76-85` | CONFIRMED | HIGH | Undervaluation screening | "Passed valuation" |
| 30 | SLA-breach and document-expiry crons return `{ok: true, processed: 0}` on DB outage (and neither authenticates the caller) | `server/scheduled/slaBreachEscalation.ts:11-16`, `server/scheduled/documentVaultExpiry.ts:14-19`, mounted `server/_core/index.ts:1481-1489` | CONFIRMED | HIGH | Escalations and document revocations silently skipped; scheduler stops retrying | "Run completed successfully" |
| 31 | Keycloak webhook answers `{received: true}` after both audit sinks (DB and OpenSearch) fail | `server/_core/index.ts:1327-1360` | CONFIRMED | HIGH | Identity audit trail gaps | "Event recorded" |
| 32 | Payment-queue insert failure in `payments.initiate` is swallowed | `server/routers/payments.ts` (`catch {}` after queue insert) | CONFIRMED | MEDIUM | Payment exists with nothing to execute it | "Payment initiated" |
| 33 | Keycloak role enrichment failure is swallowed, silently degrading to DB roles | `server/_core/context.ts` (`catch {}` around `verifyKeycloakToken`) | CONFIRMED | MEDIUM | Authorization decisions on stale/degraded role data | "Keycloak roles enforced" |

### F15/F2 — observability and analytics fiction

| # | Title | Evidence | Status | Sev | Blast radius | User-facing lie |
|---|---|---|---|---|---|---|
| 34 | `stream.getRecentEvents` fabricates cargo events — including `PAYMENT_RECEIVED`, `CUSTOMS_HOLD_PLACED`, `CLEARANCE_PERMIT_ISSUED` — when Fluvio is offline | `server/routers/stream.ts:32-58,65-77` | CONFIRMED | HIGH | Cargo timelines shown to traders and officers | "Recent cargo events" |
| 35 | ASEAN single-window inbound messages and acknowledgements are synthesised on integration failure | `server/routers/aseanSw.ts:128-177` | CONFIRMED | HIGH | G2G message status/acks | "The member state acknowledged" |
| 36 | Wazuh playbook returns `status: "completed"` after doing nothing; agent list and security score are hardcoded fallbacks | `server/routers/wazuh.ts:90-112,59-73,165-185` | CONFIRMED | HIGH | Incident response and security posture reporting | "Containment playbook completed", "5 agents active, score B+" |
| 37 | CEN (WCO) outage is rendered as empty alert lists and `correlationScore: 0` | `server/routers/cen.ts:9-27,45-46,105-164` | CONFIRMED | HIGH | Enforcement intelligence | "No CEN alerts for this consignment" |
| 38 | Delta Lake analytics service seeds 90 days of `random` trade/revenue records marked `CLEARED` and aggregates them into `/stats` | `services/python/deltalake-svc/main.py:17,64-80,403-415` | CONFIRMED | HIGH | Revenue/duty/clearance dashboards | "Historical platform trade data" |
| 39 | CEP dashboard reports `declarations_processed = total_triggers * 100` | `server/routers/cep.ts:201-222`, `client/src/pages/FlinkCepAlerts.tsx:400` | SUSPECTED | MEDIUM | Throughput reporting | "Declarations processed" |

### F11/F13/F9/F16 — lifecycle, arithmetic, input, environment

| # | Title | Evidence | Status | Sev | Blast radius | User-facing lie |
|---|---|---|---|---|---|---|
| 40 | Duty assessment is a flat 10% + 15% VAT on the client-supplied invoice value — no tariff schedule, no CIF, no exemptions, no FX | `server/routers/declarations.ts:256-271` | CONFIRMED | HIGH | Every assessment and therefore every payment amount | "Duties assessed" on a customs tariff basis |
| 41 | `rulesOfOrigin.review` writes a decision without checking the prior status, so terminal certificates can be re-decided | `server/routers/rulesOfOrigin.ts:145-172` | CONFIRMED | HIGH | Origin certificate legal state | "Review of a pending certificate" |
| 42 | Upload route validates only client-declared MIME and filename extension | `server/routes/uploadRoute.ts:15-59` | SUSPECTED | MEDIUM | Document vault contents | "Allowed document type" |
| 43 | Delta Lake write-back interpolates request-supplied table/column/conflict identifiers into SQL | `services/python/deltalake-svc/main.py:313-389` | SUSPECTED | HIGH | Analytics DB, if the endpoint is reachable | "Parameterized SQL" |
| 44 | App port is 3000 in source/Dockerfile/k8s base and 9000 in Helm; `env.ts` and `ledger.ts` disagree on TB-bridge and payment-risk ports; ports 8092/8093 are each claimed by three services | `server/_core/index.ts:1516`, `Dockerfile:60`, `k8s/base/service.yaml:11`, `helm/tradegateway/values.yaml:24-25`, `server/_core/env.ts:88,112` vs `server/routers/ledger.ts:14-15` | CONFIRMED | HIGH | One deployment path routes to a closed port; "service unavailable" fallbacks fire permanently | "Configured integrations" |
| 45 | CSRF enforcement is off unless `NODE_ENV=production` (or an opt-in flag) | `server/_core/trpc.ts` `validateCsrf` | CONFIRMED | LOW | Non-production deployments | — |

---

## Composition chains

**Chain A — free clearance (no privilege needed beyond a registered trader account).**
1. `declarations.create` + `submit` → duty assessed from the trader's own invoice value (#40).
2. `mojaloop.initiatePayment` with `amount: 1` against that declaration — no ownership check, no comparison to `totalDue` (#07).
3. Poll `mojaloop.getPaymentStatus` twice, ≥15 s apart → transfer flips to `COMMITTED`, a `duty_payment` ledger entry is posted crediting customs revenue, and an audit event records the settlement with `actorType: "system"` (#02).
4. `payments.confirm` (or the same transfer) marks the payment terminal even if Temporal is down (#01).
Result: a cleared declaration, a customs-revenue credit in the ledger of record, and an audit trail that attributes it all to the system. Nothing ever contacted a bank.

**Chain B — privilege escalation to control-plane.**
`onboarding.selectRole { role: "finance" }` (#11) → `ctx.user.role` is now `finance`, which `KEYCLOAK_TO_DB_ROLE` treats as equivalent to the Keycloak role in `keycloakRoleProcedure` (`server/_core/trpc.ts:147-190`) → role-gated fund-flow, ledger and settlement procedures open up. Combined with #05 (TB bridge down ⇒ direct `posted` ledger writes) and #26 (risk scorer down ⇒ auto-APPROVE), a self-promoted user can mint bond releases and refunds.

**Chain C — compliance fiction for a regulator.**
`DEMO_MODE=true` or a Permify outage (#24, #14) removes authorization → `auditEngine` mutations are public anyway (#12) → audits are created and closed with fabricated findings → Wazuh reports containment "completed" (#36) → Delta Lake `/stats` reports random but plausible revenue (#38) → CEN reports no alerts (#37). Every regulator-facing surface is green and internally consistent, and none of it is derived from reality.

**Chain D — unauthenticated money and compliance state changes.**
With `MOJALOOP_WEBHOOK_SECRET` unset, `mojaloop.webhookCallback` accepts `"dev-webhook-secret"` from anyone (#04) → mark any transfer `COMMITTED` and post the ledger entry. With `SANCTIONS_WEBHOOK_SECRET` unset, `POST /api/webhooks/sanctions-hit` accepts unsigned requests (#19) → reject any competitor's declaration. `validateWebhookSecrets()` would have blocked both in production, but it is never called (#13).

---

## Negative results (checked, found sound)

* `permify.can()` itself fails **closed** on HTTP error, non-OK response and timeout (`server/_core/permify.ts`); the defect is the demo-mode bypass, not the PDP call.
* CSRF double-submit uses `crypto.timingSafeEqual` with a length pre-check (`server/_core/trpc.ts`).
* `security.ts` `verifyAmountSignature` uses constant-time comparison (its problem is that nothing calls it).
* `batchPayments.enqueue` uses a **durable** DB idempotency key (`payment_idempotency_keys`, hash of `enqueue:<transferId>`), not the fail-open Redis path — the correct pattern already exists in the codebase.
* `mojaloop.initiatePayment` likewise uses durable DB idempotency over user+declaration+amount+FSP+account.
* `declarations.submit` genuinely enforces an approved KYC record before accepting a declaration (`server/routers/declarations.ts:230-238`).
* `declarations.submit` and `getById` check `traderId` ownership.
* `kyc.analyseDocument` verifies document ownership; `kyc.reviewVerification` is `adminProcedure` **and** calls `assertCan`.
* `fraudCases.*` call `requireInvestigator` before any DB work; `heartbeatJobs.*` call `requireAdmin`.
* `rulesOfOrigin.getById` enforces ownership with an officer/admin exception; `rulesOfOrigin.review` does check reviewer role (the gap is prior-state validation only).
* `GET /api/verify/:certNumber` returns 503 on DB outage instead of asserting a certificate result — the correct polarity, and the model for fixing #29/#30.
* `/metrics` is restricted to loopback/RFC-1918 or a bearer token.
* `POST /api/admin/opensearch/setup-ilm` checks `authResult.role !== "admin"`.
* `scheduled/tenantDomainPoller` requires a cron-authenticated request with a task UID — the model for fixing the other six scheduled handlers.
* Money columns in `drizzle/schema.ts` are `decimal`/`numeric`, not floats; the `auditTasks.status` enum matches the values `auditEngine` writes (migration `0032`).
* Neo4j graph traversal depth is clamped and trader identifiers are parameterized.
* Helmet CSP/HSTS/frameguard, input sanitisation and file-upload size/extension/MIME guards are mounted globally.

---

## Residual register (not remediated in this pass)

| Item | Why deferred |
|---|---|
| #40 tariff-correct duty assessment | needs a real tariff schedule, CIF components and FX policy — product/legal input, not a code defect fix |
| #10 GHS/NGN jurisdiction split | requires a currency decision across schema, FSP list and ledger |
| #38 / #43 Delta Lake service | separate Python service; needs its own PR and deployment review |
| #08 / #09 ILP crypto and FX rates | require a real Mojaloop client and a rate provider |
| #17 unused security helpers | wiring `emitSecurityEvent` across mutations is a broad refactor |
| #44 port map divergence | needs the owner to declare which deployment artifact is authoritative |
| #42 upload content sniffing | needs a magic-byte/AV scanning dependency decision |
| #23 session lifetime | reduced default; refresh-token flow still to be designed |

## Scores

| Dimension | Score | Basis |
|---|---|---|
| Money-path integrity | 1/10 | four independent paths create settled money with no rail (#01–#05) |
| Authorization integrity | 2/10 | self-service role elevation, public audit engine, caller-supplied identities |
| Secret/crypto hygiene | 2/10 | empty JWT default, committed webhook secrets, dead validator |
| Error polarity (fail-closed) | 2/10 | risk, valuation, idempotency, revocation and crons all fail open |
| Observability truthfulness | 2/10 | fabricated cargo, security, analytics and enforcement data |
| Deployment coherence | 3/10 | divergent ports and duplicate service families |
