# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM golang:1.23-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git ca-certificates

# Cache Go modules
COPY go.mod go.sum* ./
RUN go mod download

# Build the binary
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo \
    -ldflags="-w -s" \
    -o graph-bridge ./cmd/server/main.go

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM alpine:3.19 AS runtime

RUN apk add --no-cache ca-certificates wget

WORKDIR /app

COPY --from=builder /app/graph-bridge .

ENV PORT=8100
ENV GIN_MODE=release

EXPOSE 8100

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

CMD ["./graph-bridge"]
