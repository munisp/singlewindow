#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
: "${DRILL_ARTIFACT_DIR:?source validate-drill-environment.sh first}"
RESULT_DIR="${DRILL_ARTIFACT_DIR}/scenario-results"
mkdir -p "${RESULT_DIR}"

export TOXIPROXY_API="http://127.0.0.1:${DRILL_TOXIPROXY_API_PORT:-18474}"
export REDIS_ADMIN_PORT="${DRILL_REDIS_PORT:-56379}"
export REDIS_PROXY_A_PORT="${DRILL_REDIS_PROXY_A_PORT:-26379}"
export REDIS_PROXY_B_PORT="${DRILL_REDIS_PROXY_B_PORT:-26380}"
export TOXIPROXY_UPSTREAM="redis:6379"

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
set +e
python3 -m pytest -q "${ROOT_DIR}/tests/chaos/test_quorum_fence_toxiproxy.py" \
  2>&1 | tee "${RESULT_DIR}/RD-1-redis-quorum-fence.log"
status="${PIPESTATUS[0]}"
set -e
finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat >"${RESULT_DIR}/RD-1-redis-quorum-fence.json" <<EOF
{
  "scenario_id": "RD-1",
  "name": "Redis quorum fence through Toxiproxy",
  "started_at": "${started_at}",
  "finished_at": "${finished_at}",
  "result": "$( [[ "${status}" -eq 0 ]] && printf 'passed' || printf 'failed' )",
  "exit_code": ${status},
  "invariant": "No split brain; stale fence writes are rejected; circuit breaker recovers only after a successful healed probe.",
  "artifact": "scenario-results/RD-1-redis-quorum-fence.log"
}
EOF

exit "${status}"
