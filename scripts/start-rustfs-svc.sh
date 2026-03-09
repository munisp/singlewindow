#!/usr/bin/env bash
# start-rustfs-svc.sh — Starts the Go rustfs-svc microservice on port 4500.
# Called automatically by `pnpm dev` via concurrently.
set -e
SVC_DIR="$(cd "$(dirname "$0")/../rustfs-svc" && pwd)"
BIN="$SVC_DIR/rustfs-svc-bin"
if [ ! -f "$BIN" ]; then
  echo "[rustfs-svc] Binary not found — building now..."
  bash "$(dirname "$0")/build-rustfs-svc.sh"
fi
echo "[rustfs-svc] Starting on :4500"
RUSTFS_ENDPOINT="${RUSTFS_ENDPOINT:-http://localhost:9000}" \
RUSTFS_ACCESS_KEY="${RUSTFS_ACCESS_KEY:-tradegateway}" \
RUSTFS_SECRET_KEY="${RUSTFS_SECRET_KEY:-tradegateway-secret}" \
RUSTFS_BUCKET="${RUSTFS_BUCKET:-tradegateway-docs}" \
RUSTFS_SVC_PORT="${RUSTFS_SVC_PORT:-4500}" \
  "$BIN"
