# ── Build stage ────────────────────────────────────────────────────────────────
FROM rust:1.79-slim AS builder

WORKDIR /app

# Install build dependencies for rdkafka (libsasl2, libssl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    libsasl2-dev \
    cmake \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Cache dependencies
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm src/main.rs

# Build actual binary
COPY src ./src
RUN cargo build --release

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    libsasl2-2 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -r -u 1001 appuser
COPY --from=builder /app/target/release/kafka-consumer /usr/local/bin/kafka-consumer
RUN chown appuser:appuser /usr/local/bin/kafka-consumer

USER appuser

CMD ["/usr/local/bin/kafka-consumer"]
