FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY cmd/ ./cmd/
RUN CGO_ENABLED=0 GOOS=linux go build -o quorum-fence ./cmd/

# SW-O12: non-root runtime
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /app/quorum-fence /quorum-fence
EXPOSE 8113
ENTRYPOINT ["/quorum-fence"]
