FROM rust:1.78-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev libpq-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml ./
# Pre-build dependencies for caching
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 libpq5 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/wto-valuation-engine /usr/local/bin/wto-valuation-engine
EXPOSE 8095
HEALTHCHECK --interval=30s --timeout=5s CMD curl -sf http://localhost:8095/v1/health || exit 1
CMD ["/usr/local/bin/wto-valuation-engine"]
