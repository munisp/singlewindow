FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o audit-service ./cmd/main.go

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/audit-service /audit-service
EXPOSE 8094
ENTRYPOINT ["/audit-service"]
