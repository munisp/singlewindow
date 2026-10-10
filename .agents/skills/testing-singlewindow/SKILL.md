---
name: testing-singlewindow
description: Local runtime/E2E testing setup for the munisp/singlewindow TradeGateway monolith (Express + tRPC + React/Vite) — how to boot it, log in, seed data, and exercise webhook/payment/declaration paths when the polyglot microservices are unavailable.
---

# Testing singlewindow (TradeGateway) locally

The repo is a TS Express + tRPC + React/Vite monolith surrounded by microservices
(TigerBeetle bridge, Temporal, Mojaloop switch, Permify, Kafka, Fluvio, Wazuh, ASEAN/CEN).
Those are normally NOT running locally — that is usually the point of the test: the app must
fail closed and surface explicit "unavailable" states rather than fabricating success.

## Boot

- `pnpm dev` may be unusable: package.json declares pnpm 11.x which requires Node >= 22.13
  (boxes have shipped with 22.12). Dependencies are usually already in `node_modules`.
  Run the server directly instead:
  ```bash
  cd /home/ubuntu/repos/singlewindow
  setsid nohup npx tsx watch server/_core/index.ts > /tmp/dev.log 2>&1 < /dev/null & disown
  # ~40-60s until: "Server running on http://localhost:3000/"
  ```
  Start it with `setsid nohup ... & disown` from a *dedicated* shell — a plain `&` inside a
  one-shot exec call gets killed when the call returns.
- Kafka/Redis/bridge connection errors in the log are expected noise.
- When killing servers, match on the pid list from `pgrep -af index.ts`; broad
  `pkill -f 3100`-style patterns can kill the main dev server too.

## Required .env (dev)

Postgres, and these are easy to miss — without them the app looks broken in ways unrelated
to the change under test:

```
NODE_ENV=development
DEMO_MODE=true
DATABASE_URL=postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway
JWT_SECRET=<32+ chars>
VITE_APP_ID=local-dev-app            # else every session JWT has appId "" and verifySession
                                     # rejects it -> "[Auth] Session payload missing required fields"
VITE_OAUTH_PORTAL_URL=https://manus.im/login   # else the React app crashes on load with
                                               # "TypeError: Invalid URL at getLoginUrl"
MOJALOOP_WEBHOOK_SECRET=<32+ chars>
OGA_WEBHOOK_SECRET=<32+ chars>
CEP_WEBHOOK_SECRET=<32+ chars>
SANCTIONS_WEBHOOK_SECRET=<32+ chars>
```

Vite/dotenv read `.env` at process start — restart the server after editing it; the tsx
watcher will not pick env changes up.

`[WebhookSecrets] ... known dev placeholder` warnings fire for any value containing
`secret`/`password`/`dev-secret` — cosmetic in dev.

## Database

```bash
sudo -u postgres psql -c "CREATE ROLE tradegateway LOGIN PASSWORD 'tradegateway_secure_2026'"
sudo -u postgres createdb -O tradegateway tradegateway
npx drizzle-kit push --force      # `drizzle-kit migrate` / `pnpm db:push` may fail with
                                  # Postgres 55P04 (enum created and used in one transaction)
psql -f scripts/seed-demo-users.sql   # step 2 may fail: current_step is enum onboarding_step
                                      # but the script inserts integer 6
```
Manual fixups that are often needed:
```sql
INSERT INTO onboarding_progress (user_id, current_step, overall_status, completed_at)
SELECT id, 'aeo_eligibility'::onboarding_step, 'completed', NOW()
FROM users WHERE open_id LIKE 'demo-%';
-- declarations.create requires an approved stakeholder profile, submit requires approved KYC
INSERT INTO stakeholder_profiles (user_id, stakeholder_type, organization_name, country, status, approved_at)
VALUES (1, 'trader', 'Test Imports Ltd', 'GHA', 'approved', NOW());
```

## Login (dev only)

```bash
curl -s -c /tmp/trader.txt -X POST localhost:3000/api/demo/session \
  -H 'content-type: application/json' -d '{"role":"trader"}'
# roles: trader | customs | oga | admin | security | developer -> cookie app_session_id
```
Auth depends on Redis: session revocation is checked in
`server/_core/redisRateLimiter.ts::isSessionRevoked`. If Redis is down (or the client has
latched a failure), authenticated requests may 401 across the board and, depending on the
revision, may stay 401 until the Node process restarts. If everything suddenly 401s, check
`redis-cli ping`, grep the log for `Session revocation check unavailable`, and restart the
server before concluding the feature is broken.

## Useful routes

- `/app/trader/declarations/:id` (detail, risk lane/gauge), `/app/trader/declarations/new`
- `/app/customs` (live cargo stream), `/app/customs/payments` & `/app/trader/payments` (Mojaloop)
- `/app/admin/asean-sw`, `/app/security/wazuh`, `/app/security/alerts`, `/app/security/cen-alerts`
- `/app/onboarding` (role selection card)
- tRPC over HTTP: `GET /api/trpc/<router>.<proc>?input={"json":{...}}`,
  mutations `POST /api/trpc/<router>.<proc>` with body `{"json":{...}}`.

