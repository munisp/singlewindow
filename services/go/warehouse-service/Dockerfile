FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o warehouse-service ./cmd/main.go

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/warehouse-service /warehouse-service
EXPOSE 8095
ENTRYPOINT ["/warehouse-service"]
