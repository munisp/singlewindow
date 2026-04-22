#!/usr/bin/env bash
# ─── TradeGateway NGSWTP — Production Smoke Test Suite ────────────────────────
# Validates all critical API endpoints, auth flows, and service health.
# Usage:
#   ./scripts/smoke-test.sh [BASE_URL]
# Example:
#   ./scripts/smoke-test.sh http://localhost:3000
#   ./scripts/smoke-test.sh https://tradegateway.manus.space
# Exit code: 0 = all tests passed, 1 = one or more tests failed
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0
TOTAL=0
ERRORS=()

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  TradeGateway NGSWTP — Smoke Test Suite${NC}"
echo -e "${BLUE}  Target: ${BASE_URL}${NC}"
echo -e "${BLUE}  $(date -u '+%Y-%m-%d %H:%M:%S UTC')${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# ── Helper functions ──────────────────────────────────────────────────────────
check() {
  local name="$1"
  local expected_status="$2"
  local method="${3:-GET}"
  local url="${4:-}"
  local body="${5:-}"
  local extra_flags="${6:-}"
  TOTAL=$((TOTAL + 1))

  if [ -z "$url" ]; then
    echo -e "${YELLOW}SKIP${NC} $name (no URL)"
    return
  fi

  local http_code
  if [ -n "$body" ]; then
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
      -X "$method" "$url" \
      -H "Content-Type: application/json" \
      -d "$body" \
      $extra_flags \
      --max-time 15 2>/dev/null || echo "000")
  else
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
      -X "$method" "$url" \
      $extra_flags \
      --max-time 15 2>/dev/null || echo "000")
  fi

  if [ "$http_code" = "$expected_status" ]; then
    echo -e "${GREEN}✓ PASS${NC} $name (HTTP $http_code)"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}✗ FAIL${NC} $name (expected $expected_status, got $http_code)"
    FAIL=$((FAIL + 1))
    ERRORS+=("$name: expected $expected_status, got $http_code")
  fi
}

check_json() {
  local name="$1"
  local url="$2"
  local jq_filter="$3"
  local expected_value="$4"
  local extra_flags="${5:-}"
  TOTAL=$((TOTAL + 1))

  local response
  response=$(curl -s "$url" $extra_flags --max-time 15 2>/dev/null || echo "{}")
  local actual
  actual=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print($jq_filter)" 2>/dev/null || echo "ERROR")

  if [ "$actual" = "$expected_value" ]; then
    echo -e "${GREEN}✓ PASS${NC} $name (value: $actual)"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}✗ FAIL${NC} $name (expected '$expected_value', got '$actual')"
    FAIL=$((FAIL + 1))
    ERRORS+=("$name: expected '$expected_value', got '$actual'")
  fi
}

# ── 1. Health Checks ──────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[1/8] Health Checks${NC}"
check "GET /api/health/live — liveness probe" "200" "GET" "${BASE_URL}/api/health/live"
check "GET /api/health/ready — readiness probe" "200" "GET" "${BASE_URL}/api/health/ready"
check_json "GET /api/health — status field" "${BASE_URL}/api/health" "d['status']" "ok"
check_json "GET /api/health — database healthy" "${BASE_URL}/api/health" "d['components']['database']['status']" "ok"
check_json "GET /api/health — worker status present" "${BASE_URL}/api/health" "'workerStatus' in d" "True"

# ── 2. Static Assets ──────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[2/8] Static Assets & PWA${NC}"
check "GET / — HTML response" "200" "GET" "${BASE_URL}/"
check "GET /manifest.json — PWA manifest" "200" "GET" "${BASE_URL}/manifest.json"
check "GET /robots.txt — robots file" "200" "GET" "${BASE_URL}/robots.txt"

# ── 3. OpenAPI Spec ───────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[3/8] OpenAPI & Documentation${NC}"
check "GET /api/openapi.json — OpenAPI spec" "200" "GET" "${BASE_URL}/api/openapi.json"
check_json "OpenAPI spec has info.title" "${BASE_URL}/api/openapi.json" "'TradeGateway' in d['info']['title']" "True"

