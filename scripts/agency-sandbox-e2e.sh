#!/usr/bin/env bash
# agency-sandbox-e2e.sh — Phase 10 WP-2b one-command live evidence run.
#
# Boots the REAL blueeconomy-agency-sandbox simulators (Go) — six trusted
# instances on :8081-8086 plus six ROGUE instances on :8091-8096 signed with
# unknown keys (trust-path proof) — runs the live vitest suites against them
# (no mocks), and signs the end-to-end conformance report.
#
# Prerequisites: Go 1.25+, Node 20+, repo dependencies installed, and a
# checkout of github.com/munisp/blueeconomy-agency-sandbox.
# PostgreSQL is optional: with PRA_TEST_DATABASE_URL reachable the MSW
# port-call e2e runs for real; without it that suite skips (printed, honest).
#
# Usage:
#   SANDBOX_DIR=/path/to/blueeconomy-agency-sandbox scripts/agency-sandbox-e2e.sh [report-path]
#
# Environment: all key material is generated per run and held in env only —
# nothing secret is written to disk. The sandbox is booted with
# SANDBOX_TRUST_KEYS so it REALLY verifies the platform's Ed25519 egress JWS.
set -euo pipefail
cd "$(dirname "$0")/.."
PLATFORM_DIR="$PWD"
SANDBOX_DIR="${SANDBOX_DIR:?set SANDBOX_DIR to a checkout of github.com/munisp/blueeconomy-agency-sandbox}"
REPORT="${1:-conformance-report.wp2b.json}"
EVIDENCE="$(mktemp -t wp2b-evidence-XXXX.json)"
BIN="$(mktemp -d -t wp2b-sandbox-bin-XXXX)"
PIDS=()
cleanup() {
  kill "${PIDS[@]}" 2>/dev/null || true
  rm -rf "$BIN"
}
trap cleanup EXIT

command -v go >/dev/null || { echo "go not found (need Go 1.25+)"; exit 1; }

# ── TEST-ONLY key material (per run, env-only) ───────────────────────────────
keygen() { node "$PLATFORM_DIR/scripts/agencySandboxKeygen.mjs"; }
PLATFORM_KEY="$(keygen)"   # platform egress key (all six adapters, epoch 1)
CONFORMANCE_KEY="$(keygen)" # signs the conformance report
json_field() { node -e "process.stdout.write(JSON.parse(process.argv[1])[process.argv[2]])" "$1" "$2"; }
PLATFORM_SEED="$(json_field "$PLATFORM_KEY" seed)"
PLATFORM_PUB="$(json_field "$PLATFORM_KEY" public)"

# Sandbox trusts the platform egress kids (all six adapters, epoch 1).
TRUST_KEYS="$(node -e '
  const pub = process.argv[1];
  const out = {};
  for (const a of ["ncs-bodogwu","cbn-tms","nepc","nis","port-health","npa-esen"]) {
    out[`blueeconomy-singlewindow-oga-${a}-1`] = pub;
  }
  process.stdout.write(JSON.stringify(out));
' "$PLATFORM_PUB")"

# ── Build + boot the sandbox stack ───────────────────────────────────────────
AGENCIES=(ncs-bodogwu cbn-tms nepc nis port-health npa-esen)
PORTS=(8081 8082 8083 8084 8085 8086)
ROGUE_PORTS=(8091 8092 8093 8094 8095 8096)

for i in "${!AGENCIES[@]}"; do
  go -C "$SANDBOX_DIR" build -o "$BIN/${AGENCIES[$i]}" "./cmd/${AGENCIES[$i]}"
done

