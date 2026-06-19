# Keycloak — TradeGateway Realm Configuration

This directory contains the Keycloak realm export for the TradeGateway NGSWTP platform.

## Quick Bootstrap

### 1. Start Keycloak

```bash
docker run -p 8080:8080 \
  -e KEYCLOAK_ADMIN=admin \
  -e KEYCLOAK_ADMIN_PASSWORD=CHANGE_ME \
  quay.io/keycloak/keycloak:24.0 start-dev
```

### 2. Import the realm

```bash
# Via Admin CLI
/opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user admin --password CHANGE_ME

/opt/keycloak/bin/kcadm.sh create realms \
  -f keycloak/realm-export.json
```

Or via the Keycloak Admin UI: **Master → Add Realm → Import → Upload `realm-export.json`**

### 3. Update client secrets

After import, regenerate secrets for:
- `tradegateway-api` (confidential client)
- `tradegateway-permify` (service account)

### 4. Environment variables

Add to your `.env`:

```env
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=tradegateway
KEYCLOAK_CLIENT_ID=tradegateway-web
KEYCLOAK_API_CLIENT_ID=tradegateway-api
KEYCLOAK_API_CLIENT_SECRET=<regenerated secret>
```

## Roles Reference

| Role | Description |
|------|-------------|
| `tradegateway-admin` | Full platform administration |
| `tradegateway-customs-officer` | Declaration review, assessment, clearance |
| `tradegateway-oga-officer` | OGA permit approval/rejection |
| `tradegateway-inspector` | Physical inspection recording |
| `tradegateway-finance` | Financial reports and drawback |
| `tradegateway-trader` | Declaration submission and cargo tracking |
| `tradegateway-aeo` | Authorised Economic Operator (expedited) |
| `tradegateway-clearing-agent` | Submit on behalf of traders |
| `tradegateway-port-operator` | Cargo manifest and berth scheduling |
| `tradegateway-soc-analyst` | Read-only SOC access |
| `tradegateway-audit-reviewer` | Post-clearance audit |
| `tradegateway-api-consumer` | Third-party API access |

## Token Verification

The backend (`server/_core/keycloakVerifier.ts`) automatically:
1. Fetches the JWKS from `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs`
2. Caches the key set for 5 minutes
3. Verifies RS256 JWT signatures
4. Extracts `realm_access.roles` and maps them to the internal `role` field

No additional configuration is required once the env vars are set.
