FROM golang:1.22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache gcc musl-dev
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o aeo-mra-service ./cmd/main.go

FROM alpine:3.19
# SW-O12: non-root runtime
RUN addgroup -S app && adduser -S app -G app
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /app/aeo-mra-service /usr/local/bin/aeo-mra-service
USER app

EXPOSE 8096
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:8096/v1/health || exit 1
CMD ["/usr/local/bin/aeo-mra-service"]
