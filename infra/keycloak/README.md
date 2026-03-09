# Keycloak Realm — TradeGateway NGSWTP

## Overview

The `realm-export.json` file defines the complete Keycloak realm for TradeGateway NGSWTP. It includes 9 platform roles, 3 OIDC clients, custom protocol mappers that embed `roles`, `company_name`, `tin`, and `aeo_status` directly into JWT access tokens, and 7 demo seed users.

## Roles

| Role | Description |
|---|---|
| `admin` | Platform administrator — full access to all resources and system configuration |
| `trader` | Registered trader — submit declarations, pay duties, track cargo |
| `customs_officer` | Customs officer — review declarations, assign risk lanes, issue clearance |
| `oga_officer` | Other Government Agency officer — review and approve sector-specific permits |
| `finance_officer` | Finance officer — manage duty invoices, reconciliation, and drawback claims |
| `port_operator` | Port operator — cargo release, berth scheduling, vessel tracking |
| `auditor` | Post-clearance auditor — review completed declarations, issue penalties |
| `compliance_officer` | Compliance officer — sanctions screening, WCO CEN alerts, INTERPOL notices |
| `inspector` | Physical inspection officer — container inspections, vision AI |
| `security_analyst` | SOC analyst — SIEM alerts, threat intelligence |

## Clients

| Client ID | Type | Purpose |
|---|---|---|
| `tradegateway-web` | Public (PKCE) | React SPA — browser-based OIDC Authorization Code + PKCE flow |
| `tradegateway-api` | Confidential | Backend API server — M2M client credentials for service-to-service calls |
| `tradegateway-apisix` | Confidential | APISIX JWT plugin — validates tokens at the gateway layer |

## Token Claims

The `tradegateway-roles` client scope adds these custom claims to every token:

| Claim | Source | Example |
|---|---|---|
| `roles` | Keycloak realm roles | `["trader"]` |
| `company_name` | User attribute | `"Demo Imports Ltd"` |
| `tin` | User attribute | `"C0012345678"` |
| `aeo_status` | User attribute | `"approved"` |

## Import Instructions

### Docker Compose (recommended for local development)

The `docker-compose.yml` at the project root already includes a Keycloak service. Import the realm on first start:

```bash
# Start Keycloak
docker compose up -d keycloak

# Wait for Keycloak to be ready (check logs)
docker compose logs -f keycloak

# Import the realm (Keycloak 22+)
docker exec -it tradegateway-keycloak \
  /opt/keycloak/bin/kc.sh import \
  --file /opt/keycloak/data/import/realm-export.json \
  --override true
```

Alternatively, mount the file in `docker-compose.yml`:

```yaml
keycloak:
  image: quay.io/keycloak/keycloak:24.0
  command: start-dev --import-realm
  environment:
    KEYCLOAK_ADMIN: admin
    KEYCLOAK_ADMIN_PASSWORD: admin
  volumes:
    - ./infra/keycloak/realm-export.json:/opt/keycloak/data/import/realm-export.json
  ports:
    - "8080:8080"
```

### Keycloak Admin UI

1. Open `http://localhost:8080/admin`
2. Log in as `admin / admin`
3. Click **Create realm** → **Browse** → select `realm-export.json` → **Create**

## APISIX JWT Integration

APISIX validates Keycloak JWTs using the `openid-connect` plugin. Configure the route plugin as follows:

```yaml
plugins:
  openid-connect:
    client_id: tradegateway-apisix
    client_secret: apisix-jwt-secret-change-in-production
    discovery: http://keycloak:8080/realms/tradegateway/.well-known/openid-configuration
    bearer_only: true
    realm: tradegateway
    introspection_endpoint_auth_method: client_secret_post
    set_access_token_header: true
    access_token_in_authorization_header: true
```

The `roles` claim from the token is forwarded to upstream services via the `X-User-Roles` header, which the tRPC context (`server/_core/context.ts`) reads to populate `ctx.user.role`.

## tRPC Context Integration

The tRPC context already reads the session cookie set by Manus OAuth. To switch to Keycloak tokens, update `server/_core/context.ts` to:

1. Extract the `Authorization: Bearer <token>` header
2. Verify the JWT signature against Keycloak's JWKS endpoint (`/realms/tradegateway/protocol/openid-connect/certs`)
3. Map the `roles[0]` claim to `ctx.user.role`
4. Use `sub` as `ctx.user.id`

The `server/_core/permify.ts` helper then uses `ctx.user.id` for all authorization checks, making the auth provider swappable without changing any procedure logic.

## Demo User Credentials

All passwords are marked `temporary: true` — users must change them on first login.

| Username | Password | Role |
|---|---|---|
| `admin` | `Admin@TradeGateway2026` | admin |
| `demo_trader` | `Trader@Demo2026` | trader |
| `demo_customs` | `Customs@Demo2026` | customs_officer |
| `demo_oga` | `OGA@Demo2026` | oga_officer |
| `demo_finance` | `Finance@Demo2026` | finance_officer |
| `demo_port` | `Port@Demo2026` | port_operator |
| `demo_compliance` | `Compliance@Demo2026` | compliance_officer |
