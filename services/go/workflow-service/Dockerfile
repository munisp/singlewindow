# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM golang:1.23-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o workflow-service ./...

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM gcr.io/distroless/static:nonroot
COPY --from=builder /app/workflow-service /workflow-service
ENV PORT=8087
EXPOSE 8087 9087
ENTRYPOINT ["/workflow-service"]
