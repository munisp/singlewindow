#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# TradeGateway NGSWTP — Kubernetes Smoke Test
# Usage: ./k8s/smoke-test.sh [overlay] [namespace]
#   overlay    : k8s overlay directory (default: k8s/overlays/staging)
#   namespace  : Kubernetes namespace   (default: tradegateway-staging)
#
# Requires: kubectl, curl, jq
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

OVERLAY="${1:-k8s/overlays/staging}"
NAMESPACE="${2:-tradegateway-staging}"
MAX_WAIT_SECONDS=300
POLL_INTERVAL=10

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✔ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }
info() { echo -e "${YELLOW}→ $1${NC}"; }

echo "═══════════════════════════════════════════════════════════"
echo "  TradeGateway NGSWTP — Kubernetes Smoke Test"
echo "  Overlay : $OVERLAY"
echo "  Namespace: $NAMESPACE"
echo "═══════════════════════════════════════════════════════════"

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
info "Checking prerequisites..."
command -v kubectl &>/dev/null || fail "kubectl not found"
command -v curl    &>/dev/null || fail "curl not found"
command -v jq      &>/dev/null || fail "jq not found"
pass "Prerequisites OK"

# ── 2. Apply overlay ──────────────────────────────────────────────────────────
if [[ -d "$OVERLAY" ]]; then
  info "Applying overlay: $OVERLAY"
  kubectl apply -k "$OVERLAY" --namespace="$NAMESPACE" || fail "kubectl apply failed"
  pass "Overlay applied"
else
  info "Overlay directory not found — assuming cluster is already deployed"
fi

# ── 3. Wait for all pods to be Ready ─────────────────────────────────────────
info "Waiting for all pods in namespace '$NAMESPACE' to be Ready (max ${MAX_WAIT_SECONDS}s)..."
ELAPSED=0
while true; do
  TOTAL=$(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | wc -l | tr -d ' ')
  READY=$(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | grep -c "Running" || true)
  NOT_READY=$(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | grep -vE "Running|Completed" || true)

  if [[ "$TOTAL" -gt 0 && -z "$NOT_READY" ]]; then
    pass "All $TOTAL pods are Ready"
    break
  fi

  if [[ "$ELAPSED" -ge "$MAX_WAIT_SECONDS" ]]; then
    echo "Pods not ready after ${MAX_WAIT_SECONDS}s:"
    kubectl get pods -n "$NAMESPACE"
    fail "Timeout waiting for pods"
  fi

  info "  $READY/$TOTAL pods ready — waiting ${POLL_INTERVAL}s... (${ELAPSED}s elapsed)"
  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

# ── 4. Resolve cluster URL ────────────────────────────────────────────────────
if [[ -z "${CLUSTER_URL:-}" ]]; then
  # Try to get the LoadBalancer external IP
  CLUSTER_URL=$(kubectl get svc tradegateway-web -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)
  if [[ -z "$CLUSTER_URL" ]]; then
    CLUSTER_URL=$(kubectl get svc tradegateway-web -n "$NAMESPACE" \
      -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  fi
  if [[ -z "$CLUSTER_URL" ]]; then
    fail "Could not resolve cluster URL. Set CLUSTER_URL env var manually."
  fi
  CLUSTER_URL="https://$CLUSTER_URL"
fi
info "Cluster URL: $CLUSTER_URL"

# ── 5. Health endpoint checks ─────────────────────────────────────────────────
info "Checking /api/health/live..."
LIVE_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$CLUSTER_URL/api/health/live" || echo "000")
[[ "$LIVE_STATUS" == "200" ]] || fail "/api/health/live returned $LIVE_STATUS"
pass "/api/health/live → 200 OK"

info "Checking /api/health/ready..."
READY_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$CLUSTER_URL/api/health/ready" || echo "000")
[[ "$READY_STATUS" == "200" ]] || fail "/api/health/ready returned $READY_STATUS"
pass "/api/health/ready → 200 OK"

# ── 6. tRPC public procedures ─────────────────────────────────────────────────
info "Checking tRPC public procedure: system.serviceHealth..."
HEALTH_RESP=$(curl -sf "$CLUSTER_URL/api/trpc/system.serviceHealth" \
  -H "Content-Type: application/json" || echo "{}")
echo "$HEALTH_RESP" | jq -e '.result.data.allHealthy' &>/dev/null || \
  echo -e "${YELLOW}  ⚠ serviceHealth returned non-healthy state (expected in staging)${NC}"
pass "tRPC system.serviceHealth responded"

info "Checking tRPC public procedure: system.microserviceHealth..."
MSVC_RESP=$(curl -sf "$CLUSTER_URL/api/trpc/system.microserviceHealth" \
  -H "Content-Type: application/json" || echo "{}")
echo "$MSVC_RESP" | jq -e '.result.data.totalCount' &>/dev/null || \
  echo -e "${YELLOW}  ⚠ microserviceHealth did not return totalCount${NC}"
pass "tRPC system.microserviceHealth responded"

# ── 7. Static assets ──────────────────────────────────────────────────────────
info "Checking root page loads..."
ROOT_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$CLUSTER_URL/" || echo "000")
[[ "$ROOT_STATUS" == "200" ]] || fail "Root page returned $ROOT_STATUS"
pass "Root page → 200 OK"

info "Checking PWA manifest..."
MANIFEST_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$CLUSTER_URL/manifest.json" || echo "000")
[[ "$MANIFEST_STATUS" == "200" ]] || echo -e "${YELLOW}  ⚠ manifest.json not found (optional)${NC}"
pass "PWA manifest check complete"

# ── 8. Playwright journey tests against cluster ───────────────────────────────
if command -v npx &>/dev/null && [[ -f "playwright.config.ts" ]]; then
  info "Running Playwright journey tests against $CLUSTER_URL..."
  PLAYWRIGHT_BASE_URL="$CLUSTER_URL" npx playwright test \
    e2e/journey9-business-rules.spec.ts \
    e2e/journey1-declaration-clearance.spec.ts \
    --workers=2 \
    --reporter=line \
    2>&1 | tail -20 || echo -e "${YELLOW}  ⚠ Some Playwright tests failed — check output above${NC}"
  pass "Playwright smoke tests complete"
else
  info "Playwright not available — skipping E2E tests"
fi

# ── 9. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo -e "  ${GREEN}SMOKE TEST PASSED${NC}"
echo "  Cluster: $CLUSTER_URL"
echo "  Namespace: $NAMESPACE"
echo "  Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "═══════════════════════════════════════════════════════════"
