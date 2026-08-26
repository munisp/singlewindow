#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCENARIO_ID="${1:?scenario ID is required}"
: "${DRILL_REQUIRE_REAL_INTEGRATIONS:?real integration validation is required}"
: "${DRILL_ARTIFACT_DIR:?source validate-drill-environment.sh first}"
: "${DRILL_REAL_ADAPTER_DIR:?set DRILL_REAL_ADAPTER_DIR to the approved real-integration scenario adapters}"

[[ "${DRILL_REQUIRE_REAL_INTEGRATIONS}" == "true" ]] || { echo "${SCENARIO_ID} requires real integration mode" >&2; exit 64; }
[[ -d "${DRILL_REAL_ADAPTER_DIR}" ]] || { echo "DRILL_REAL_ADAPTER_DIR is not a directory" >&2; exit 64; }
adapter="${DRILL_REAL_ADAPTER_DIR}/${SCENARIO_ID}.sh"
[[ -x "${adapter}" ]] || { echo "${SCENARIO_ID} adapter is absent or not executable: ${adapter}" >&2; exit 65; }

result_dir="${DRILL_ARTIFACT_DIR}/scenario-results"
mkdir -p "${result_dir}"
result_file="${result_dir}/${SCENARIO_ID}.json"
log_file="${result_dir}/${SCENARIO_ID}.log"

# The adapter must perform the actual authenticated scenario against approved
# staging/sandbox services. It receives no production secret or endpoint from this
# repository, and must write the required evidence JSON at the supplied path.
set +e
timeout --preserve-status "${DRILL_MAX_SECONDS}s" "${adapter}" "${result_file}" 2>&1 | tee "${log_file}"
status="${PIPESTATUS[0]}"
set -e
[[ "${status}" -eq 0 ]] || exit "${status}"
[[ -s "${result_file}" ]] || { echo "${SCENARIO_ID} adapter returned success without result evidence" >&2; exit 66; }

node --input-type=module - "${SCENARIO_ID}" "${result_file}" <<'NODE'
import fs from "node:fs";

const [scenarioId, resultFile] = process.argv.slice(2);
const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
const common = ["scenario_id", "result", "invariant", "started_at", "finished_at", "environment", "evidence"];
const requiredEvidence = {
  "RD-2": ["declaration_before", "declaration_after", "audit_records", "outbox_records", "retry_result", "database_fault"],
  "RD-3": ["payment_before", "payment_after", "declaration_after", "ledger_records", "reconciliation", "database_fault"],
  "RD-4": ["payment_intent", "provider_operation", "provider_status_lookup", "duplicate_request_result", "reconciliation"],
  "RD-5": ["domain_state", "notification_delivery", "retry_or_outbox", "redaction_scan"],
  "RD-6": ["authorization_request", "deny_result", "cross_tenant_result", "audit_records"],
  "RD-7": ["project_resources_before", "project_resources_after", "unrelated_resources_untouched", "artifact_bundle"],
  "RD-8": ["destroyed_runner_log", "collector_metric", "prometheus_query", "grafana_panel", "alert_state"],
};
for (const key of common) {
  if (!(key in result)) throw new Error(`${scenarioId} result is missing ${key}`);
}
if (result.scenario_id !== scenarioId) throw new Error(`scenario ID mismatch: ${result.scenario_id}`);
if (result.result !== "passed") throw new Error(`${scenarioId} result is not passed: ${result.result}`);
if (result.environment !== "staging") throw new Error(`${scenarioId} evidence is not staging`);
if (result.evidence?.test_double === true || result.evidence?.provider_mode === "fake" || result.evidence?.provider_mode === "mock") {
  throw new Error(`${scenarioId} uses a test double and is not valid release evidence`);
}
for (const key of requiredEvidence[scenarioId] ?? []) {
  if (!(key in result.evidence)) throw new Error(`${scenarioId} evidence is missing ${key}`);
}
NODE

printf '%s\n' "${SCENARIO_ID} real-integration evidence validated: ${result_file}"
