# Platform Integration & Production-Readiness Audit

Scope: the 13 infrastructure dependencies plus the web UI/UX, PWA and native mobile surface.
Method: source-level verification at `bf65523` (merge of #37). Every claim below cites the file
and line that supports it. Where a subsystem is *declared* but no request path reaches it, that is
stated as such rather than counted as an integration.

Two scores per subsystem:

* **Integration (0–10)** — does real production traffic actually flow through it?
* **Robustness (0–10)** — durability, failure semantics, and security hardening of that path.

A high integration score with a low robustness score is the dangerous combination: the platform
depends on it and it is not hardened. A low integration score means the dependency is decoration.

---

## Summary table

| # | Subsystem | Integration | Robustness | Verdict |
|---|-----------|:-----------:|:----------:|---------|
| 1 | PostgreSQL | 9 | 4 | The only genuinely load-bearing dependency. Untuned pool; the entire RLS layer is dead code. |
| 2 | TigerBeetle | 3 | 1 | Not TigerBeetle. In-memory Go map; all balances lost on restart. A real Rust client exists but nothing points at it. |
| 3 | Redis | 7 | 5 | Real locks/idempotency. Permanent self-disable latch after a blip; rate limiter fails open. |
| 4 | Mojaloop | 4 | 2 | Not the FSPIOP API. ILP packet is fabricated with a hardcoded amount; the crypto-condition is `Math.random()`. Ghanaian FSP catalogue hardcoded. |
| 5 | Kafka | 6 | 4 | Real producer, two conflicting configs, publish failures silently dropped, no outbox, one consumer, no DLQ. |
| 6 | APISIX | 5 | 4 | Substantial config that no tested request path traverses; the app is reachable directly. |
| 7 | Keycloak | 6 | 5 | Correct RS256/JWKS/iss/aud validation, but it is an alternative to the app's own session auth, not the enforced IdP. |
| 8 | openappsec | 2 | 2 | Dashboard reads a table that nothing writes: the documented `waf-events` consumer does not exist. |
| 9 | Permify | 6 | 4 | Checks fail closed correctly, but the schema seed cannot run in the production image. |
| 10 | OpenSearch | 4 | 3 | Fire-and-forget indexing with no backfill; an outage is rendered as "no results". |
| 11 | Fluvio | 2 | 1 | The consumer generates synthetic cargo events every 3s and streams them to the UI as live. |
| 12 | Dapr | 3 | 3 | Components and middleware helpers exist; the TypeScript core does not use Dapr at all. |
| 13 | Lakehouse | 3 | 1 | No lakehouse. `deltalake-svc` seeds 90 days of `random` declarations and serves them as national trade statistics and duty revenue. |
| — | Web UI/UX | 7 | 5 | 138 pages, code-split, error-bounded; i18n is unused scaffolding, a11y sparse, several pages render fabricated data. |
| — | PWA | 6 | 3 | Real service worker, but no app shell cached and every tRPC mutation is blind-queued for replay. |
| — | Native mobile | 4 | 2 | Flutter has ~50 screens and native projects; React Native has no `android/`/`ios/` at all, so it cannot build. |

---

## 1. PostgreSQL — Integration 9 / Robustness 4

Genuinely integrated: Drizzle over `pg.Pool`, ~200 tables, and every domain router reads and
writes it. It is the only dependency whose loss stops the platform, which is the correct
architecture — but it is not configured or protected like a system of record.

* **Untuned pool, no error handler.** <ref>server/db.ts:65</ref> is `new Pool({ connectionString: url })` —
  no `max`, no `idleTimeoutMillis`, no `connectionTimeoutMillis`, no `statement_timeout`, no SSL
  block, and no `_pool.on("error")`. An idle-client error emits an `error` event with no listener,
  which terminates the Node process.
* **The RLS layer is dead code.** `withRlsContext` (<ref>server/db.ts:1557</ref>) is the only thing
  that sets `app.current_user_id`, and it has **zero call sites** outside `db.ts`. Separately, the
  policies read `app.current_role` and `app.current_trader_id`
  (<ref>infra/postgres/01_rls_policies.sql:36</ref>, `:40`) while the helper sets
  `app.current_user_role` (<ref>server/db.ts:1578</ref>) — so even if it were called, the names do
  not match. Meanwhile <ref>server/routers/declarations.ts:393</ref> documents `myDeclarations` as
  "RLS-enforced at the database level". Tenant isolation rests entirely on application `WHERE`
  clauses; the database-level backstop does not exist.
* **Sticky failure caching.** `_db` is memoised including the `null` failure case
  (<ref>server/db.ts:57</ref>), so a database that is briefly unreachable at first use stays
  "unavailable" for the life of the process.
* **Migrations do not apply.** The Drizzle migration path fails with `55P04`; the working
  procedure is `drizzle-kit push --force`, which is a development tool, not a production
  migration strategy. No backup/PITR/replica/failover procedure is exercised anywhere.

## 2. TigerBeetle — Integration 3 / Robustness 1

The platform's money guarantees (duty settlement, excise stamp liability, tariff-quota drawdown)
are posted to a service that is a Go map behind an HTTP API.

* <ref>services/go/tigerbeetle-bridge/cmd/main.go:132</ref> says so in its own comment:
  "In-memory store (simulates TigerBeetle until binary client is wired)". Process restart loses
  every balance and every transfer.
* The app points at that bridge: <ref>server/routers/ledger.ts:30</ref>.
* A **real** client does exist — <ref>services/rust/tigerbeetle-bridge-rs/Cargo.toml:18</ref>
  gates the official `tigerbeetle` dependency behind a non-default `tigerbeetle-live` feature —
  but nothing in the application points at the Rust bridge, and it is not built with that feature.
* Three conflicting defaults for the same dependency: `http://tigerbeetle-bridge:8093`
  (<ref>server/routers/ledger.ts:30</ref>), `http://localhost:8094`
  (<ref>server/_core/env.ts:88</ref>), `http://tigerbeetle-bridge:50055`
  (<ref>server/_core/systemRouter.ts:347</ref>).
* The Go module does not build as a whole: no committed `go.sum`, and `internal/backend` imports a
  TigerBeetle Go package that does not exist upstream, so only `./cmd` compiles.

## 3. Redis — Integration 7 / Robustness 5

Materially integrated: distributed locks, idempotency keys, rate limiting, session revocation,
quota coordination, health checks.

* **Permanent self-disable.** After five retries, `_connectionFailed = true`
  (<ref>server/_core/redis.ts:43</ref>) makes `getRedis()` return `null` for the remaining life of
  the process — a 10-second Redis blip degrades the instance until it is restarted. This is the
  mechanism behind the session-lockout regression found in earlier testing.
* **Rate limiter fails open**: `if (!redis) return true` (<ref>server/_core/redisRateLimiter.ts:80</ref>).
  Defensible for availability, but it means the abuse control disappears exactly when the
  platform is under stress, and nothing alerts on it.
* Two Redis client libraries are in use (`ioredis` and `redis`), with different failure
  semantics for the same dependency. No Sentinel/Cluster topology, no TLS, no `requirepass` handling.

## 4. Mojaloop — Integration 4 / Robustness 2

This is the most serious integrity finding in this audit after the lakehouse. The integration is
not the Mojaloop FSPIOP API; it is a bespoke HTTP call with *fabricated Interledger material*.

* **The ILP packet is invented and carries a hardcoded amount.**
  <ref>services/../server/routers/mojaloop.ts:140</ref>:

  ```ts
  function generateILPPacket(): string {
    return Buffer.from(JSON.stringify({
      amount: 500000,
      account: `g.gh.customs.${crypto.randomUUID()...}`,
  ```

  Every transfer carries `amount: 500000` and a Ghanaian ILP address regardless of the duty
  actually owed. A real ILP packet is OER-encoded and its amount is authoritative.
* **The crypto-condition is not cryptographic.** <ref>server/routers/mojaloop.ts:148</ref> builds
  the 43-character `condition` from `Math.random()`. A Mojaloop condition is the base64url SHA-256
  of the fulfilment; this value can never be fulfilled, and it is not generated from a CSPRNG.
* No `/participants` (ALS) lookup, no quotes phase, no JWS signing of FSPIOP requests — only
  `POST {MOJALOOP_URL}/transfers` (<ref>server/routers/mojaloop.ts:315</ref>) with two FSPIOP
  headers, against a service that answers a non-FSPIOP `/health`.
* **The FSP catalogue is seven hardcoded Ghanaian institutions in GHS**
  (<ref>server/routers/mojaloop.ts:64</ref>–`137`) on a platform whose declarations are Nigerian.
  This is the root of the currency incoherence flagged in the first audit.

Credit where due: settlement is no longer fabricated at the application level — status is
read-only and unavailability fails closed (fixed in #33). The remaining defect is that the
*protocol* material is fictional, so this integration cannot work against a real switch.

## 5. Kafka — Integration 6 / Robustness 4

* Two producers with contradictory guarantees: <ref>server/_core/kafka.ts:105</ref> uses
  `allowAutoTopicCreation: true` and the legacy partitioner with no idempotence, while
  <ref>server/_core/middlewareClients.ts</ref> configures `idempotent: true,
  maxInFlightRequests: 1`. Same cluster, same process, different delivery semantics.
* **Publish failures are swallowed.** `publishEvent` returns `false` on error and callers do not
  compensate — the database transaction commits and the event is simply lost. There is no
  transactional outbox anywhere, so the event stream is not a reliable projection of state.
* One consumer exists, for insider-threat topics (<ref>server/kafkaConsumer.ts:99</ref>), with no
  dead-letter topic, no retry policy, and no consumer-side idempotency store.
* Topics are declared in `infra/kafka/topics.yaml` and created by a shell script; nothing verifies
  that the running cluster matches, and auto-creation masks the difference. No SASL/TLS.

## 6. APISIX — Integration 5 / Robustness 4

The configuration is real and detailed (routes, upstreams, health checks, a Keycloak consumer,
TLS on 9443 in <ref>infra/apisix/config.yaml</ref>). The problem is that **no verified request
path goes through it**: the application listens on `:3000` and every test performed in this
session reached it directly. Everything the gateway is supposed to enforce — edge rate limits,
JWT pre-validation, WAF chaining, mTLS to upstreams — is therefore unexercised.
`server/routers/apisixAudit.ts` records intended route configuration in Postgres; it does not read
back from the Admin API, so it cannot detect drift between what is recorded and what is serving.

## 7. Keycloak — Integration 6 / Robustness 5

The best-implemented of the security dependencies. <ref>server/middleware/keycloakJwt.ts</ref>
does real `jwtVerify` with remote JWKS, `RS256` only, and issuer *and* audience pinning — no
`verify: false`, no HS256 confusion, no unverified `decode`. Realm exports exist for production.

Gaps: the realm URL falls back to a hardcoded `http://keycloak:8080/...` default rather than
failing closed on missing configuration; Keycloak is one of several accepted token sources
alongside the platform's own session/JWT auth, so it is not the enforced identity provider; there
is no back-channel logout or token-revocation handling, so a Keycloak-side session kill does not
propagate; and service-to-service calls between the polyglot services do not present Keycloak
tokens at all.

## 8. openappsec — Integration 2 / Robustness 2

* The agent is deployed as `openappsec/agent:latest` (unpinned) in
  <ref>infra/docker-compose.yml</ref>.
* <ref>server/routers/openAppSec.ts:6</ref> documents that "WAF events are ingested via the Kafka
  consumer (topic: `waf-events`)". **That consumer does not exist** — the only consumer subscribes
  to `insider.threat.*` (<ref>server/kafkaConsumer.ts:99</ref>), and a repository-wide search for
  `waf-events` outside comments and tests returns nothing.

Consequence: `client/src/pages/app/WafEvents.tsx` and the Coraza dashboard read a table nothing
writes. Security staff are shown an empty attack log — "no threats" — which is indistinguishable
from a working WAF with nothing to report. This is the same fabricated-absence family as the
findings in #33.

## 9. Permify — Integration 6 / Robustness 4

Real ReBAC checks with `assertCan()` at many call sites, and a check failure or timeout returns
`false` — correctly fail-closed (<ref>server/_core/permify.ts</ref>).

* **The schema can never be seeded in production.** <ref>server/_core/index.ts:1157</ref> resolves
  `../../infra/permify/schema.perm` relative to the built bundle, and the production image copies
  only `dist`, `drizzle`, `shared` and `package.json` — `infra/` is absent
  (<ref>Dockerfile:51</ref>–`54`). In a container the seed logs "schema.perm not found — skipping"
  and every subsequent check evaluates against an empty schema.
* `DEMO_MODE=true` short-circuits every check to `true` outside production
  (<ref>server/_core/permify.ts:53</ref>) — acceptable, but it means most testing does not
  exercise authorization at all.
* Relationship-tuple writes are logged on failure but not rolled back with the business
  transaction, so authorization state can silently diverge from domain state.

## 10. OpenSearch — Integration 4 / Robustness 3

* **An outage looks like an empty result set.** `searchDeclarations` returns
  `{ hits: [], total: 0 }` when the client is absent or the query throws
  (<ref>server/_core/opensearch.ts:89</ref>, `:137`, `:152`). A user searching for their
  declaration during an OpenSearch outage is told it does not exist.
* Indexing is fire-and-forget at submission (<ref>server/routers/declarations.ts:362</ref>) with no
  reindex/backfill job and no outbox, so the index permanently drifts from Postgres on any failure
  or subsequent status change.
* Default credentials `admin`/`admin` (<ref>server/_core/middlewareClients.ts</ref>) if the
  environment does not override them. No index templates, aliases, ILM, or snapshot policy.

## 11. Fluvio — Integration 2 / Robustness 1

* <ref>services/go/fluvio-consumer/cmd/main.go:245</ref> — "Fluvio consumer (simulated)". A ticker
  emits a synthetic event every three seconds — `VESSEL_ARRIVED`, `CUSTOMS_HOLD_PLACED`,
  `PAYMENT_RECEIVED` — with Ghanaian port codes and a fabricated declaration ID attached to every
  third event, then broadcasts them over WebSocket.
* The UI consumes exactly that: `client/src/hooks/useFluvioFeed.ts` and
  `client/src/components/FluvioStreamPanel.tsx` render it as a live operational feed. Officers are
  shown invented customs holds and payment events.
* The lag dashboard is self-reported: offsets come from an admin mutation
  (<ref>server/routers/fluvio.ts:33</ref>) writing whatever it is handed into Postgres. Nothing
  scrapes real Fluvio offsets, so "healthy, zero lag" means only that someone posted zero.

## 12. Dapr — Integration 3 / Robustness 3

Components, a secret store, and a ServiceMonitor exist under `infra/k8s/dapr/`, and Go/Python
services carry Dapr middleware helpers. But the TypeScript core — which owns essentially all
business logic — makes no Dapr calls at all: no sidecar invocation, no state store, no pub/sub.
Dapr therefore mediates traffic only between peripheral services, and the resiliency policies,
mTLS and retry semantics that are Dapr's main value are not on any critical path.

## 13. Lakehouse — Integration 3 / Robustness 1

**There is no lakehouse, and the service that stands in for one fabricates national trade
statistics.**

* <ref>services/python/deltalake-svc/main.py:64</ref> — `_seed_analytics_data()` generates 90 days
  of declarations with `random.randint`/`random.uniform`: declared values, duty amounts, clearance
  lanes, clearance hours, trader IDs. It runs unconditionally at import
  (<ref>services/python/deltalake-svc/main.py:95</ref>).
* Those records are served from `/trade-stats`, `/duty-revenue`, `/hs-code-volume`,
  `/trader-metrics` and `/route-flow`, and **the platform proxies them straight to the UI**:
  <ref>server/routers/analytics.ts:47</ref>–`114`. The analytics screens present invented duty
  revenue and trade volumes as fact — the single highest-impact fabrication remaining in the
  codebase, because these are the numbers a ministry would quote publicly.
* No Delta Lake, Iceberg, object store, or Parquet write exists; `pyarrow` and `duckdb` are
  declared in `requirements.txt` and unused. `lakehouseJobs` rows record the progress of a
  pipeline that does not move data.
* Three conflicting service URLs again: `:8098` (<ref>server/_core/env.ts:96</ref>), `:8103`
  (<ref>server/routers/analytics.ts:9</ref>), `:8000`
  (<ref>server/scheduled/lakehouseRollup.ts:13</ref>).

## Web UI/UX — Integration 7 / Robustness 5

Real and substantial: 138 pages, 98 components, 148 routes, 118 lazily-loaded (good initial-bundle
discipline), an `ErrorBoundary`, an offline banner, and a consistent component library.

Polish gaps, measured rather than guessed:

* **i18n is scaffolding.** `client/src/i18n/` and a `LanguageSwitcher` exist, but exactly **one**
  file in the client calls `useTranslation`. Switching language changes nothing.
* **Accessibility is thin.** ARIA attributes appear in 34 of 236 client `.tsx` files; there is no
  focus-trap/skip-link/landmark discipline and no automated a11y check.
* **Loading states are inconsistent** — 5 files use skeletons; most pages show nothing or a
  spinner. Responsive utilities are sparse on the largest pages (5 breakpoint classes across the
  1,739-line `DeclarationDetail`), so the desktop layouts dominate.
* Several pages render the fabricated data described above (analytics, the Fluvio stream panel, the
  WAF dashboards).
* **No rendered verification exists.** The browser subsystem on this machine has been unavailable
  for the entire session; Playwright specs exist under `e2e/` but no run has been observed. Every
  statement here is from source, and no claim about visual polish should be treated as verified.

## PWA — Integration 6 / Robustness 3

`client/public/sw.js` is a real service worker: install/activate lifecycle, navigation
network-first, background sync, push handling, and cache versioning (`tradegateway-v3`).

* **The offline shell is not cached.** `STATIC_ASSETS = ['/manifest.json']` — the HTML shell, JS
  and CSS are not precached, so a cold offline start has nothing to render.
* **Blanket mutation queueing is unsafe.** *Every* same-origin `POST /api/trpc` is captured and
  queued for later replay, with no allow-list. That includes payment initiation, permit
  consumption, quota drawdown and status transitions. Replay is not gated on an idempotency key,
  so a queued duty payment can be re-submitted after the user has already paid another way.
* **Replay drops failures silently**: `if (r.ok || r.status < 500) { cache.delete(key) }` — a 400
  or 409 on replay is discarded as if it had succeeded, and the user is never told their offline
  action failed.

## Native mobile — Integration 4 / Robustness 2

* **Flutter** (`mobile/flutter/tradegateway`): ~50 Dart files, a router, an API service, and real
  `android/`/`ios/` projects. It has one default `widget_test.dart`. Not built or run in this
  session.
* **React Native** (`mobile/react-native/TradeGateway`): `App.tsx`, `src/`, `assets/`,
  `package.json` — and **no `android/` or `ios/` directory**, so `react-native run-android`/`run-ios`
  cannot work. It is source without an app.
* Neither client has a build, a test run, a store-signing setup, or offline/secure-storage
  verification. Screen count is not polish.

---

## Production-readiness score

**31 / 100 — not production-ready. Pilot-capable only on the PostgreSQL-backed core, with the
fabricating surfaces disabled.**

| Dimension | Weight | Score | Reasoning |
|-----------|:------:|:-----:|-----------|
| Functional breadth | 15% | 8/10 | Genuinely wide: declarations, risk, payments, excise, regulatory, AEO, drawback, parity with NSW/TradeNet on the core. |
| Data integrity & honesty | 20% | 3/10 | Analytics, the Fluvio feed and the WAF log present fabricated or permanently-empty data as real. Money-path fabrication was fixed in #33; the reporting layer was not. |
| Durability of financial state | 15% | 1/10 | Every ledger balance lives in a process-local Go map. |
| Security & authorization | 15% | 4/10 | Good Keycloak validation and fail-closed Permify checks, undermined by dead RLS, an unseedable Permify schema in-image, default credentials, and an untraversed gateway. |
| Reliability & failure semantics | 10% | 3/10 | Redis self-disables permanently; Kafka drops events silently; OpenSearch renders outages as emptiness; no outbox anywhere. |
| Observability | 5% | 5/10 | Prometheus/Grafana/Loki wired and real health endpoints, but the dashboards that matter are fed by simulators. |
| Deployability & config | 5% | 4/10 | Broken migration path, three different defaults for several services, `:latest` images, `infra/` missing from the image. |
| Verification | 10% | 2/10 | No CI at all. 14 test files failing on `main`. 72 standing type errors. Zero rendered UI verification. |
| UX polish & mobile | 5% | 4/10 | Broad and code-split, but unused i18n, thin a11y, and one of the two mobile apps cannot build. |

The score is low not because the platform is thin — it is unusually broad — but because the
proportion of it that would survive contact with a real regulator is smaller than the surface
suggests, and the gap is concentrated in the places that produce numbers and security assurances.

---

## Remediation plan

Ordered by consequence-if-wrong, not by effort.

**Tranche 1 — stop fabricating (integrity).**
Replace the simulated analytics pipeline with a real one computed from Postgres (Python, DuckDB
over exported Parquet, with the tRPC analytics router reading the real aggregates); delete the
random seeder; make the Fluvio stream carry real domain events or report unavailable; either
implement the `waf-events` consumer or make the WAF dashboards state that ingestion is not
configured; fix the Mojaloop ILP packet and condition (real OER encoding, SHA-256 condition from a
CSPRNG, amount from the declaration) and replace the hardcoded Ghanaian FSP list with an ALS
participant lookup that fails closed.

**Tranche 2 — durability of money.**
Point the ledger at the Rust bridge, build it with `tigerbeetle-live` against a real TigerBeetle
cluster in compose/k8s, and add a startup guard that refuses to serve in production on the
in-memory backend. Add a transactional outbox for Kafka so events cannot be lost after commit.

**Tranche 3 — trust boundaries.**
Wire `withRlsContext` into the query paths that claim RLS, fix the session-variable names, and
apply the policies in the migration path. Ship the Permify schema inside the image and fail closed
if it is not seeded. Remove default credentials. Put the tested request path through APISIX.

**Tranche 4 — reliability.**
Pool tuning and an error handler; Redis reconnection instead of the permanent latch; fail-closed
or explicitly-degraded rate limiting; OpenSearch outage distinguished from emptiness plus a
backfill job; one Kafka producer configuration.

**Tranche 5 — UI/PWA/mobile.**
Precache the app shell; restrict offline queueing to an explicit idempotent allow-list and surface
replay failures; wire i18n through the real screens; a11y pass on the primary flows; unavailable
states wherever a simulator was removed. Generate the React Native native projects so the app
builds; add a Flutter/RN test and build step.

**Tranche 6 — verification.**
A CI workflow that runs typecheck (against the 72-error baseline), unit tests, and the Playwright
suite, so none of the above can regress silently.
