#!/usr/bin/env bash
# build-rustfs-svc.sh — Builds the Go rustfs-svc binary.
# Run once after cloning or when rustfs-svc/main.go changes.
set -e
GO_BIN="${GO_BIN:-/usr/local/go/bin/go}"
SVC_DIR="$(cd "$(dirname "$0")/../rustfs-svc" && pwd)"
if [ ! -f "$GO_BIN" ]; then
  echo "[rustfs-svc] Go not found at $GO_BIN — install Go 1.23+ first"
  exit 1
fi
echo "[rustfs-svc] Building binary..."
cd "$SVC_DIR"
"$GO_BIN" build -o rustfs-svc-bin ./...
echo "[rustfs-svc] Built: $SVC_DIR/rustfs-svc-bin"
