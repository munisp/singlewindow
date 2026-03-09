# ── Build stage ────────────────────────────────────────────────────────────────
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o tigerbeetle-bridge ./cmd/main.go

# ── Runtime stage ───────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /app/tigerbeetle-bridge /tigerbeetle-bridge
EXPOSE 8086 9086
ENTRYPOINT ["/tigerbeetle-bridge"]
