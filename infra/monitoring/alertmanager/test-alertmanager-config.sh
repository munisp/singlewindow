#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Alertmanager Configuration & Alert Routing Smoke Tests
# Sprint 88 — CI Smoke Test Suite
#
# Purpose:
#   Validate the Alertmanager config YAML is syntactically correct and that
#   alert routing rules send each alert type to the correct receiver(s).
#
# Prerequisites:
#   - amtool (Alertmanager CLI) must be installed
#     Install: go install github.com/prometheus/alertmanager/cmd/amtool@latest
#     Or via apt: apt-get install prometheus-alertmanager (includes amtool)
#   - The alertmanager-config.yaml must be in the same directory as this script
#
# Usage:
#   ./test-alertmanager-config.sh           # Run all tests
#   ./test-alertmanager-config.sh --verbose # Show amtool output for each test
#   ./test-alertmanager-config.sh --check-only # Only run amtool check-config
#
# Exit codes:
#   0 — All tests passed
#   1 — One or more tests failed
#   2 — Prerequisites not met (amtool not found)
#
# Routing semantics:
#   amtool config routes test returns a comma-separated list of ALL matching
#   receivers (because continue=true allows multiple routes to match).
#   Tests use "contains" checks, not exact equality, to account for this.
#   For example, a critical payment alert matches BOTH pagerduty-critical
#   (severity=critical route) AND pagerduty-financial (service=payment route).
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/alertmanager-config.yaml"
VERBOSE="${VERBOSE:-false}"
CHECK_ONLY="${CHECK_ONLY:-false}"
PASS=0
FAIL=0
SKIP=0

# ─── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

# ─── Argument parsing ─────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --verbose) VERBOSE=true ;;
    --check-only) CHECK_ONLY=true ;;
    --help)
      sed -n '2,30p' "$0" | grep '^#' | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

# ─── Helpers ──────────────────────────────────────────────────────────────────
log_info()    { echo -e "${BLUE}[INFO]${RESET} $*"; }
log_pass()    { echo -e "${GREEN}[PASS]${RESET} $*"; PASS=$((PASS + 1)); }
log_fail()    { echo -e "${RED}[FAIL]${RESET} $*"; FAIL=$((FAIL + 1)); }
log_skip()    { echo -e "${YELLOW}[SKIP]${RESET} $*"; SKIP=$((SKIP + 1)); }
log_section() { echo -e "\n${BOLD}${BLUE}══ $* ══${RESET}"; }

# ─── Prerequisites ────────────────────────────────────────────────────────────
check_prerequisites() {
  log_section "Prerequisites"

  if ! command -v amtool &>/dev/null; then
    echo -e "${RED}ERROR: amtool not found in PATH${RESET}"
    echo ""
    echo "Install options:"
    echo "  1. Go install:  go install github.com/prometheus/alertmanager/cmd/amtool@latest"
    echo "  2. Apt:         sudo apt-get install -y prometheus-alertmanager"
    echo "  3. Download:    wget https://github.com/prometheus/alertmanager/releases/download/v0.27.0/alertmanager-0.27.0.linux-amd64.tar.gz"
    echo ""
    echo "For CI (GitHub Actions), add this step before running this script:"
    echo "  - name: Install amtool"
    echo "    run: |"
    echo "      wget -q https://github.com/prometheus/alertmanager/releases/download/v0.27.0/alertmanager-0.27.0.linux-amd64.tar.gz"
    echo "      tar xzf alertmanager-*.tar.gz"
    echo "      sudo mv alertmanager-*/amtool /usr/local/bin/"
    exit 2
  fi

  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo -e "${RED}ERROR: Config file not found: ${CONFIG_FILE}${RESET}"
    exit 2
  fi

  log_info "amtool version: $(amtool --version 2>&1 | head -1)"
  log_info "Config file: ${CONFIG_FILE}"
}

# ─── Test 1: Syntax validation ────────────────────────────────────────────────
test_config_syntax() {
  log_section "Test 1: Config Syntax Validation"

  local output
  if output=$(amtool check-config "$CONFIG_FILE" 2>&1); then
    log_pass "amtool check-config passed"
    [[ "$VERBOSE" == "true" ]] && echo "$output"
  else
    log_fail "amtool check-config FAILED"
    echo "$output"
  fi
}

