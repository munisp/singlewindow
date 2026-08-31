FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN go build -o cargo-tracking-service ./cmd/main.go

FROM alpine:3.19
# SW-O12: non-root runtime
RUN addgroup -S app && adduser -S app -G app
RUN apk --no-cache add ca-certificates wget
WORKDIR /app
COPY --from=builder /app/cargo-tracking-service .
USER app

EXPOSE 8087
CMD ["./cargo-tracking-service"]
