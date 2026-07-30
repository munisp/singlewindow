FROM golang:1.22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache gcc musl-dev
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o ncs-nrs-gateway ./cmd/main.go

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /app/ncs-nrs-gateway /usr/local/bin/ncs-nrs-gateway
EXPOSE 8101
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:8101/v1/health || exit 1
CMD ["/usr/local/bin/ncs-nrs-gateway"]
