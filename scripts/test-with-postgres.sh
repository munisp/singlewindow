#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/test-environment/compose.yml"
PROJECT_NAME="${TEST_COMPOSE_PROJECT:-singlewindow-test-db}"
TEST_POSTGRES_DB="${TEST_POSTGRES_DB:-tradegateway_test}"
TEST_POSTGRES_USER="${TEST_POSTGRES_USER:-tradegateway}"
TEST_POSTGRES_PASSWORD="${TEST_POSTGRES_PASSWORD:-tradegateway}"
TEST_POSTGRES_PORT="${TEST_POSTGRES_PORT:-55432}"
KEEP_ENVIRONMENT="false"

usage() {
  cat <<'USAGE'
Usage:
  scripts/test-with-postgres.sh [--keep] [vitest file or option ...]

Starts an isolated PostgreSQL 16 container, applies the Drizzle schema, loads the
comprehensive deterministic seed, runs Vitest, then removes the test environment.

Examples:
  scripts/test-with-postgres.sh server/v80.test.ts server/v81.test.ts server/v83.test.ts
  scripts/test-with-postgres.sh
  scripts/test-with-postgres.sh --keep server/v83.test.ts

Use TEST_POSTGRES_PORT to override the default host port 55432.
USAGE
}

if [[ "${1:-}" == "--keep" ]]; then
  KEEP_ENVIRONMENT="true"
  shift
fi
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

command -v docker >/dev/null || { echo "Docker is required." >&2; exit 69; }
docker compose version >/dev/null || { echo "Docker Compose v2 is required." >&2; exit 69; }
test -x "${ROOT_DIR}/node_modules/.bin/vitest" || { echo "Install repository dependencies before running this script." >&2; exit 69; }

compose=(docker compose --project-name "${PROJECT_NAME}" --file "${COMPOSE_FILE}")
cleanup() {
  local status="$?"
  trap - EXIT
  if [[ "${KEEP_ENVIRONMENT}" == "true" ]]; then
    echo "Keeping the test PostgreSQL container for inspection: ${PROJECT_NAME}."
  else
    "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  exit "${status}"
}
trap cleanup EXIT

export TEST_POSTGRES_DB TEST_POSTGRES_USER TEST_POSTGRES_PASSWORD TEST_POSTGRES_PORT
export DATABASE_URL="postgresql://${TEST_POSTGRES_USER}:${TEST_POSTGRES_PASSWORD}@127.0.0.1:${TEST_POSTGRES_PORT}/${TEST_POSTGRES_DB}"
export NODE_ENV=test

"${compose[@]}" up --detach --wait

for attempt in $(seq 1 30); do
  if "${compose[@]}" exec --no-TTY postgres pg_isready -U "${TEST_POSTGRES_USER}" -d "${TEST_POSTGRES_DB}" >/dev/null 2>&1; then
    break
  fi
  if [[ "${attempt}" == "30" ]]; then
    "${compose[@]}" logs postgres >&2 || true
    echo "PostgreSQL did not become ready within 30 seconds." >&2
    exit 70
  fi
  sleep 1
done

cd "${ROOT_DIR}"
pnpm exec drizzle-kit push --force
node scripts/seed-comprehensive.mjs
node scripts/seed-postgres-integration-fixtures.mjs

if [[ "$#" -eq 0 ]]; then
  ./node_modules/.bin/vitest run --coverage.enabled=false
else
  ./node_modules/.bin/vitest run "$@" --coverage.enabled=false
fi
