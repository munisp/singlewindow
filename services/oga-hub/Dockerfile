# ── Build stage ────────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git ca-certificates protobuf protobuf-dev

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o oga-hub .

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM scratch

COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/oga-hub /oga-hub

# SW-O12: run as non-root (numeric uid — scratch has no user db)
USER 65532:65532

EXPOSE 50051 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD ["/oga-hub", "-health-check"]

ENTRYPOINT ["/oga-hub"]
