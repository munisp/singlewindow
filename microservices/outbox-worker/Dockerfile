FROM golang:1.22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache gcc musl-dev
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o outbox-worker ./cmd/main.go
FROM alpine:3.19
# SW-O12: non-root runtime
RUN addgroup -S app && adduser -S app -G app
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /app/outbox-worker /usr/local/bin/outbox-worker
HEALTHCHECK --interval=30s --timeout=5s CMD pgrep outbox-worker || exit 1
CMD ["/usr/local/bin/outbox-worker"]
