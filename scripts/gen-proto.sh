#!/usr/bin/env bash
# gen-proto.sh — reproducible Go stub generation for the v1 gRPC contracts.
#
# Generates Go stubs for the root-level proto/*.proto files whose go_package is
# github.com/tradegateway/ngswtp/proto/<domain>/v1 (declaration, cargo, oga,
# risk). Output lands in proto/<domain>/v1/ inside the proto/ Go module
# (proto/go.mod, module github.com/tradegateway/ngswtp/proto). Services consume
# it via a local `replace` directive in their go.mod.
#
# Pinned tool versions (install with):
#   go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.5
#   go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.5.1
#   protoc v25.6 (https://github.com/protocolbuffers/protobuf/releases)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROTO_DIR="${REPO_ROOT}/proto"

PROTOS=(declaration.proto cargo.proto oga.proto risk.proto)

protoc -I "${PROTO_DIR}" \
  --go_out="${PROTO_DIR}" --go_opt=module=github.com/tradegateway/ngswtp/proto \
  --go-grpc_out="${PROTO_DIR}" --go-grpc_opt=module=github.com/tradegateway/ngswtp/proto \
  "${PROTOS[@]}"

echo "Generated stubs for: ${PROTOS[*]}"