declare -A BASE_URLS ROGUE_URLS
for i in "${!AGENCIES[@]}"; do
  svc="${AGENCIES[$i]}"
  # Trusted instance: own signing key (epoch 1) → kid <agency>-sandbox-1.
  TRUSTED_KEY="$(keygen)"
  ADDR=":${PORTS[$i]}" \
    SANDBOX_SIGNING_PRIVATE_KEY="$(json_field "$TRUSTED_KEY" seed)" \
    SANDBOX_SIGNING_KEY_EPOCH=1 \
    SANDBOX_TRUST_KEYS="$TRUST_KEYS" \
    "$BIN/$svc" > "$BIN/$svc.log" 2>&1 &
  PIDS+=($!)
  # Rogue instance: UNKNOWN key + DIFFERENT epoch (99) → kid <agency>-sandbox-99
  # is not in the trusted JWKS set (untrusted_kid proof).
  ROGUE_KEY="$(keygen)"
  ADDR=":${ROGUE_PORTS[$i]}" \
    SANDBOX_SIGNING_PRIVATE_KEY="$(json_field "$ROGUE_KEY" seed)" \
    SANDBOX_SIGNING_KEY_EPOCH=99 \
    SANDBOX_TRUST_KEYS="$TRUST_KEYS" \
    "$BIN/$svc" > "$BIN/$svc.rogue.log" 2>&1 &
  PIDS+=($!)
  BASE_URLS[$svc]="http://127.0.0.1:${PORTS[$i]}"
  ROGUE_URLS[$svc]="http://127.0.0.1:${ROGUE_PORTS[$i]}"
done

for port in "${PORTS[@]}" "${ROGUE_PORTS[@]}"; do
  for _ in $(seq 1 50); do
    curl -sf "http://127.0.0.1:$port/healthz" > /dev/null && break
    sleep 0.2
  done
  curl -sf "http://127.0.0.1:$port/healthz" > /dev/null || { echo "sandbox on :$port not healthy"; exit 1; }
done
echo "[wp2b] sandbox stack healthy (6 trusted :8081-8086, 6 rogue :8091-8096)"

to_json() { node -e '
  const out = {};
  const args = process.argv.slice(1);
  for (let i = 0; i < args.length; i += 2) out[args[i]] = args[i + 1];
  process.stdout.write(JSON.stringify(out));
' "$@"; }

BASE_URLS_JSON="$(to_json \
  ncs-bodogwu "${BASE_URLS[ncs-bodogwu]}" cbn-tms "${BASE_URLS[cbn-tms]}" \
  nepc "${BASE_URLS[nepc]}" nis "${BASE_URLS[nis]}" \
  port-health "${BASE_URLS[port-health]}" npa-esen "${BASE_URLS[npa-esen]}")"
ROGUE_URLS_JSON="$(to_json \
  ncs-bodogwu "${ROGUE_URLS[ncs-bodogwu]}" cbn-tms "${ROGUE_URLS[cbn-tms]}" \
  nepc "${ROGUE_URLS[nepc]}" nis "${ROGUE_URLS[nis]}" \
  port-health "${ROGUE_URLS[port-health]}" npa-esen "${ROGUE_URLS[npa-esen]}")"

# ── Live test run (unconditionally includes the fail-closed unit suite) ──────
export AGENCY_SANDBOX_BASE_URLS="$BASE_URLS_JSON"
export AGENCY_SANDBOX_ROGUE_BASE_URLS="$ROGUE_URLS_JSON"
export AGENCY_SANDBOX_PLATFORM_SIGNING_KEY="$PLATFORM_SEED"
export AGENCY_SANDBOX_PLATFORM_KEY_ID=1
export AGENCY_SANDBOX_EVIDENCE_OUT="$EVIDENCE"

npx vitest run \
  server/externalAdapters.test.ts \
  server/externalAdapters.e2e.test.ts \
  server/mswPortCall.e2e.test.ts

# ── Signed conformance report (audit artifact) ───────────────────────────────
AGENCY_CONFORMANCE_SIGNING_KEY="$(json_field "$CONFORMANCE_KEY" seed)" \
AGENCY_CONFORMANCE_KEY_EPOCH=1 \
  npx tsx scripts/signAgencyConformanceReport.ts "$EVIDENCE" "$REPORT"
