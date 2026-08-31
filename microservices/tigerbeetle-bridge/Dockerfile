FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git protobuf-dev gcc musl-dev

WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download

# Install protoc-gen-go and protoc-gen-go-grpc
RUN go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
RUN go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

COPY . .

# Generate gRPC code
RUN mkdir -p proto && \
    protoc --go_out=. --go_opt=paths=source_relative \
           --go-grpc_out=. --go-grpc_opt=paths=source_relative \
           proto/ledger.proto

RUN CGO_ENABLED=1 GOOS=linux go build -o tigerbeetle-bridge ./cmd/main.go

FROM alpine:3.19
# SW-O12: non-root runtime
RUN addgroup -S app && adduser -S app -G app
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/tigerbeetle-bridge .

USER app

EXPOSE 50055 9094

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:9094/health || exit 1

CMD ["./tigerbeetle-bridge"]
