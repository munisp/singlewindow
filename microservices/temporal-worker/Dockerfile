# ─── Build Stage ─────────────────────────────────────────────────────────────
FROM golang:1.23-alpine AS builder
RUN apk --no-cache add ca-certificates git
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -o temporal-worker ./cmd/main.go

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM alpine:3.19
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/temporal-worker .
USER appuser
EXPOSE 8090 9090
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8090/health || exit 1
ENV PORT=8090 \
    METRICS_PORT=9090 \
    TEMPORAL_ADDRESS=temporal-frontend.tradegateway.svc.cluster.local:7233 \
    PAYMENT_SERVICE_URL=http://payment-service.tradegateway.svc.cluster.local:8082 \
    DECLARATION_SERVICE_URL=http://declaration-service.tradegateway.svc.cluster.local:8083 \
    LOG_LEVEL=info
CMD ["./temporal-worker"]
