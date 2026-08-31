# Security Posture — TradeGateway NGSWTP (`munisp/singlewindow`)

Phase-11 security audit and hardening (branch `phase11/security`).

## Controls present (pre-existing)

- **HTTP headers (helmet):** CSP, HSTS (1y, includeSubDomains, preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `frameguard: deny` (frame-ancestors via CSP `frameSrc 'none'`), `object-src 'none'`, `upgrade-insecure-requests` in production. Production `script-src` has no `unsafe-inline`/`unsafe-eval`.
- **CORS:** explicit origin allowlist with credentials; no wildcard. Non-browser (no `Origin`) requests allowed.
- **CSRF:** double-submit cookie (`csrf-token` / `X-CSRF-Token`) enforced on all authenticated/admin tRPC mutations in production; constant-time comparison.
- **Rate limiting:** global `/api` slow-down; general tRPC limit (200/min/IP); financial limiter (20/min) on payments/mojaloop/batchPayments/ledger/drawback; admin limiter (10/min) on bulkExport/tenant/keycloak; Redis-backed tRPC rate limiter with fail-closed semantics.
- **AuthN:** Keycloak JWT verification + Manus session cookies; role checks from verified JWT (`keycloakRoleProcedure`) with DB fallback.
- **AuthZ:** `adminProcedure`/`financeProcedure`/role-gated procedures; PBAC (`assertCan`, Permify) on high-risk mutations; per-owner checks on payments/declarations.
- **RLS:** migration `0052_phase6_rls.sql` enforces row-level policies on trader-owned tables (declarations, users, trader_profiles, documents, payments, audit_logs, notifications, cargo_tracking, aeo_applications, fraud_cases); app code uses `withRlsContext`.
- **Financial integrity:** durable DB-backed idempotency keys, distributed locks, HMAC-signed payment confirmations, exact minor-unit money math, fail-closed bridge/scorer outages.
- **Uploads:** magic-byte content sniffing, extension/MIME allowlists, 25 MB cap.
- **Webhooks:** Keycloak webhook HMAC signature check; MSW exchange ingest uses pinned-JWKS JWS + jti replay reserve (fail-closed).
- **Error handling:** tRPC default formatter omits stack traces outside development; hand-rolled routes return generic `internal error` payloads; `/metrics` restricted to internal networks/bearer token.

## Fixes applied in Phase 11

1. **SW-S11-5 — Broken AuthZ on finance mobile aliases (HIGH).** `finance.summary`, `finance.transactions`, `finance.duties`, `finance.clusterSummary` were `protectedProcedure` without the `assertFinanceAccess` role check used by every other finance procedure, exposing platform-wide revenue/payment data to any authenticated trader. Fixed; regression tests added (`server/routers/phase11-security.test.ts`).
2. **SW-S11-1 — IDOR on ledger account reads (HIGH).** `ledger.getAccount`/`ledger.getBalance` allowed any authenticated user to read any TigerBeetle account (including platform revenue accounts and other traders' accounts) by guessing IDs. Reads now enforce the account allowlist plus scoping: finance/admin/customs_officer read all well-formed accounts; traders only `trader-<ownId>-*`. Regression tests added.
3. **SW-S11-2 — Unauthenticated scheduled-job endpoints (MEDIUM).** All 7 `POST /api/scheduled/*` cron handlers were invokable by anyone. New `scheduledJobAuth` middleware requires `Authorization: Bearer ${SCHEDULER_SECRET}` (constant-time compare) and **fails closed (503) in production when the secret is unset**.
4. **SW-S11-3 — Permissive CSP connect-src (MEDIUM).** Production `connect-src` allowed any `https:` origin (exfiltration vector). Now `'self'` + `wss:` in production; development unchanged.
5. **SW-S11-4 — Hardcoded DB credential fallback (MEDIUM).** Boot silently fell back to a source-controlled PostgreSQL password when `DATABASE_URL` was unset. Production now fails closed; the localhost default is development-only.
6. **CORS hardening.** Additional origins now come from `CORS_ALLOWED_ORIGINS` (comma-separated exact origins; HTTPS-only in production); localhost/127.0.0.1 origins are development-only. Wildcard-with-credentials remains impossible.
7. **Webhook rate limiting.** `/api/webhooks/*` and `/api/v1/msw/exchange/*` now have a strict 30 req/min/IP limiter.
8. **Dependency audit.** `pnpm audit --prod` flagged transitive `glob <10.5.0` (GHSA-5j98-mcp5-4vw2, HIGH); fixed via pnpm override to `>=10.5.0`. Audit is now clean.

## Secrets scan

Working-tree scan (private-key blocks, tokens, passwords, connection strings) found **no live credentials**. Findings: local-dev-only default compose credentials (`docker-compose.yml`, `infra/docker-compose.yml`) and the boot fallback removed in fix 5. Committed `.env*` files: only `.env.example` / `.env.compose.example` (placeholders). No secret values are reproduced here.

## RLS coverage note

Tenant-scoped tables (`tenant_keycloak_configs`, `tenant_users`, `tenant_branding`, `document_vault_*`, `consent_records`) are **not** RLS-covered; they are reachable only through `adminProcedure` / owner-scoped procedures (app-level scoping audited in the tenant router). Recommend adding tenant RLS policies in a future migration.

## Residual recommendations

- Tenant-table RLS policies (see above).
- `img-src https:` and `style-src 'unsafe-inline'` remain (required by current UI assets); consider nonced styles and an image allowlist.
- `docker-compose.yml` still carries default dev DB/Keycloak passwords as `${VAR:-default}` — acceptable for local dev; production deploys must override via env (compose prod file already separates concerns).
- `glob` override should be dropped once `@opentelemetry/resource-detector-gcp` updates its `rimraf` chain.
- Consider moving `/metrics` behind mTLS at the ingress layer.

## Validation

- `tsc --noEmit`: 0 errors.
- `vitest run server/routers/phase11-security.test.ts`: 18/18 pass.
- Related suites (`ledger`, `payments`, `drawback`, `mojaloop` remediation tests): 32/32 pass.
- `pnpm audit --prod`: 0 vulnerabilities.