# ── 4. Authentication ─────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[4/8] Authentication${NC}"
# Demo auth (only available when DEMO_MODE=true)
DEMO_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/demo/session" \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}' --max-time 10 2>/dev/null || echo "{}")
DEMO_TOKEN=$(echo "$DEMO_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null || echo "")

if [ -n "$DEMO_TOKEN" ]; then
  echo -e "${GREEN}✓ PASS${NC} POST /api/demo/session — demo auth works"
  PASS=$((PASS + 1))
  TOTAL=$((TOTAL + 1))
  AUTH_HEADER="-H \"Authorization: Bearer ${DEMO_TOKEN}\""
  COOKIE_NAME=$(curl -s "${BASE_URL}/api/health" -I 2>/dev/null | grep -i "set-cookie" | head -1 | grep -oP 'app_session[^;]*' || echo "")
  # Use cookie for subsequent requests
  COOKIE_JAR=$(mktemp)
  curl -s -X POST "${BASE_URL}/api/demo/session" \
    -H "Content-Type: application/json" \
    -d '{"role":"admin"}' \
    -c "$COOKIE_JAR" \
    --max-time 10 > /dev/null 2>&1 || true
  AUTH_FLAGS="-b $COOKIE_JAR"
else
  echo -e "${YELLOW}SKIP${NC} Demo auth (DEMO_MODE not enabled or server not running)"
  TOTAL=$((TOTAL + 1))
  AUTH_FLAGS=""
  COOKIE_JAR=""
fi

# OAuth redirect (should return HTML login page or redirect)
check "GET /api/oauth/authorize — OAuth page served" "200" "GET" "${BASE_URL}/api/oauth/authorize?redirect_uri=${BASE_URL}/callback"

# ── 5. tRPC API Endpoints ─────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[5/8] tRPC API Endpoints${NC}"
if [ -n "$AUTH_FLAGS" ]; then
  check "tRPC auth.me — returns user" "200" "GET" \
    "${BASE_URL}/api/trpc/auth.me?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D" \
    "" "$AUTH_FLAGS"
  check "tRPC declarations.stats — returns stats" "200" "GET" \
    "${BASE_URL}/api/trpc/declarations.stats?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D" \
    "" "$AUTH_FLAGS"
  check "tRPC declarations.all — returns list" "200" "GET" \
    "${BASE_URL}/api/trpc/declarations.all?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22limit%22%3A5%2C%22offset%22%3A0%7D%7D%7D" \
    "" "$AUTH_FLAGS"
  check "tRPC analytics.overview — returns analytics" "200" "GET" \
    "${BASE_URL}/api/trpc/analytics.overview?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D" \
    "" "$AUTH_FLAGS"
  check "tRPC kyc.all — returns KYC records" "200" "GET" \
    "${BASE_URL}/api/trpc/kyc.all?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22limit%22%3A5%7D%7D%7D" \
    "" "$AUTH_FLAGS"
  check "tRPC payments.listAll — returns payments" "200" "GET" \
    "${BASE_URL}/api/trpc/payments.listAll?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22limit%22%3A5%7D%7D%7D" \
    "" "$AUTH_FLAGS"
  check "tRPC aeo.list — returns AEO records" "200" "GET" \
    "${BASE_URL}/api/trpc/aeo.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22limit%22%3A5%7D%7D%7D" \
    "" "$AUTH_FLAGS"
  check "tRPC wazuh.getAlerts — returns SIEM alerts" "200" "GET" \
    "${BASE_URL}/api/trpc/wazuh.getAlerts?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22limit%22%3A5%7D%7D%7D" \
    "" "$AUTH_FLAGS"
  check "tRPC adminAnalytics.summary — returns admin summary" "200" "GET" \
    "${BASE_URL}/api/trpc/adminAnalytics.summary?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D" \
    "" "$AUTH_FLAGS"
  check "tRPC siteSettings.get — returns site settings" "200" "GET" \
    "${BASE_URL}/api/trpc/siteSettings.get?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D" \
    "" "$AUTH_FLAGS"
  check "tRPC batchPayments.getQueueStats — returns queue stats" "200" "GET" \
    "${BASE_URL}/api/trpc/batchPayments.getQueueStats?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D" \
    "" "$AUTH_FLAGS"
  check "tRPC soc.getAlerts — requires auth (returns 200 with auth)" "200" "GET" \
    "${BASE_URL}/api/trpc/soc.getAlerts?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22limit%22%3A5%7D%7D%7D" \
    "" "$AUTH_FLAGS"
else
  echo -e "${YELLOW}SKIP${NC} tRPC endpoint tests (no auth token)"
  TOTAL=$((TOTAL + 12))
fi

# ── 5b. Auth-required endpoints return 401 without token ──────────────────────
echo ""
echo -e "${YELLOW}[5b] Auth Enforcement (unauthenticated requests must be rejected)${NC}"
check "tRPC soc.getAgentStatus — 403 without auth" "403" "GET" \
  "${BASE_URL}/api/trpc/soc.getAgentStatus?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D"
check "tRPC batchPayments.retryDeadLetters — 403 without auth" "403" "POST" \
  "${BASE_URL}/api/trpc/batchPayments.retryDeadLetters?batch=1" \
  '{"0":{"json":{}}}' ""

# ── 6. Webhook Endpoints ──────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[6/8] Webhook Endpoints${NC}"
# Webhooks return 400 for missing required fields (signature check happens after validation)
check "POST /api/webhooks/oga — OGA callback (missing fields)" "400" "POST" "${BASE_URL}/api/webhooks/oga" \
  '{"declarationId":1,"status":"approved","agencyCode":"FDA"}' ""
check "POST /api/webhooks/sanctions-hit — Sanctions webhook (missing fields)" "400" "POST" "${BASE_URL}/api/webhooks/sanctions-hit" \
  '{"entityName":"Test","matchScore":0.95}' ""

# ── 7. Public Certificate Verification ───────────────────────────────────────
echo ""
echo -e "${YELLOW}[7/8] Public Certificate Verification${NC}"
check "GET /api/verify/TG-CERT-NOTFOUND — 404 for unknown cert" "404" "GET" \
  "${BASE_URL}/api/verify/TG-CERT-NOTFOUND"

# ── 8. Security Headers ───────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[8/8] Security Headers${NC}"
HEADERS=$(curl -s -I "${BASE_URL}/" --max-time 10 2>/dev/null || echo "")

check_header() {
  local name="$1"
  local header="$2"
  TOTAL=$((TOTAL + 1))
  if echo "$HEADERS" | grep -qi "$header"; then
    echo -e "${GREEN}✓ PASS${NC} Security header: $name"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}✗ FAIL${NC} Security header missing: $name"
    FAIL=$((FAIL + 1))
    ERRORS+=("Missing security header: $name")
  fi
}

check_header "X-Content-Type-Options" "x-content-type-options"
check_header "X-Frame-Options" "x-frame-options"
check_header "Strict-Transport-Security" "strict-transport-security"
check_header "X-Request-ID" "x-request-id"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Smoke Test Results${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "  Total:  $TOTAL"
echo -e "  ${GREEN}Passed: $PASS${NC}"
echo -e "  ${RED}Failed: $FAIL${NC}"

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo ""
  echo -e "${RED}  Failures:${NC}"
  for err in "${ERRORS[@]}"; do
    echo -e "  ${RED}  • $err${NC}"
  done
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}  ✓ ALL SMOKE TESTS PASSED — platform is production-ready${NC}"
  EXIT_CODE=0
else
  echo -e "${RED}  ✗ $FAIL TEST(S) FAILED — review failures before deploying${NC}"
  EXIT_CODE=1
fi

# Cleanup
[ -n "$COOKIE_JAR" ] && rm -f "$COOKIE_JAR"

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
exit $EXIT_CODE
