# ─────────────────────────────────────────────────────────────────────────────
# rustfs-svc — Multi-stage Docker build
# Stage 1: Build the Go binary
# Stage 2: Minimal distroless runtime image
# ─────────────────────────────────────────────────────────────────────────────

# ── Build stage ──────────────────────────────────────────────────────────────
FROM golang:1.23-alpine AS builder

WORKDIR /build

# Cache dependencies first
COPY go.mod go.sum ./
RUN go mod download

# Build the binary
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -o rustfs-svc .

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app

# Copy the compiled binary from the builder stage
COPY --from=builder /build/rustfs-svc /app/rustfs-svc

# Expose the HTTP port
EXPOSE 4500

# Run as non-root (uid 65532 = nonroot in distroless)
USER nonroot:nonroot

ENTRYPOINT ["/app/rustfs-svc"]
