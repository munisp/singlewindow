# TradeGateway NGSWTP — Environment Variables Reference

All environment variables used by the server are documented here. Variables marked **[AUTO]** are injected automatically by the Manus platform and do not need to be set manually. Variables marked **[OPTIONAL]** have sensible defaults when omitted. Variables marked **[REQUIRED]** must be set before the server will start in production.

## Platform-Injected (AUTO)

| Variable | Description |
|---|---|
| `DATABASE_URL` | TiDB/MySQL connection string |
| `JWT_SECRET` | Session cookie signing secret (HS256) |
| `VITE_APP_ID` | Manus OAuth application ID |
| `OAUTH_SERVER_URL` | Manus OAuth backend base URL |
| `VITE_OAUTH_PORTAL_URL` | Manus login portal URL (frontend) |
| `OWNER_OPEN_ID` | Owner's Manus open ID |
| `OWNER_NAME` | Owner's display name |
| `BUILT_IN_FORGE_API_URL` | Manus built-in API base URL |
| `BUILT_IN_FORGE_API_KEY` | Bearer token for server-side Manus APIs |
| `VITE_FRONTEND_FORGE_API_URL` | Manus API URL for frontend |
| `VITE_FRONTEND_FORGE_API_KEY` | Bearer token for frontend Manus APIs |
| `VITE_ANALYTICS_ENDPOINT` | Analytics endpoint |
| `VITE_ANALYTICS_WEBSITE_ID` | Analytics website ID |

## Core Infrastructure

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | Node environment (`development` or `production`) |
| `BASE_URL` | `http://localhost:3000` | Public base URL for OAuth callbacks |

## Keycloak IAM

| Variable | Default | Description |
|---|---|---|
| `KEYCLOAK_SVC_URL` | `http://localhost:8080` | Keycloak base URL for role sync middleware |

## Permify Authorization

| Variable | Default | Description |
|---|---|---|
| `PERMIFY_HOST` | `localhost:3476` | Permify gRPC/HTTP host:port |
| `PERMIFY_TENANT` | `t1` | Permify tenant ID |

## Temporal Workflow Engine

| Variable | Default | Description |
|---|---|---|
| `TEMPORAL_URL` | `localhost:7233` | Temporal frontend address |
| `TEMPORAL_NAMESPACE` | `tradegateway` | Temporal namespace |
| `TEMPORAL_UI_URL` | `http://localhost:8088` | Temporal Web UI URL |

## Go Microservices (gRPC)

| Variable | Default | Description |
|---|---|---|
| `DECLARATION_GRPC_ADDR` | `localhost:50051` | declaration-service gRPC address |
| `PAYMENT_GRPC_ADDR` | `localhost:50052` | payment-service gRPC address |
| `OGA_GRPC_ADDR` | `localhost:50053` | oga-service gRPC address |
| `PROFILE_GRPC_ADDR` | `localhost:50054` | profile-service gRPC address |

## Mojaloop Payment Integration

| Variable | Default | Description |
|---|---|---|
| `MOJALOOP_URL` | `http://localhost:4000` | Mojaloop API base URL |
| `MOJALOOP_API_KEY` | — | Mojaloop API key |
| `MOJALOOP_WEBHOOK_SECRET` | — | Mojaloop webhook HMAC secret |

## TigerBeetle Financial Ledger

| Variable | Default | Description |
|---|---|---|
| `TB_BRIDGE_URL` | `http://localhost:8085` | TigerBeetle HTTP bridge URL |

## Risk and ML Services

| Variable | Default | Description |
|---|---|---|
| `RISK_SCORER_URL` | `http://localhost:8001` | Python risk-engine FastAPI URL |
| `PAYMENT_RISK_URL` | `http://localhost:8001/payment-risk` | Payment risk scoring endpoint |
| `KYC_SERVICE_URL` | `http://localhost:8003` | KYC verification service URL |
| `VISION_SERVICE_URL` | `http://localhost:8004` | Cargo vision analysis service URL |

## Fluvio Real-time Streaming

| Variable | Default | Description |
|---|---|---|
| `FLUVIO_SVC_URL` | `http://localhost:9003` | Fluvio SC REST API URL |
| `FLUVIO_WS_URL` | `ws://localhost:8090` | fluvio-consumer WebSocket URL |

## Security and Threat Intelligence

| Variable | Default | Description |
|---|---|---|
| `WAZUH_SVC_URL` | `http://localhost:55000` | Wazuh manager REST API URL |
| `OPENCTI_SVC_URL` | `http://localhost:8080/graphql` | OpenCTI GraphQL endpoint |
| `FLINK_CEP_SVC_URL` | `http://localhost:8083` | Flink CEP REST API URL |

## Analytics and Lakehouse

| Variable | Default | Description |
|---|---|---|
| `DELTALAKE_SVC_URL` | `http://localhost:8086` | Delta Lake query service URL |
| `SEDONA_SVC_URL` | `http://localhost:8089` | Apache Sedona geospatial service URL |
| `RUSTFS_SVC_URL` | `http://localhost:8091` | RustFS / MinIO S3 bridge URL |
| `KUBECOST_SVC_URL` | `http://localhost:9090` | Kubecost cost management API URL |
| `GRAPH_BRIDGE_URL` | `http://localhost:8092` | Knowledge graph bridge URL |

## External Integrations

| Variable | Default | Description |
|---|---|---|
| `ASEAN_SW_SERVICE_URL` | `http://localhost:8093` | ASEAN Single Window G2G endpoint |
| `CEN_SERVICE_URL` | `http://localhost:8094` | WCO CEN Network service URL |
| `FREEZONE_SERVICE_URL` | `http://localhost:8095` | Free zone management service URL |
| `WAREHOUSE_SERVICE_URL` | `http://localhost:8096` | Bonded warehouse service URL |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama LLM base URL (local) |
| `OLLAMA_PROXY_URL` | `http://localhost:11435` | Ollama proxy URL |
| `OGA_WEBHOOK_SECRET` | — | OGA webhook HMAC secret |