# ─── Route matching helper ────────────────────────────────────────────────────
# Usage: assert_route_contains <test_name> <expected_receiver> [label=value ...]
#
# amtool config routes test returns ALL matching receivers (comma-separated)
# because routes use continue=true. This helper checks that the expected
# receiver appears ANYWHERE in the output, not as the only match.
assert_route_contains() {
  local test_name="$1"
  local expected_receiver="$2"
  shift 2
  local labels=("$@")

  local output
  output=$(amtool config routes test --config.file="$CONFIG_FILE" "${labels[@]}" 2>&1)

  [[ "$VERBOSE" == "true" ]] && echo "  amtool output: $output"

  if echo "$output" | grep -qF "$expected_receiver"; then
    log_pass "$test_name → includes receiver: $expected_receiver (full: $output)"
  else
    log_fail "$test_name → expected '$expected_receiver' in output, got: $output"
  fi
}

# ─── Test 2: YAML structure validation ───────────────────────────────────────
test_yaml_structure() {
  log_section "Test 2: YAML Structure Validation"

  # Verify required top-level keys exist in the config
  local required_keys=("global:" "route:" "receivers:" "inhibit_rules:")
  for key in "${required_keys[@]}"; do
    if grep -q "^${key}" "$CONFIG_FILE"; then
      log_pass "Config has required key: ${key}"
    else
      log_fail "Config missing required key: ${key}"
    fi
  done

  # Verify all referenced receivers are defined
  local receivers
  receivers=$(grep -E '^\s+receiver:' "$CONFIG_FILE" | awk '{print $2}' | tr -d '"' | sort -u)
  local defined_receivers
  defined_receivers=$(grep -E '^\s+- name:' "$CONFIG_FILE" | awk '{print $3}' | tr -d '"' | sort -u)

  while IFS= read -r receiver; do
    if echo "$defined_receivers" | grep -qxF "$receiver"; then
      log_pass "Receiver '$receiver' is defined"
    else
      log_fail "Receiver '$receiver' is referenced but NOT defined"
    fi
  done <<< "$receivers"
}

# ─── Test 3: Critical alert routing ──────────────────────────────────────────
test_critical_routing() {
  log_section "Test 3: Critical Alert Routing"

  # Critical alerts must route to pagerduty-critical AND slack-ops-critical
  assert_route_contains \
    "Critical severity → pagerduty-critical" \
    "pagerduty-critical" \
    "severity=critical" "alertname=ServiceDown" "service=declaration-engine"

  assert_route_contains \
    "Critical severity → slack-ops-critical" \
    "slack-ops-critical" \
    "severity=critical" "alertname=ServiceDown" "service=declaration-engine"
}

# ─── Test 4: Payment/financial alert routing ──────────────────────────────────
test_payment_routing() {
  log_section "Test 4: Payment/Financial Alert Routing"

  # Payment service (warning) → pagerduty-financial + slack-finance
  assert_route_contains \
    "Payment service (warning) → pagerduty-financial" \
    "pagerduty-financial" \
    "service=payment" "alertname=PaymentGatewayDown" "severity=warning"

  assert_route_contains \
    "Mojaloop service → pagerduty-financial" \
    "pagerduty-financial" \
    "service=mojaloop" "alertname=MojaloopDown" "severity=warning"

  assert_route_contains \
    "TigerBeetle service (warning) → pagerduty-financial" \
    "pagerduty-financial" \
    "service=tigerbeetle" "alertname=LedgerDown" "severity=warning"

  assert_route_contains \
    "Ledger service → slack-finance" \
    "slack-finance" \
    "service=ledger" "alertname=LedgerLagHigh" "severity=warning"
}

# ─── Test 5: Security alert routing ──────────────────────────────────────────
test_security_routing() {
  log_section "Test 5: Security Alert Routing"

  # Wazuh (warning) → pagerduty-security + slack-security
  assert_route_contains \
    "Wazuh SIEM (warning) → pagerduty-security" \
    "pagerduty-security" \
    "service=wazuh" "alertname=WazuhAgentDown" "severity=warning"

  assert_route_contains \
    "Wazuh SIEM → slack-security" \
    "slack-security" \
    "service=wazuh" "alertname=WazuhAgentDown" "severity=warning"

  assert_route_contains \
    "Sanctions service → slack-security" \
    "slack-security" \
    "service=sanctions" "alertname=SanctionsListStale" "severity=warning"

  assert_route_contains \
    "Threat intel (warning) → pagerduty-security" \
    "pagerduty-security" \
    "service=threat-intel" "alertname=ThreatIntelDown" "severity=warning"
}

