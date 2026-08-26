#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="pr-smoke"
SCENARIOS="RD-1"
KEEP_ENVIRONMENT="false"

usage() {
  cat <<'USAGE'
Usage:
  DRILL_ENV=staging ALLOW_FAULT_INJECTION=1 DRILL_PROJECT=singlewindow-drill-<unique-id> \
    infra/release-drills/run-release-drills.sh [--mode pr-smoke|release] [--scenarios RD-1,RD-2] [--keep]

The script refuses to run until the staging-only environment validator succeeds.
PR smoke defaults to RD-1. Release mode requires explicit scenarios and fails if a
requested scenario script has not been implemented; it never silently skips a drill.
USAGE
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:?missing mode}"; shift 2 ;;
    --scenarios) SCENARIOS="${2:?missing scenario list}"; shift 2 ;;
    --keep) KEEP_ENVIRONMENT="true"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 64 ;;
  esac
done

case "${MODE}" in
  pr-smoke|release) ;;
  *) echo "Unsupported mode: ${MODE}" >&2; exit 64 ;;
esac

IFS=',' read -r -a requested <<<"${SCENARIOS}"
export DRILL_REQUIRE_REAL_INTEGRATIONS="false"
for raw_scenario in "${requested[@]}"; do
  scenario="$(printf '%s' "${raw_scenario}" | tr '[:lower:]' '[:upper:]' | tr -d '[:space:]')"
  if [[ "${scenario}" != "RD-1" ]]; then
    export DRILL_REQUIRE_REAL_INTEGRATIONS="true"
  fi
done

# Must be sourced so the validated exports are available to this process.
# shellcheck source=validate-drill-environment.sh
source "${ROOT_DIR}/infra/release-drills/validate-drill-environment.sh"
compose=(docker compose --project-name "${DRILL_PROJECT}" --file "${DRILL_COMPOSE_FILE}")
started="false"
result_dir="${DRILL_ARTIFACT_DIR}/scenario-results"
mkdir -p "${result_dir}"

cleanup() {
  local status="$?"
  trap - EXIT INT TERM
  "${ROOT_DIR}/infra/release-drills/collect-artifacts.sh" || true
  if [[ "${KEEP_ENVIRONMENT}" == "true" ]]; then
    echo "Keeping validated drill project ${DRILL_PROJECT} for inspection."
  else
    "${compose[@]}" down --volumes --remove-orphans >"${DRILL_ARTIFACT_DIR}/cleanup.log" 2>&1 || true
  fi
  printf '{"project":"%s","mode":"%s","exit_code":%s,"cleanup":"%s"}\n' \
    "${DRILL_PROJECT}" "${MODE}" "${status}" "$( [[ "${KEEP_ENVIRONMENT}" == "true" ]] && printf 'kept' || printf 'attempted' )" \
    >"${DRILL_ARTIFACT_DIR}/drill-result.json"
  exit "${status}"
}
trap cleanup EXIT INT TERM

"${compose[@]}" up --detach --wait
started="true"

export DRILL_COLLECTOR_EVENT_URL="${DRILL_COLLECTOR_EVENT_URL:-http://127.0.0.1:${DRILL_COLLECTOR_PORT:-19090}/v1/events}"
export DRILL_COLLECTOR_TOKEN="${DRILL_COLLECTOR_TOKEN:-drill-token}"
emit_drill_event() {
  local payload="$1"
  curl --fail --silent --show-error --max-time 10 \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${DRILL_COLLECTOR_TOKEN}" \
    --data "${payload}" "${DRILL_COLLECTOR_EVENT_URL}" >/dev/null
}
evidence_for() {
  case "$1" in
    RD-1) printf '%s' '["metrics"]' ;;
    RD-2) printf '%s' '["database","audit","outbox","metrics"]' ;;
    RD-3) printf '%s' '["database","audit","provider","reconciliation","metrics"]' ;;
    RD-4) printf '%s' '["provider","reconciliation","metrics"]' ;;
    RD-5) printf '%s' '["outbox","logs","redaction","metrics"]' ;;
    RD-6) printf '%s' '["authorization","audit","metrics"]' ;;
    RD-7) printf '%s' '["cleanup","logs","metrics"]' ;;
    RD-8) printf '%s' '["logs","metrics","dashboard","alert","redaction"]' ;;
  esac
}

for raw_scenario in "${requested[@]}"; do
  scenario="$(printf '%s' "${raw_scenario}" | tr '[:lower:]' '[:upper:]' | tr -d '[:space:]')"
  case "${scenario}" in
    RD-1) script="${ROOT_DIR}/infra/release-drills/scenarios/redis-quorum-fence.sh" ;;
    RD-2) script="${ROOT_DIR}/infra/release-drills/scenarios/postgres-declaration-transaction.sh" ;;
    RD-3) script="${ROOT_DIR}/infra/release-drills/scenarios/postgres-payment-confirmation.sh" ;;
    RD-4) script="${ROOT_DIR}/infra/release-drills/scenarios/payment-timeout-and-retry.sh" ;;
    RD-5) script="${ROOT_DIR}/infra/release-drills/scenarios/notification-failure.sh" ;;
    RD-6) script="${ROOT_DIR}/infra/release-drills/scenarios/authorization-unavailable.sh" ;;
    RD-7) script="${ROOT_DIR}/infra/release-drills/scenarios/runner-cleanup.sh" ;;
    RD-8) script="${ROOT_DIR}/infra/release-drills/scenarios/observability-durability.sh" ;;
    *) echo "Unknown scenario: ${scenario}" >&2; exit 64 ;;
  esac
  if [[ ! -x "${script}" ]]; then
    echo "Scenario ${scenario} is not implemented at ${script}; refusing a false-green ${MODE} drill." >&2
    exit 65
  fi
  drill_id="${DRILL_PROJECT}-${scenario}"
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  emit_drill_event "{\"event\":\"drill_started\",\"repository\":\"munisp/singlewindow\",\"drill_id\":\"${drill_id}\",\"scenario_id\":\"${scenario}\",\"timestamp\":\"${timestamp}\"}"
  echo "Running ${scenario} with a ${DRILL_MAX_SECONDS}-second global bound."
  set +e
  timeout --preserve-status "${DRILL_MAX_SECONDS}s" "${script}"
  scenario_status="$?"
  set -e
  completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "${scenario_status}" -eq 0 ]]; then
    emit_drill_event "{\"event\":\"drill_completed\",\"repository\":\"munisp/singlewindow\",\"drill_id\":\"${drill_id}\",\"scenario_id\":\"${scenario}\",\"result\":\"passed\",\"timestamp\":\"${completed_at}\",\"evidence_classes\":$(evidence_for "${scenario}")}"
  else
    emit_drill_event "{\"event\":\"drill_completed\",\"repository\":\"munisp/singlewindow\",\"drill_id\":\"${drill_id}\",\"scenario_id\":\"${scenario}\",\"result\":\"failed\",\"timestamp\":\"${completed_at}\",\"evidence_classes\":[]}"
    exit "${scenario_status}"
  fi
done

echo "All requested release drills passed: ${SCENARIOS}"
