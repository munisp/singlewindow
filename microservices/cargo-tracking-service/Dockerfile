FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN go build -o cargo-tracking-service ./cmd/main.go

FROM alpine:3.19
RUN apk --no-cache add ca-certificates wget
WORKDIR /app
COPY --from=builder /app/cargo-tracking-service .
EXPOSE 8087
CMD ["./cargo-tracking-service"]
