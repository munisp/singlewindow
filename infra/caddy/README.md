# Caddy Edge Proxy — TradeGateway NGSWTP

## Overview

Caddy is the outermost edge proxy for TradeGateway NGSWTP. It sits in front of Apache APISIX and handles:

- **Automatic TLS** — provisions and renews certificates from Let's Encrypt / ZeroSSL via ACME, with zero manual configuration.
- **HTTP/3 + QUIC** — enabled by default on all listeners, improving latency for mobile traders.
- **Coraza WAF** — OWASP Core Rule Set compiled into the Caddy binary as the first-line WAF.
- **forward_auth → Keycloak** — browser-facing portals (Trader, OGA, Admin) are protected by Caddy delegating authentication to oauth2-proxy, which handles the OIDC flow with Keycloak.
- **HTTP → HTTPS redirect** — automatic for all virtual hosts.

## Files

| File | Purpose |
|---|---|
| `Caddyfile.prod` | Production Caddyfile with ACME TLS, Coraza WAF, forward_auth |
| `Caddyfile.dev` | Development Caddyfile — HTTP-only on port 8888, no ACME |
| `oauth2-proxy.cfg` | oauth2-proxy configuration (Keycloak OIDC provider, Redis sessions) |
| `README.md` | This file |

## Architecture

```
Internet (HTTPS/HTTP3)
        │
        ▼
    Caddy :443
    ├── auth.tradegateway.gov.ng  → Keycloak :8080
    ├── trader.tradegateway.gov.ng
    │   ├── /oauth2/*             → oauth2-proxy :4180
    │   ├── /api/*                → APISIX :9080
    │   └── /*                   → Frontend :3000
    ├── oga.tradegateway.gov.ng   (same pattern as trader)
    ├── admin.tradegateway.gov.ng (same pattern as trader)
    └── api.tradegateway.gov.ng   → APISIX :9080 (no forward_auth — Bearer JWT only)
```

## Adding Caddy to Docker Compose

Add the following service to `infra/docker-compose.yml`:

```yaml
  caddy:
    image: caddy:2-alpine
    container_name: tg-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"   # HTTP/3 QUIC
      - "2019:2019"     # Admin API (internal)
    volumes:
      - ./caddy/Caddyfile.prod:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
      - /var/log/caddy:/var/log/caddy
    environment:
      CADDY_DOMAIN_BASE: ${CADDY_DOMAIN_BASE:-tradegateway.gov.ng}
      KEYCLOAK_UPSTREAM: keycloak:8080
      APISIX_UPSTREAM: apisix:9080
      FRONTEND_UPSTREAM: frontend:3000
      OAUTH2_PROXY_UPSTREAM: oauth2-proxy:4180
      ACME_EMAIL: ${ACME_EMAIL:-ops@tradegateway.gov.ng}
    depends_on:
      keycloak:
        condition: service_healthy
      apisix:
        condition: service_healthy
    networks:
      - tradegateway

  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.6.0
    container_name: tg-oauth2-proxy
    restart: unless-stopped
    command:
      - --config=/etc/oauth2-proxy/oauth2-proxy.cfg
    environment:
      OAUTH2_PROXY_CLIENT_SECRET: ${KEYCLOAK_CADDY_CLIENT_SECRET:-changeme}
      OAUTH2_PROXY_COOKIE_SECRET: ${OAUTH2_PROXY_COOKIE_SECRET:-changeme32bytesbase64==}
    volumes:
      - ./caddy/oauth2-proxy.cfg:/etc/oauth2-proxy/oauth2-proxy.cfg:ro
    ports:
      - "4180:4180"
    depends_on:
      - keycloak
      - redis
    networks:
      - tradegateway
```

Also add volumes:
```yaml
volumes:
  caddy_data:
  caddy_config:
```

## Keycloak Client Configuration

The `caddy-frontend` Keycloak client must be created in the `tradegateway` realm with:

- **Client ID:** `caddy-frontend`
- **Client type:** OpenID Connect
- **Client authentication:** On (confidential)
- **Valid Redirect URIs:**
  - `https://trader.tradegateway.gov.ng/oauth2/callback`
  - `https://oga.tradegateway.gov.ng/oauth2/callback`
  - `https://admin.tradegateway.gov.ng/oauth2/callback`
  - `http://localhost:8888/oauth2/callback` (dev)
- **Web origins:** `+`
- **Scopes:** `openid profile email roles`

The client secret is exported as `KEYCLOAK_CADDY_CLIENT_SECRET` in the environment.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `CADDY_DOMAIN_BASE` | Base domain for all subdomains | `tradegateway.gov.ng` |
| `ACME_EMAIL` | Email for Let's Encrypt / ZeroSSL registration | `ops@tradegateway.gov.ng` |
| `KEYCLOAK_CADDY_CLIENT_SECRET` | Secret for the `caddy-frontend` Keycloak client | (required) |
| `OAUTH2_PROXY_COOKIE_SECRET` | 32-byte base64 random secret for session cookies | (required) |

Generate cookie secret: `openssl rand -base64 32`

## Kubernetes Deployment

See `infra/k8s/caddy/` for Kubernetes manifests:
- `deployment.yaml` — Caddy Deployment with ConfigMap-mounted Caddyfile
- `service.yaml` — LoadBalancer Service exposing ports 80, 443 (TCP + UDP)
- `configmap.yaml` — Caddyfile as a ConfigMap
- `ingress-class.yaml` — IngressClass resource for Caddy Ingress Controller
- `oauth2-proxy-deployment.yaml` — oauth2-proxy Deployment
