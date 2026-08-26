#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${DRILL_PROJECT:?source validate-drill-environment.sh first}"
: "${DRILL_COMPOSE_FILE:?source validate-drill-environment.sh first}"
: "${DRILL_ARTIFACT_DIR:?source validate-drill-environment.sh first}"

compose=(docker compose --project-name "${DRILL_PROJECT}" --file "${DRILL_COMPOSE_FILE}")
mkdir -p "${DRILL_ARTIFACT_DIR}"

"${compose[@]}" config >"${DRILL_ARTIFACT_DIR}/compose-resolved.yml" 2>&1 || true
"${compose[@]}" ps --all >"${DRILL_ARTIFACT_DIR}/compose-ps.txt" 2>&1 || true
"${compose[@]}" logs --no-color --timestamps >"${DRILL_ARTIFACT_DIR}/compose.log" 2>&1 || true

if "${compose[@]}" exec --no-TTY toxiproxy sh -c 'wget -qO- http://127.0.0.1:8474/proxies' >"${DRILL_ARTIFACT_DIR}/toxiproxy-proxies.json" 2>/dev/null; then
  :
else
  printf '%s\n' 'Toxiproxy proxy inventory unavailable.' >"${DRILL_ARTIFACT_DIR}/toxiproxy-proxies.json"
fi

if "${compose[@]}" exec --no-TTY runner-lifecycle-collector sh -c 'wget -qO- http://127.0.0.1:9090/metrics' >"${DRILL_ARTIFACT_DIR}/collector-metrics.prom" 2>/dev/null; then
  :
else
  printf '%s\n' '# collector metrics unavailable' >"${DRILL_ARTIFACT_DIR}/collector-metrics.prom"
fi

if [[ -d "${ROOT_DIR}/.artifacts/release-drills/${DRILL_PROJECT}/scenario-results" ]]; then
  cp -a "${ROOT_DIR}/.artifacts/release-drills/${DRILL_PROJECT}/scenario-results" "${DRILL_ARTIFACT_DIR}/" 2>/dev/null || true
fi

# Report possible secret patterns without modifying source logs. Review before sharing artifacts.
grep -RInE '(Authorization:[[:space:]]*Bearer|registration[_-]?token[=:]|client_secret[=:]|password[=:]|api[_-]?key[=:])' "${DRILL_ARTIFACT_DIR}" \
  >"${DRILL_ARTIFACT_DIR}/redaction-scan.txt" 2>/dev/null || true

sha256sum "${DRILL_ARTIFACT_DIR}"/* 2>/dev/null | sort >"${DRILL_ARTIFACT_DIR}/SHA256SUMS" || true
printf '%s\n' "artifacts collected in ${DRILL_ARTIFACT_DIR}"
