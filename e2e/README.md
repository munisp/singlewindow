# TradeGateway™ NGSWTP — End-to-End Test Suite

This directory contains Playwright end-to-end tests covering the top-3 stakeholder journeys in the TradeGateway platform.

## Test Files

| File | Journey | Tests |
|------|---------|-------|
| `trader-declaration.spec.ts` | Trader submits declaration → Customs approves → Payment clears | 20 |
| `aeo-application.spec.ts` | Trader applies for AEO → Admin reviews → Tier awarded | 18 |
| `oga-permit.spec.ts` | Trader requests OGA permit → OGA officer approves | 20 |
| `journey1-declaration-clearance.spec.ts` | Declaration submission & clearance (legacy) | 8 |
| `journey2-aeo-self-assessment.spec.ts` | AEO self-assessment (legacy) | 5 |
| `journey6-full-declaration-flow.spec.ts` | Full declaration flow (extended) | 38 |
| `journey7-payment-clearance-flow.spec.ts` | Payment & clearance flow | 20 |
| `journey8-authenticated-declaration-flow.spec.ts` | Authenticated declaration flow | 20 |
| `journey9-business-rules.spec.ts` | Business rules validation | 15 |

## Prerequisites

```bash
# Install Playwright browsers (first time only)
pnpm exec playwright install chromium firefox

# Or install all browsers
pnpm exec playwright install
```

## Running Tests

```bash
# Run all e2e tests (headless, against local dev server)
pnpm e2e

# Run a specific test file
pnpm e2e -- e2e/trader-declaration.spec.ts

# Run with UI mode (interactive, great for debugging)
pnpm e2e:ui

# Run in headed mode (see the browser)
pnpm e2e:headed

# Run against a specific URL (e.g. Docker Compose stack)
BASE_URL=http://localhost:9000 pnpm e2e

# Run against production (read-only tests only)
BASE_URL=https://your-deployment.example.com pnpm e2e

# View the HTML report after a run
pnpm e2e:report
```

## Running Against Docker Compose

Start the full stack first, then run the tests:

```bash
# Start all services
cp .env.compose .env
docker compose up -d

# Wait for health checks to pass (~2 minutes)
docker compose ps

# Run e2e tests against the Docker stack
BASE_URL=http://localhost:9000 pnpm e2e
```

## Authentication Strategy

The tests use two authentication modes:

**DEMO_MODE** (default for local dev): The server exposes `/api/demo/session` which creates a session without real credentials. Enable with `DEMO_MODE=true` in your `.env`.

**E2E_TEST_MODE** (for CI with real auth): Set `E2E_TEST_MODE=1` to use the `/api/e2e/session` endpoint which provisions real test users. Requires the database to be seeded with test users.

The `global-setup.ts` file handles session provisioning automatically before tests run.

## Test Design Principles

All tests follow these principles:

1. **Resilient to auth state** — Tests check for either authenticated content or a login redirect. They never assume the user is logged in unless a session was explicitly provisioned.

2. **No 500 errors** — Every API call asserts `status !== 500`. Auth failures (401/403) are expected and acceptable.

3. **Page render checks** — Every page test verifies the body has meaningful content (>50 chars) and does not contain "Internal Server Error" or "Cannot GET /".

4. **API contract tests** — tRPC endpoints are called directly via HTTP to verify their shape, independent of the UI.

5. **No test data pollution** — Tests that mutate data (create/approve/reject) use clearly marked test IDs and are designed to fail gracefully when auth is not available.

## CI Integration

Add to your CI pipeline (GitHub Actions example):

```yaml
- name: Install Playwright browsers
  run: pnpm exec playwright install --with-deps chromium

- name: Run e2e tests
  run: BASE_URL=http://localhost:9000 pnpm e2e
  env:
    DEMO_MODE: "true"

- name: Upload Playwright report
  uses: actions/upload-artifact@v4
  if: always()
  with:
    name: playwright-report
    path: playwright-report/
    retention-days: 30
```

## Troubleshooting

**Tests fail with "net::ERR_CONNECTION_REFUSED"**: The dev server is not running. Start it with `pnpm dev` or `docker compose up -d`.

**Tests fail with "401 Unauthorized"**: Expected for mutation tests without a session. If page render tests fail with 401, check that `DEMO_MODE=true` is set.

**Tests are slow**: Playwright runs tests in parallel by default. On CI, set `workers: 1` in `playwright.config.ts` to avoid DB contention.

**Flaky tests**: Increase timeouts in `playwright.config.ts` or add explicit `waitForLoadState("networkidle")` calls.
