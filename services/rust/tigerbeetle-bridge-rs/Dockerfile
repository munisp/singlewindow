# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM rust:1.78-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests first for layer caching
COPY Cargo.toml ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src

# Copy actual source
COPY src ./src

# Build production binary (simulation mode — no TigerBeetle binary required)
# For live mode: cargo build --release --features tigerbeetle-live
RUN cargo build --release

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/tigerbeetle-bridge-rs /app/tigerbeetle-bridge-rs

# Default environment
ENV PORT=4600
ENV RUST_LOG=tigerbeetle_bridge_rs=info,tower_http=warn

EXPOSE 4600

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:4600/health || exit 1

ENTRYPOINT ["/app/tigerbeetle-bridge-rs"]
