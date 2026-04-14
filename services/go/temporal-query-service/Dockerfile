# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM golang:1.23-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o temporal-query-service ./cmd/

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM gcr.io/distroless/static:nonroot
COPY --from=builder /app/temporal-query-service /temporal-query-service
ENV PORT=8086
EXPOSE 8086 9086
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD ["/temporal-query-service", "-health"]
ENTRYPOINT ["/temporal-query-service"]
