FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY main.go .
RUN go mod init kubecost-svc && go build -o kubecost-svc .

FROM alpine:3.20
WORKDIR /app
COPY --from=builder /app/kubecost-svc .
ENV PORT=8105
EXPOSE 8105
CMD ["./kubecost-svc"]
