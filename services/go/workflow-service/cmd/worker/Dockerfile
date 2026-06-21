# Multi-stage Dockerfile for TradeGateway NGSWTP Temporal Worker
# Stage 1: Build
FROM golang:1.23-alpine AS builder

WORKDIR /build

# Copy go.mod and go.sum first for layer caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build the worker binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -o /worker ./cmd/worker/main.go

# Stage 2: Runtime
FROM gcr.io/distroless/static-debian12:nonroot

LABEL org.opencontainers.image.title="TradeGateway NGSWTP Temporal Worker"
LABEL org.opencontainers.image.description="Temporal worker registering all 20 fund-flow workflows"
LABEL org.opencontainers.image.version="1.0.0"

COPY --from=builder /worker /worker

# Health check
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD ["/worker", "-health-check"] || exit 1

EXPOSE 8090

ENTRYPOINT ["/worker"]
