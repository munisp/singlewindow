# ─── Build Stage ─────────────────────────────────────────────────────────────
FROM golang:1.23-alpine AS builder

# Install build dependencies
RUN apk --no-cache add ca-certificates git

WORKDIR /app

# Cache dependencies before copying source
COPY go.mod go.sum ./
RUN go mod download

# Copy source and build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s -X main.Version=${VERSION:-dev}" \
    -o payment-service ./cmd/main.go

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM alpine:3.19

# Security: non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Runtime dependencies
RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/payment-service .

# Drop to non-root
USER appuser

# Ports: 8082 (HTTP API), 9082 (Prometheus metrics)
EXPOSE 8082 9082

# Health check — Kubernetes liveness probe mirrors this
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8082/health || exit 1

# Environment variable defaults (override in K8s ConfigMap/Secret)
ENV PORT=8082 \
    METRICS_PORT=9082 \
    DAPR_HTTP_PORT=3502 \
    TIGERBEETLE_ADDRESS=localhost:3000 \
    TB_GO_BRIDGE_HTTP_ADDR=http://tigerbeetle-bridge:8085 \
    TEMPORAL_ADDRESS=temporal-frontend.tradegateway.svc.cluster.local:7233 \
    MOJALOOP_URL=http://mojaloop-gateway:3001

CMD ["./payment-service"]
