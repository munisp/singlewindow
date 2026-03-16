# TigerBeetle Rust Bridge — Production Switchover Guide

## How the Feature-Flag Switchover Works

The Rust bridge uses Cargo feature flags to select the backend at compile time:

| Feature flag | Backend | Mode | TigerBeetle binary required? |
|---|---|---|---|
| *(none — default)* | In-memory simulation | `simulation` | No |
| `tigerbeetle-live` | `tigerbeetle-rs` crate | `live` | Yes |

**No code changes are needed to switch modes.** The `main.rs` entry point calls
`backend::new(addr, cluster_id)` — the same function signature is re-exported
by both feature-gated modules.

---

## Development / CI (default)

```bash
# Standard build — uses in-memory SimBackend
cargo build --release

# Or via Docker (development Dockerfile)
docker build -t tigerbeetle-bridge-rs:dev .
```

---

## Production (with TigerBeetle installed)

### Step 1 — Install TigerBeetle

See the Go bridge `PRODUCTION-GUIDE.md` for TigerBeetle cluster setup.

### Step 2 — Add the `tigerbeetle-rs` dependency

In `Cargo.toml`, the dependency is already declared under `[features]`:

```toml
[features]
default = []
tigerbeetle-live = ["dep:tigerbeetle"]

[dependencies]
tigerbeetle = { version = "0.16", optional = true }
```

### Step 3 — Build with the feature flag

```bash
cargo build --release --features tigerbeetle-live

# Or via the production Dockerfile
docker build -f Dockerfile.production -t tigerbeetle-bridge-rs:prod .
```

### Step 4 — Set environment variables

```bash
export TIGERBEETLE_ADDR=tigerbeetle-0.tigerbeetle:3000
export TIGERBEETLE_CLUSTER=0
export TB_RS_BRIDGE_PORT=8087
```

### Step 5 — Verify

```bash
curl http://localhost:8087/health
# Expected: {"mode":"live","status":"ok"}
```

---

## Relationship to the Go Bridge

The Rust bridge (`tigerbeetle-bridge-rs`) is a **secondary bridge** that
provides:
- High-throughput batch transfer ingestion (Rust async I/O)
- The `GET /api/ledger/accounts/:id/history` endpoint (account balance history
  using TigerBeetle's `GetAccountBalances` API)
- A Kafka consumer that converts `payment.confirmed` events into TB transfers
  without going through the Go bridge HTTP layer

The **Go bridge** is the primary HTTP/gRPC interface used by the payment-service
and the tRPC admin procedures. Both bridges connect to the same TigerBeetle
cluster — they are not redundant, they serve different access patterns.
