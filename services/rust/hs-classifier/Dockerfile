# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM rust:1.78-slim AS builder

WORKDIR /workspace

# Cache dependencies by copying manifests first
COPY Cargo.toml ./
COPY src/ ./src/

# Build release binary
RUN cargo build --release --bin hs-classifier

# ── Stage 2: Runtime (distroless) ─────────────────────────────────────────────
FROM gcr.io/distroless/cc-debian12:nonroot AS runtime

LABEL org.opencontainers.image.title="hs-classifier" \
      org.opencontainers.image.description="WCO HS code classifier microservice" \
      org.opencontainers.image.version="0.1.0"

COPY --from=builder /workspace/target/release/hs-classifier /usr/local/bin/hs-classifier

# Port 8090 (configurable via PORT env var)
EXPOSE 8090

ENV PORT=8090 \
    RUST_LOG=hs_classifier=info,tower_http=info

ENTRYPOINT ["/usr/local/bin/hs-classifier"]