# ─── Test 6: Customs operations routing ───────────────────────────────────────
test_customs_routing() {
  log_section "Test 6: Customs Operations Routing"

  assert_route_contains \
    "Declaration service → slack-customs-ops" \
    "slack-customs-ops" \
    "service=declaration" "alertname=DeclarationEngineDown" "severity=warning"

  assert_route_contains \
    "Risk engine → slack-customs-ops" \
    "slack-customs-ops" \
    "service=risk" "alertname=RiskEngineHighLatency" "severity=warning"

  assert_route_contains \
    "Clearance SLA → slack-customs-ops" \
    "slack-customs-ops" \
    "service=clearance" "alertname=GreenLaneClearanceExceedsSLA" "severity=warning"

  assert_route_contains \
    "OGA integration (warning) → slack-customs-ops" \
    "slack-customs-ops" \
    "service=oga" "alertname=OGAIntegrationDown" "severity=warning"
}

# ─── Test 7: Infrastructure routing ───────────────────────────────────────────
test_infra_routing() {
  log_section "Test 7: Infrastructure Routing"

  assert_route_contains \
    "Kafka → slack-devops" \
    "slack-devops" \
    "service=kafka" "alertname=KafkaConsumerLagHigh" "severity=warning"

  assert_route_contains \
    "Temporal (warning) → slack-devops" \
    "slack-devops" \
    "service=temporal" "alertname=TemporalWorkerDown" "severity=warning"

  assert_route_contains \
    "Redis (warning) → slack-devops" \
    "slack-devops" \
    "service=redis" "alertname=RedisDown" "severity=warning"

  assert_route_contains \
    "Kubernetes node → slack-devops" \
    "slack-devops" \
    "service=kubernetes" "alertname=NodeDiskPressure" "severity=warning"
}

# ─── Test 8: Warning fallback routing ─────────────────────────────────────────
test_warning_fallback() {
  log_section "Test 8: Warning Fallback Routing"

  # Warnings with no specific service label should fall through to slack-ops-general
  assert_route_contains \
    "Generic warning → slack-ops-general" \
    "slack-ops-general" \
    "severity=warning" "alertname=GenericWarning" "service=unknown-service"
}

