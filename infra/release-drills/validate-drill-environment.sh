#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

fail() {
  echo "release-drill safety check failed: $*" >&2
  exit 64
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "${name} must be set"
}

url_host() {
  local value="$1"
  value="${value#*://}"
  value="${value%%/*}"
  value="${value%%:*}"
  printf '%s' "$value"
}

# Explicit consent and staging-only boundary are checked before Docker is called.
require_env DRILL_ENV
require_env ALLOW_FAULT_INJECTION
require_env DRILL_PROJECT
[[ "${DRILL_ENV}" == "staging" ]] || fail "DRILL_ENV must equal staging"
[[ "${ALLOW_FAULT_INJECTION}" == "1" ]] || fail "ALLOW_FAULT_INJECTION must equal 1"
[[ "${DRILL_PROJECT}" =~ ^singlewindow-drill-[a-z0-9][a-z0-9_-]{5,80}$ ]] || fail "DRILL_PROJECT must begin with singlewindow-drill- and use only lowercase letters, digits, _ or -"

if [[ -n "${GITHUB_REPOSITORY:-}" && "${GITHUB_REPOSITORY}" != "munisp/singlewindow" ]]; then
  fail "GITHUB_REPOSITORY must be munisp/singlewindow when supplied"
fi
if [[ -n "${GITHUB_REF:-}" && "${GITHUB_REF}" == *"production"* ]]; then
  fail "release drills are not permitted from a production ref"
fi

export DRILL_DATABASE_NAME="${DRILL_DATABASE_NAME:-tradegateway_drill}"
[[ "${DRILL_DATABASE_NAME}" =~ ^tradegateway_drill(_[a-z0-9_]+)?$ ]] || fail "DRILL_DATABASE_NAME must be a dedicated tradegateway_drill database"
export DRILL_MAX_SECONDS="${DRILL_MAX_SECONDS:-1800}"
[[ "${DRILL_MAX_SECONDS}" =~ ^[0-9]+$ ]] || fail "DRILL_MAX_SECONDS must be an integer"
(( DRILL_MAX_SECONDS >= 60 && DRILL_MAX_SECONDS <= 3600 )) || fail "DRILL_MAX_SECONDS must be between 60 and 3600"

export DRILL_COMPOSE_FILE="${DRILL_COMPOSE_FILE:-${ROOT_DIR}/infra/release-drills/compose.yml}"
[[ -f "${DRILL_COMPOSE_FILE}" ]] || fail "DRILL_COMPOSE_FILE does not exist"
export DRILL_ARTIFACT_DIR="${DRILL_ARTIFACT_DIR:-${ROOT_DIR}/.artifacts/release-drills/${DRILL_PROJECT}}"
case "${DRILL_ARTIFACT_DIR}" in
  "${ROOT_DIR}"/.artifacts/release-drills/*) ;;
  *) fail "DRILL_ARTIFACT_DIR must be inside ${ROOT_DIR}/.artifacts/release-drills" ;;
esac

# RD-1 is entirely local. RD-2 through RD-8 must use real isolated staging
# implementations and an operator-supplied allow-list; no local fake is accepted as
# release evidence for provider, authorization, or funds-flow behavior.
export DRILL_DATABASE_HOST="${DRILL_DATABASE_HOST:-postgres}"
export DRILL_REDIS_HOST="${DRILL_REDIS_HOST:-redis}"
export DRILL_TOXIPROXY_HOST="${DRILL_TOXIPROXY_HOST:-toxiproxy}"
if [[ "${DRILL_REQUIRE_REAL_INTEGRATIONS:-false}" == "true" ]]; then
  require_env DRILL_APPROVED_TARGETS_FILE
  require_env DRILL_API_BASE_URL
  require_env DRILL_PAYMENT_SANDBOX_URL
  require_env DRILL_AUTHORIZATION_URL
  require_env DRILL_DATABASE_DSN_FILE
  require_env DRILL_REAL_ADAPTER_DIR
  [[ -r "${DRILL_APPROVED_TARGETS_FILE}" ]] || fail "DRILL_APPROVED_TARGETS_FILE is unreadable"
  [[ -r "${DRILL_DATABASE_DSN_FILE}" ]] || fail "DRILL_DATABASE_DSN_FILE is unreadable"
  [[ -d "${DRILL_REAL_ADAPTER_DIR}" ]] || fail "DRILL_REAL_ADAPTER_DIR is not a directory"
  [[ "${DRILL_API_BASE_URL}" == https://* && "${DRILL_PAYMENT_SANDBOX_URL}" == https://* && "${DRILL_AUTHORIZATION_URL}" == https://* ]] || fail "real integration URLs must use HTTPS"
  for host in "$(url_host "${DRILL_API_BASE_URL}")" "$(url_host "${DRILL_PAYMENT_SANDBOX_URL}")" "$(url_host "${DRILL_AUTHORIZATION_URL}")"; do
    case "${host}" in
      localhost|127.*|0.*|payment-gateway|notification-gateway) fail "local fake target is prohibited for real release evidence: ${host}" ;;
      *prod*|*production*|*live*) fail "production-like target is prohibited: ${host}" ;;
    esac
    grep -Fxq "${host}" "${DRILL_APPROVED_TARGETS_FILE}" || fail "target ${host} is absent from the approved staging target inventory"
  done
  database_dsn="$(<"${DRILL_DATABASE_DSN_FILE}")"
  [[ "${database_dsn}" == postgresql://* || "${database_dsn}" == postgres://* ]] || fail "DRILL_DATABASE_DSN_FILE must contain a PostgreSQL DSN"
  database_host="$(url_host "${database_dsn}")"
  case "${database_host}" in
    localhost|127.*|0.*|*prod*|*production*|*live*) fail "database DSN must not target production or localhost" ;;
  esac
  grep -Fxq "${database_host}" "${DRILL_APPROVED_TARGETS_FILE}" || fail "database host ${database_host} is absent from the approved staging target inventory"
else
  for host in "${DRILL_DATABASE_HOST}" "${DRILL_REDIS_HOST}" "${DRILL_TOXIPROXY_HOST}"; do
    case "${host}" in
      postgres|redis|toxiproxy) ;;
      *) fail "target host ${host} is not an approved disposable drill service" ;;
    esac
  done
fi

command -v docker >/dev/null || fail "Docker is required after safety validation"
docker compose version >/dev/null || fail "Docker Compose v2 is required after safety validation"

mkdir -p "${DRILL_ARTIFACT_DIR}"
printf '%s\n' "validated project=${DRILL_PROJECT} environment=${DRILL_ENV} database=${DRILL_DATABASE_NAME}" >"${DRILL_ARTIFACT_DIR}/safety-validation.txt"
printf '%s\n' "release-drill safety validation passed for ${DRILL_PROJECT}"
