FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /fluvio-consumer ./cmd/main.go

FROM gcr.io/distroless/static-debian12
COPY --from=builder /fluvio-consumer /fluvio-consumer
EXPOSE 8093
ENTRYPOINT ["/fluvio-consumer"]
