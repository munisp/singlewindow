# ── Build stage ────────────────────────────────────────────────────────────────
FROM rust:1.79-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    libsasl2-dev \
    cmake \
    build-essential \
    protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY build.rs ./
COPY proto ./proto
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm src/main.rs

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
COPY --from=builder /app/target/release/tigerbeetle-bridge /usr/local/bin/tigerbeetle-bridge
RUN chown appuser:appuser /usr/local/bin/tigerbeetle-bridge

USER appuser
EXPOSE 50055

CMD ["/usr/local/bin/tigerbeetle-bridge"]
