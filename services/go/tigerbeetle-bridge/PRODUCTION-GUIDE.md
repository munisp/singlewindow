# TigerBeetle Bridge — Production Switchover Guide

## How the Build-Tag Switchover Works

The bridge uses Go build tags to select the backend at compile time:

| Build tag | Backend file | Mode | CGo | TigerBeetle binary required? |
|---|---|---|---|---|
| *(none — default)* | `backend_sim.go` | `simulation` | No | No |
| `tigerbeetle` | `backend_live.go` | `live` | Yes | Yes |

**No code changes are needed to switch modes.** The `main.go` entry point calls
`backend.NewBackend(tbAddr, clusterID)` — the same function signature exists in
both files. The linker selects the correct implementation based on the build tag.

---

## Development / CI (default)

```bash
# Standard build — uses in-memory SimBackend
go build ./cmd/main.go

# Or via Docker (development Dockerfile)
docker build -t tigerbeetle-bridge:dev .
```

The `/health` endpoint returns `"mode": "simulation"`.

---

## Production (with TigerBeetle installed)

### Step 1 — Install TigerBeetle

Follow the official installation guide:
<https://docs.tigerbeetle.com/quick-start/>

```bash
# Example: download the TigerBeetle binary
curl -Lo tigerbeetle https://github.com/tigerbeetle/tigerbeetle/releases/latest/download/tigerbeetle-x86_64-linux
chmod +x tigerbeetle

# Create and format a data file (single-node cluster for testing)
./tigerbeetle format --cluster=0 --replica=0 --replica-count=1 0_0.tigerbeetle

# Start the cluster
./tigerbeetle start --addresses=0.0.0.0:3000 0_0.tigerbeetle
```

### Step 2 — Build with the `tigerbeetle` tag

```bash
# Direct build
CGO_ENABLED=1 go build -tags tigerbeetle -ldflags="-s -w" -o tigerbeetle-bridge ./cmd/main.go

# Or via the production Dockerfile
docker build -f Dockerfile.production -t tigerbeetle-bridge:prod .
```

### Step 3 — Set environment variables

```bash
export TIGERBEETLE_ADDR=tigerbeetle-0.tigerbeetle:3000   # Kubernetes DNS
export TIGERBEETLE_CLUSTER=0                              # Cluster ID (uint64)
export TB_BRIDGE_HTTP_PORT=8086
export TB_BRIDGE_GRPC_PORT=9086
```

### Step 4 — Verify

```bash
curl http://localhost:8086/health
# Expected: {"mode":"live","status":"ok","tbAddr":"tigerbeetle-0.tigerbeetle:3000"}
```

---

## Kubernetes Deployment

The Kubernetes manifests in `infra/k8s/` reference the `tigerbeetle-bridge`
image. For production:

1. Build and push `tigerbeetle-bridge:prod` using `Dockerfile.production`.
2. Update the image tag in `infra/k8s/tigerbeetle-bridge-deployment.yaml`.
3. Set `TIGERBEETLE_ADDR` and `TIGERBEETLE_CLUSTER` as Kubernetes secrets or
   ConfigMap values (already registered as `TB_BRIDGE_GRPC_PORT` env var).

---

## Two-Phase Payment Flow (Live Mode)

The live backend supports the same two-phase commit API as the simulation:

```
POST /api/ledger/transfers/pending   → reserve funds (PENDING flag)
POST /api/ledger/transfers/post/:id  → finalize (POST_PENDING_TRANSFER flag)
POST /api/ledger/transfers/void/:id  → cancel (VOID_PENDING_TRANSFER flag)
```

In live mode, these map directly to TigerBeetle's native two-phase transfer
semantics, giving you linearizable, crash-safe financial accounting.

---

## Account ID Format

Accounts are identified by 16-character lowercase hex strings (64-bit values
zero-padded to 16 chars), e.g. `0000000000000001`.

The five standard customs authority accounts are seeded automatically on startup
(idempotent — safe to restart):

| ID | Code | Type | Purpose |
|---|---|---|---|
| `0000000000000001` | 1001 | `TRADER_LIABILITY` | Duty obligations |
| `0000000000000002` | 2001 | `CUSTOMS_REVENUE_PENDING` | Two-phase reserve |
| `0000000000000003` | 2002 | `CUSTOMS_REVENUE_CONFIRMED` | Settled duties |
| `0000000000000004` | 3001 | `BOND_DEPOSIT` | Security deposits |
| `0000000000000005` | 4001 | `DRAWBACK_PAYABLE` | Refunds payable |

---

## go.mod — Adding the tigerbeetle-go Dependency

The `tigerbeetle-go` package is **not** in `go.mod` by default (to keep the
development build CGo-free). When building for production, run:

```bash
go get github.com/tigerbeetle/tigerbeetle-go@latest
go mod tidy
```

The `Dockerfile.production` does this automatically during the build stage.
