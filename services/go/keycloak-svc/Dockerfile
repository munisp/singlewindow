# ── Build stage ────────────────────────────────────────────────────────────────
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o keycloak-svc ./cmd/main.go

# ── Runtime stage ───────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /app/keycloak-svc /keycloak-svc
EXPOSE 8087 9087
ENTRYPOINT ["/keycloak-svc"]
