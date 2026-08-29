FROM golang:1.22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache gcc musl-dev
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o ucr-service ./cmd/main.go

FROM alpine:3.19
# SW-O12: non-root runtime
RUN addgroup -S app && adduser -S app -G app
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/ucr-service /usr/local/bin/ucr-service
USER app

EXPOSE 8097
CMD ["/usr/local/bin/ucr-service"]