## Exercising the money paths without the microservices

- `declarations.create` → `declarations.submit` is the only way to hit risk scoring; the
  trader UI calls `create` + `ai.scoreRisk`, never `submit`.
- `mojaloop.initiatePayment` validates that the amount equals `declaration.totalDue` and that
  declaration currency == FSP settlement currency (GHS for the demo FSPs), so create the
  declaration with `invoiceCurrency: "GHS"` (totalDue = invoiceValue * 0.10 * 1.15 + ...).
- Mojaloop webhook: HMAC-SHA256 over the *exact raw bytes*, header `x-mojaloop-signature`:
  ```bash
  B='{"transferId":"...","transferState":"COMMITTED"}'
  SIG=$(printf '%s' "$B" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
  curl -X POST localhost:3000/api/webhooks/mojaloop -H 'content-type: application/json' \
       -H "x-mojaloop-signature: $SIG" -d "$B"
  ```
  A row must exist in `mojaloop_transactions` (`transfer_id`, `initiated_by`, enum
  `mojaloop_transfer_status` = PENDING|PROCESSING|COMMITTED|ABORTED|EXPIRED) or you only get 404.
- Other webhook paths: `/api/webhooks/oga`, `/api/webhooks/cep-event`,
  `/api/webhooks/sanctions-hit`, `/api/webhooks/keycloak-event` (note the suffixes — plain
  `/api/webhooks/cep` falls through to the Vite HTML and looks like a 200 "pass").
- Verifying fail-closed settlement: assert on DB, not just HTTP —
  `mojaloop_transactions.status`, `tigerbeetle_ledger_entries` (count by
  `mojaloop_transfer_id`), `audit_events.action = 'mojaloop_webhook_committed'`,
  `payment_idempotency_keys` (claim rows should be released on failure), and
  `mojaloop.getPaymentStatus.isSettled`.

## TigerBeetle bridge (needed for ledger/quota paths)

The Go bridge in `services/go/tigerbeetle-bridge` is an **in-memory simulator** — it needs no real
TigerBeetle cluster, so ledger-backed features (duty settlement, tariff quotas) CAN be tested locally:

```bash
cd services/go/tigerbeetle-bridge
# go.sum is not committed and `go mod tidy` FAILS (internal/backend imports
# github.com/tigerbeetle/tigerbeetle-go/pkg/types, which no longer exists upstream).
# Build only ./cmd, letting go add the two missing grpc entries:
GOFLAGS=-mod=mod go get google.golang.org/grpc/health/grpc_health_v1 google.golang.org/grpc/reflection
GOFLAGS=-mod=mod go build -o /tmp/tb-bridge ./cmd
git checkout go.mod && rm -f go.sum      # keep the repo clean afterwards
setsid nohup /tmp/tb-bridge > /tmp/tb-bridge.log 2>&1 < /dev/null & disown   # :8086
```
Then set `TB_BRIDGE_URL=http://localhost:8086` in `.env` (default points at the k8s hostname
`http://tigerbeetle-bridge:8093`) and restart the server.

The bridge store is **in-memory**: restarting it wipes all accounts/balances, so previously
provisioned quota accounts and `trader-*` accounts return 404 afterwards. Provision what you need
again (`POST /api/ledger/accounts`), or re-create quotas. System accounts (`trader-<id>`,
`ncs-revenue-account`) are only SQL rows — they are NOT created in the bridge at startup, so a
Mojaloop settlement will fail with "debit account not found" until you create them via the bridge API.
Useful reads: `GET /api/ledger/accounts/<id>/balance`, `GET /api/ledger/summary`.

## Regulatory layer (formalities / restrictions / tariff quotas)

- Router `server/routers/regulatory.ts`; hooks: `declarations.submit` →
  `evaluateDeclarationRegulations`, `declarations.updateStatus{status:"cleared"}` →
  `assertDeclarationFormalitiesSatisfied`.
- Authoring (`createFormality`/`createRestriction`/`createQuota`/`reverseQuotaAllocation`) is
  admin/customs_officer/oga_officer only; reads are any authenticated user.
- `declarations.submit` with the risk scorers down sets status `under_assessment`, which is NOT in
  `VALID_TRANSITIONS` in `server/businessRules.ts` — so clearance can never be reached from it.
  To test clearance, `update declarations set status='submitted'` in SQL first
  (`submitted → cleared` is allowed for customs_officer).
- Permify `assertCan` is bypassed when `DEMO_MODE=true` and `NODE_ENV != production`, so clearance
  is reachable without Permify running.
- Permit satisfaction reads `oga_permits` (agency_code, permit_type, status='approved', consignee_id,
  hs_code as a *prefix* of the declaration HS, origin, destination, valid_from/expires_at,
  permitted_quantity − used_quantity). Seeding these rows by SQL is the fastest way to test strictness.
- Quota allocation takes a Redis distributed lock; with Redis stopped, requests 401 at the auth layer
  before reaching the lock, so the "Quota coordination is unavailable" branch is hard to observe on a
  single-Redis box — assert on "no allocation row / no ledger movement" instead.

## Devin Secrets Needed

None — everything above runs locally; the deliberately-missing microservices are the test
condition.
