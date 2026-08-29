# ─── Build stage ─────────────────────────────────────────────────────────────
# SW-O9: this Dockerfile was missing entirely — root docker-compose.yml builds
# microservices/fluvio-consumer, which previously had no Dockerfile (the only
# fluvio Dockerfile lived on an orphan duplicate at services/go/fluvio-consumer,
# removed in the same change).
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /fluvio-consumer ./cmd/main.go

# ─── Runtime stage (distroless, non-root) ────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /fluvio-consumer /fluvio-consumer
USER nonroot
EXPOSE 8096
ENTRYPOINT ["/fluvio-consumer"]