# ─── Test 9: Alert rules YAML validation ─────────────────────────────────────
test_alert_rules_yaml() {
  log_section "Test 9: Alert Rules YAML Validation"

  local rules_file="${SCRIPT_DIR}/../alerts/tradegateway-alerts.yaml"

  if [[ ! -f "$rules_file" ]]; then
    log_skip "Alert rules file not found: $rules_file"
    return
  fi

  # Use Python to validate YAML syntax (available everywhere)
  if python3 -c "import yaml; yaml.safe_load(open('$rules_file'))" 2>/dev/null; then
    log_pass "Alert rules YAML is syntactically valid"
  else
    log_fail "Alert rules YAML has syntax errors"
    python3 -c "import yaml; yaml.safe_load(open('$rules_file'))" 2>&1 || true
  fi

  # Count alert rules
  local rule_count
  rule_count=$(grep -c '^\s*- alert:' "$rules_file" || echo 0)
  log_info "Alert rules defined: $rule_count"

  if [[ "$rule_count" -ge 10 ]]; then
    log_pass "Sufficient alert rules defined ($rule_count >= 10)"
  else
    log_fail "Too few alert rules: $rule_count (expected >= 10)"
  fi

  # Verify required alert groups exist
  local required_groups=("tradegateway.api" "tradegateway.risk" "tradegateway.sla")
  for group in "${required_groups[@]}"; do
    if grep -q "name: $group" "$rules_file"; then
      log_pass "Alert group '$group' exists"
    else
      log_fail "Alert group '$group' is missing"
    fi
  done

  # Verify critical alerts have runbook_url annotations
  local missing_runbooks
  missing_runbooks=$(python3 -c "
import yaml
with open('$rules_file') as f:
    data = yaml.safe_load(f)
missing = []
for group in data.get('groups', []):
    for rule in group.get('rules', []):
        if rule.get('labels', {}).get('severity') == 'critical':
            if 'runbook_url' not in rule.get('annotations', {}):
                missing.append(rule.get('alert', 'unknown'))
if missing:
    print(','.join(missing))
" 2>/dev/null || echo "")

  if [[ -z "$missing_runbooks" ]]; then
    log_pass "All critical alerts have runbook_url annotations"
  else
    log_fail "Critical alerts missing runbook_url: $missing_runbooks"
  fi
}

# ─── Test 10: Inhibition rules validation ─────────────────────────────────────
test_inhibition_rules() {
  log_section "Test 10: Inhibition Rules Validation"

  # Verify the critical→warning inhibition rule exists
  if grep -q "severity = \"critical\"" "$CONFIG_FILE" && \
     grep -q "severity = \"warning\"" "$CONFIG_FILE"; then
    log_pass "Critical→warning inhibition rule exists"
  else
    log_fail "Critical→warning inhibition rule is missing"
  fi

  # Verify cluster-down inhibition rule
  if grep -q "KubernetesClusterDown" "$CONFIG_FILE"; then
    log_pass "KubernetesClusterDown inhibition rule exists"
  else
    log_fail "KubernetesClusterDown inhibition rule is missing"
  fi
}

# ─── Test 11: Receiver credential file references ─────────────────────────────
test_credential_file_references() {
  log_section "Test 11: Credential File References"

  # All credentials must use file references (not inline values)
  if grep -qE '^\s+api_url:\s+https://' "$CONFIG_FILE"; then
    log_fail "Found inline Slack webhook URL (should use api_url_file)"
  else
    log_pass "No inline Slack webhook URLs found"
  fi

  if grep -qE '^\s+routing_key:\s+[a-f0-9]{32}' "$CONFIG_FILE"; then
    log_fail "Found inline PagerDuty routing key (should use routing_key_file)"
  else
    log_pass "No inline PagerDuty routing keys found"
  fi

  # Verify all file references use the expected secrets mount path
  # Extract the path value (the part after the key name and space)
  local expected_mount="/etc/alertmanager/secrets/"
  local file_refs
  file_refs=$(grep -E '(api_url_file|routing_key_file):' "$CONFIG_FILE" | sed 's/.*:\s*//')

  while IFS= read -r ref; do
    ref=$(echo "$ref" | tr -d '"' | xargs)  # trim whitespace and quotes
    if [[ "$ref" == "${expected_mount}"* ]]; then
      log_pass "Credential file uses correct mount path: $ref"
    else
      log_fail "Credential file uses unexpected path: '$ref' (expected prefix: $expected_mount)"
    fi
  done <<< "$file_refs"
}

# ─── Summary ──────────────────────────────────────────────────────────────────
print_summary() {
  echo ""
  echo -e "${BOLD}════════════════════════════════════════${RESET}"
  echo -e "${BOLD}  Alertmanager Smoke Test Results${RESET}"
  echo -e "${BOLD}════════════════════════════════════════${RESET}"
  echo -e "  ${GREEN}PASSED${RESET}: $PASS"
  echo -e "  ${RED}FAILED${RESET}: $FAIL"
  echo -e "  ${YELLOW}SKIPPED${RESET}: $SKIP"
  echo -e "${BOLD}════════════════════════════════════════${RESET}"
  echo ""

  if [[ "$FAIL" -gt 0 ]]; then
    echo -e "${RED}${BOLD}✗ $FAIL test(s) failed.${RESET}"
    exit 1
  else
    echo -e "${GREEN}${BOLD}✓ All $PASS tests passed.${RESET}"
    exit 0
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  echo -e "${BOLD}Alertmanager Configuration Smoke Tests${RESET}"
  echo -e "Config: ${CONFIG_FILE}"
  echo ""

  check_prerequisites

  test_config_syntax

  if [[ "$CHECK_ONLY" == "true" ]]; then
    print_summary
    return
  fi

  test_yaml_structure
  test_critical_routing
  test_payment_routing
  test_security_routing
  test_customs_routing
  test_infra_routing
  test_warning_fallback
  test_alert_rules_yaml
  test_inhibition_rules
  test_credential_file_references

  print_summary
}

main "$@"
