FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /opencti-svc ./cmd

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
COPY --from=builder /opencti-svc /opencti-svc
# DATABASE_URL is REQUIRED at runtime — the service fails closed without it.
EXPOSE 8085
CMD ["/opencti-svc"]
