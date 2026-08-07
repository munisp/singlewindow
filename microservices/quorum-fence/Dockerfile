FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY cmd/ ./cmd/
RUN CGO_ENABLED=0 GOOS=linux go build -o quorum-fence ./cmd/

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/quorum-fence /quorum-fence
EXPOSE 8113
ENTRYPOINT ["/quorum-fence"]
