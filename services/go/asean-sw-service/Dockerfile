FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o asean-sw-service ./cmd/main.go

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/asean-sw-service /asean-sw-service
EXPOSE 8096
ENTRYPOINT ["/asean-sw-service"]
