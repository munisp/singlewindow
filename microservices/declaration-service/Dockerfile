# ─── Build Stage ─────────────────────────────────────────────────────────────
FROM golang:1.23-alpine AS builder
RUN apk --no-cache add ca-certificates git
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -o declaration-service ./cmd/main.go

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM alpine:3.19
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/declaration-service .
USER appuser
EXPOSE 8083 9083
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8083/health || exit 1
ENV PORT=8083 \
    METRICS_PORT=9083 \
    DAPR_HTTP_PORT=3503 \
    TEMPORAL_ADDRESS=temporal-frontend.tradegateway.svc.cluster.local:7233 \
    KEYCLOAK_URL=http://keycloak.tradegateway.svc.cluster.local:8080 \
    LOG_LEVEL=info
CMD ["./declaration-service"]
