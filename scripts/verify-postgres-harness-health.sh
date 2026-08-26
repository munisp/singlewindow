#!/usr/bin/env bash
# Verifies the isolated Docker PostgreSQL harness used by SingleWindow integration tests.
# It never uses a caller-provided DATABASE_URL and always targets the project-local Compose file.
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/test-environment/compose.yml"
RUN_DB_SUITES="false"
KEEP_ENVIRONMENT="false"
TEST_POSTGRES_DB="${TEST_POSTGRES_DB:-tradegateway_test}"
TEST_POSTGRES_USER="${TEST_POSTGRES_USER:-tradegateway}"
TEST_POSTGRES_PASSWORD="${TEST_POSTGRES_PASSWORD:-tradegateway}"
TEST_POSTGRES_PORT="${TEST_POSTGRES_PORT:-55432}"
PROJECT_NAME="${TEST_COMPOSE_PROJECT:-singlewindow-harness-health-$(date -u +%Y%m%d%H%M%S)-$$}"

usage() {
  cat <<'USAGE'
Usage: scripts/verify-postgres-harness-health.sh [--run-db-suites] [--keep]

Checks that Docker Compose can start the repository's isolated PostgreSQL 16 test
harness, that PostgreSQL is ready and reachable through the test-only connection,
and that the expected database identity is present.

Options:
  --run-db-suites  Push the Drizzle schema, apply deterministic fixtures, and run
                   the historical PostgreSQL-dependent Vitest suites (v79–v83).
  --keep           Retain the disposable Docker Compose project for manual inspection.
  --help           Show this help.

Environment:
  TEST_COMPOSE_PROJECT   Explicit unique Compose project name. Defaults to a UTC/ PID name.
  TEST_POSTGRES_PORT     Host port for the disposable database. Defaults to 55432.
  TEST_POSTGRES_DB       Test database name. Defaults to tradegateway_test.
  TEST_POSTGRES_USER     Test database user. Defaults to tradegateway.
  TEST_POSTGRES_PASSWORD Test database password. Defaults to tradegateway.
USAGE
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --run-db-suites) RUN_DB_SUITES="true" ;;
    --keep) KEEP_ENVIRONMENT="true" ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

fail() {
  echo "HARNESS HEALTH: FAIL — $*" >&2
  exit 69
}

command -v docker >/dev/null || fail "Docker is required."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."
[[ -f "${COMPOSE_FILE}" ]] || fail "Compose file not found: ${COMPOSE_FILE}"

compose=(docker compose --project-name "${PROJECT_NAME}" --file "${COMPOSE_FILE}")
cleanup() {
  local status="$?"
  trap - EXIT
  if [[ "${KEEP_ENVIRONMENT}" == "true" ]]; then
    echo "HARNESS HEALTH: retained project ${PROJECT_NAME} for inspection."
  else
    "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  exit "${status}"
}
trap cleanup EXIT

export TEST_POSTGRES_DB TEST_POSTGRES_USER TEST_POSTGRES_PASSWORD TEST_POSTGRES_PORT
export DATABASE_URL="postgresql://${TEST_POSTGRES_USER}:${TEST_POSTGRES_PASSWORD}@127.0.0.1:${TEST_POSTGRES_PORT}/${TEST_POSTGRES_DB}"
export NODE_ENV=test

# Validates Compose rendering before creating resources.
"${compose[@]}" config -q

echo "HARNESS HEALTH: starting isolated project ${PROJECT_NAME} on port ${TEST_POSTGRES_PORT}."
"${compose[@]}" up --detach --wait

for attempt in $(seq 1 30); do
  if "${compose[@]}" exec --no-TTY postgres pg_isready -U "${TEST_POSTGRES_USER}" -d "${TEST_POSTGRES_DB}" >/dev/null 2>&1; then
    break
  fi
  if [[ "${attempt}" == "30" ]]; then
    "${compose[@]}" logs postgres >&2 || true
    fail "PostgreSQL did not become ready within 30 seconds."
  fi
  sleep 1
done

identity="$("${compose[@]}" exec --no-TTY postgres psql -Atqc "SELECT current_database() || ':' || current_user || ':' || current_setting('server_version_num');" -U "${TEST_POSTGRES_USER}" -d "${TEST_POSTGRES_DB}")"
[[ "${identity}" == "${TEST_POSTGRES_DB}:${TEST_POSTGRES_USER}:"* ]] || fail "Unexpected PostgreSQL identity: ${identity}"
echo "HARNESS HEALTH: PASS — PostgreSQL ready (${identity}); DATABASE_URL is test-only host port ${TEST_POSTGRES_PORT}."

if [[ "${RUN_DB_SUITES}" == "true" ]]; then
  [[ -x "${ROOT_DIR}/node_modules/.bin/vitest" ]] || fail "Install repository dependencies with pnpm install --frozen-lockfile first."
  cd "${ROOT_DIR}"
  echo "HARNESS HEALTH: applying schema and deterministic integration fixtures."
  pnpm exec drizzle-kit push --force
  node scripts/seed-comprehensive.mjs
  node scripts/seed-postgres-integration-fixtures.mjs
  ./node_modules/.bin/vitest run --coverage.enabled=false \
    server/v79.test.ts server/v80.test.ts server/v81.test.ts server/v82.test.ts server/v83.test.ts
  echo "HARNESS HEALTH: PASS — historical PostgreSQL-dependent suites completed."
fi
