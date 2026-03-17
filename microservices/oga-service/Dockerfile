# ─── Build Stage ─────────────────────────────────────────────────────────────
FROM golang:1.23-alpine AS builder
RUN apk --no-cache add ca-certificates git
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -o oga-service ./cmd/main.go

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM alpine:3.19
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/oga-service .
USER appuser
EXPOSE 8084 9084
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8084/health || exit 1
ENV PORT=8084 \
    METRICS_PORT=9084 \
    DAPR_HTTP_PORT=3504 \
    OGA_TIMEOUT_SECONDS=30 \
    KEYCLOAK_URL=http://keycloak.tradegateway.svc.cluster.local:8080 \
    LOG_LEVEL=info
CMD ["./oga-service"]
