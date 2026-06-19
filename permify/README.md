# Permify — TradeGateway RBAC Schema

This directory contains the Permify permission schema for the TradeGateway NGSWTP platform.

## Entities

| Entity | Description |
|--------|-------------|
| `organisation` | Top-level tenant grouping users by agency/company |
| `user` | Any authenticated user (Keycloak subject) |
| `declaration` | Customs declaration — core workflow entity |
| `payment` | Duty/fee payment linked to a declaration |
| `permit` | OGA licence/permit/certificate |
| `aeo_application` | Authorised Economic Operator application |
| `audit_task` | Post-clearance audit task |
| `cargo_shipment` | Cargo tracking record |
| `kyc_record` | Know Your Customer / trader registration |
| `drawback_claim` | Duty drawback/refund claim |
| `finance_report` | Finance and revenue report |
| `bulk_export` | Bulk data export job |
| `site_settings` | Platform-wide configuration |

## Bootstrap

### 1. Start Permify sidecar

```bash
docker run -p 3476:3476 -p 3478:3478 \
  ghcr.io/permify/permify serve \
  --database-uri="postgres://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway?sslmode=disable"
```

### 2. Write the schema

```bash
permify schema write --schema permify/schema.perm \
  --endpoint localhost:3476 \
  --tenant-id tradegateway
```

### 3. Seed initial relationships

```bash
# Make a user an org admin
permify relationship write \
  --endpoint localhost:3476 \
  --tenant-id tradegateway \
  "organisation:main#admin@user:ADMIN_USER_ID"

# Assign a customs officer
permify relationship write \
  --endpoint localhost:3476 \
  --tenant-id tradegateway \
  "organisation:main#member@user:OFFICER_USER_ID"
```

### 4. Environment variables

Add to your `.env`:

```env
PERMIFY_URL=http://localhost:3476
PERMIFY_TENANT_ID=tradegateway
```

## Permission Check Examples

```typescript
// Can user X approve declaration Y?
const allowed = await can(userId, "approve", "declaration", declarationId);

// Can user X cancel payment Z?
const allowed = await can(userId, "cancel", "payment", paymentId);
```

## Role Mapping from Keycloak

| Keycloak Role | Permify Relation | Entity |
|---------------|-----------------|--------|
| `tradegateway-admin` | `admin` | `organisation` |
| `tradegateway-customs-officer` | `customs_officer` | `declaration`, `cargo_shipment` |
| `tradegateway-oga-officer` | `oga_officer` | `permit` |
| `tradegateway-finance` | `finance_officer` | `payment`, `drawback_claim`, `finance_report` |
| `tradegateway-audit-reviewer` | `auditor` | `audit_task` |
| `tradegateway-trader` | `owner` / `applicant` | `declaration`, `aeo_application` |
| `tradegateway-port-operator` | `port_operator` | `cargo_shipment` |
