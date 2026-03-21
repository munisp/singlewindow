# TradeGateway™ NGSWTP — Demo Mode Runbook

> **Purpose:** This document explains how to enable and use Demo Mode for the TradeGateway™ NGSWTP (Next Generation Single Window Trade Platform). Demo Mode bypasses Manus OAuth authentication and pre-seeds six role-specific demo users, enabling full platform navigation without live identity credentials.

---

## Table of Contents

1. [What is Demo Mode?](#1-what-is-demo-mode)
2. [Enabling Demo Mode](#2-enabling-demo-mode)
3. [Disabling Demo Mode](#3-disabling-demo-mode)
4. [Pre-Seeded Demo Users](#4-pre-seeded-demo-users)
5. [Portal Access Map](#5-portal-access-map)
6. [Row-Level Security (RLS) Bypass](#6-row-level-security-rls-bypass)
7. [Demo Mode Architecture](#7-demo-mode-architecture)
8. [Security Considerations](#8-security-considerations)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. What is Demo Mode?

Demo Mode is a development and evaluation feature that replaces the production Manus OAuth 2.0 authentication flow with a lightweight JWT-based session mechanism. When enabled, the platform:

- Bypasses the external OAuth provider (`VITE_OAUTH_PORTAL_URL`) entirely.
- Injects a `DemoModeBanner` across all authenticated pages to signal the non-production state.
- Allows any visitor to assume one of six pre-defined role personas without credentials.
- Seeds 25 sample stakeholder profiles, declarations, and permit records into the database on first startup.

Demo Mode is designed for **platform demonstrations, RFP evaluations, and developer onboarding**. It must never be enabled in a production environment.

---

## 2. Enabling Demo Mode

Demo Mode is controlled by a single environment variable. Set it in the project secrets or your local `.env` file:

```bash
DEMO_MODE=true
```

### Via Manus Secrets UI

1. Open the **Settings → Secrets** panel in the Manus Management UI.
2. Add or update the key `DEMO_MODE` with value `true`.
3. Restart the dev server (the server reads this variable at startup).

### Via CLI (local development)

```bash
# In the project root
echo "DEMO_MODE=true" >> .env
pnpm dev
```

### Verification

After restarting, navigate to any portal URL (e.g., `/app/trader`). You will see a yellow **Demo Mode** banner at the top of the page confirming that the bypass is active.

---

## 3. Disabling Demo Mode

To restore full OAuth authentication, remove or unset the environment variable:

```bash
DEMO_MODE=false   # or simply delete the variable
```

After restarting the server, unauthenticated requests to `/app/*` routes will redirect to the Manus OAuth login portal. The `DemoModeBanner` will no longer appear.

---

## 4. Pre-Seeded Demo Users

Six demo users are automatically created when Demo Mode is first activated. Each user maps to a distinct portal and role within the platform.

| # | Display Name | Role | Email | Portal Path | Description |
|---|---|---|---|---|---|
| 1 | **Adaeze Obi** | `trader` | `trader@demo.ngswtp.gov` | `/app/trader` | Import/export trader submitting declarations and tracking shipments |
| 2 | **Kwame Asante** | `customs_officer` | `customs@demo.ngswtp.gov` | `/app/customs` | Customs officer processing the declaration queue and risk assessments |
| 3 | **Fatima Al-Rashid** | `oga_officer` | `oga@demo.ngswtp.gov` | `/app/oga` | Other Government Agency officer reviewing and approving permits |
| 4 | **Chidi Okonkwo** | `admin` | `admin@demo.ngswtp.gov` | `/app/admin` | Platform administrator managing users, settings, and system health |
| 5 | **Ngozi Eze** | `security_analyst` | `security@demo.ngswtp.gov` | `/app/security` | Security analyst monitoring threats, SIEM alerts, and sanctions screening |
| 6 | **Emeka Nwosu** | `developer` | `developer@demo.ngswtp.gov` | `/app/developer` | API developer managing keys, exploring endpoints, and monitoring usage |

### Switching Between Demo Users

The demo session endpoint accepts a `role` parameter that sets the active persona:

```http
POST /api/demo/session
Content-Type: application/json

{ "role": "trader" }
```

Valid role values: `trader`, `customs_officer`, `oga_officer`, `admin`, `security_analyst`, `developer`.

The server returns a signed JWT cookie (`session`) that the frontend reads via `useAuth()`. The `DemoModeBanner` displays the current active role name.

---

## 5. Portal Access Map

Each demo role has access to a specific set of portal sections. The table below summarises the primary navigation paths available per role.

| Portal | Path | Primary Role | Key Features |
|---|---|---|---|
| **Trader Dashboard** | `/app/trader` | `trader` | Submit declarations, track shipments, AEO status, duty payments |
| **Customs Officer Dashboard** | `/app/customs` | `customs_officer` | Declaration queue, risk lanes (Green/Yellow/Red), live cargo event stream |
| **OGA Permit Review Portal** | `/app/oga` | `oga_officer` | Permit approval workflow, decision history, agency SLA tracking |
| **Administration Console** | `/app/admin` | `admin` | User management, stakeholder onboarding, service health, audit log |
| **Trade Security & Compliance Centre** | `/app/security` | `security_analyst` | Security alert feed, sanctions screening, Wazuh SIEM, threat intelligence |
| **Developer Portal** | `/app/developer` | `developer` | API key management, interactive playground, API reference, usage analytics |

The `admin` role has read access to all portals and can navigate the full sidebar menu.

---

## 6. Row-Level Security (RLS) Bypass

In production, the platform enforces Row-Level Security (RLS) on all database queries via the `withRlsContext(userId, role)` helper in `server/db.ts`. This ensures traders can only read their own declarations, customs officers see only their assigned queue, and so on.

In Demo Mode, the RLS context is populated with the demo user's `id` and `role` from the JWT session cookie. The bypass works as follows:

1. The `/api/demo/session` endpoint signs a JWT containing `{ id, role, email, name }` for the selected demo persona.
2. The `server/_core/context.ts` middleware verifies the JWT and sets `ctx.user` regardless of whether the request came through OAuth.
3. All tRPC procedures that call `withRlsContext(ctx.user.id, ctx.user.role)` receive the demo user's identity, so RLS policies apply normally.
4. The only difference from production is that the JWT is issued by the local server rather than the Manus OAuth provider.

This means **RLS is not disabled** in Demo Mode — data isolation between roles is preserved. The demo users each see only the data seeded for their role.

---

## 7. Demo Mode Architecture

```
Browser
  │
  ├─ GET /app/*  ──────────────────────────────────────────────────────┐
  │                                                                      │
  │  DemoModeBanner (client/src/components/DemoModeBanner.tsx)          │
  │  └─ POST /api/demo/session { role } ──────────────────────────────┐ │
  │                                                                    │ │
  └─ useAuth() ──► trpc.auth.me ──────────────────────────────────────┘ │
                                                                         │
Server                                                                   │
  ├─ server/demo-auth.ts                                                 │
  │  └─ Signs JWT with demo user payload (DEMO_MODE=true guard)         │
  │                                                                      │
  ├─ server/_core/context.ts                                             │
  │  └─ Verifies JWT → ctx.user (same path for OAuth & demo tokens)     │
  │                                                                      │
  └─ server/routes.ts / server/routers.ts                               │
     └─ All procedures call withRlsContext(ctx.user.id, ctx.user.role)  │
```

Key source files:

| File | Purpose |
|---|---|
| `server/demo-auth.ts` | Demo session endpoint; issues signed JWT for selected role |
| `client/src/components/DemoModeBanner.tsx` | Yellow banner shown on all authenticated pages in demo mode |
| `server/_core/context.ts` | tRPC context builder; accepts both OAuth and demo JWTs |
| `server/db.ts` | `withRlsContext()` helper; receives demo user identity from context |
| `db/schema.ts` | 11-table schema with RLS policies compatible with demo users |

---

## 8. Security Considerations

Demo Mode introduces deliberate security relaxations that are **only acceptable in non-production environments**. The following controls must be in place before any production deployment:

| Risk | Demo Mode Behaviour | Production Requirement |
|---|---|---|
| **Authentication bypass** | JWT issued by local server without OAuth | `DEMO_MODE` must be `false` or unset |
| **Predictable credentials** | Demo users have fixed emails and roles | All users must authenticate via Keycloak/Manus OAuth |
| **Seeded test data** | 25 sample stakeholders pre-loaded | Production database must not contain demo records |
| **Banner visibility** | Yellow banner warns of demo state | No banner in production (variable unset) |
| **JWT secret** | Uses `JWT_SECRET` env var | Rotate `JWT_SECRET` before go-live; use a 256-bit random value |

**Pre-production checklist:**

- [ ] Confirm `DEMO_MODE` is not set in the production environment.
- [ ] Rotate `JWT_SECRET` to a fresh 256-bit random value.
- [ ] Purge all demo user records from the production database.
- [ ] Verify that `/api/demo/session` returns `403 Forbidden` in production.
- [ ] Enable Keycloak OIDC integration and test all six role flows end-to-end.

---

## 9. Troubleshooting

### Demo banner does not appear

Verify that `DEMO_MODE=true` is set in the server environment (not just the Vite frontend env). The variable is read by `server/demo-auth.ts` at runtime. Restart the server after changing environment variables.

### Role switch has no effect

Clear the browser's session cookie (`session`) and retry the POST to `/api/demo/session`. The cookie is `HttpOnly` and `SameSite=Lax`; it cannot be set from JavaScript directly.

### "Unauthorized" errors after role switch

The JWT may have expired (default TTL is 24 hours in demo mode). Re-POST to `/api/demo/session` to obtain a fresh token.

### Database shows no seeded data

Run `pnpm db:push` to apply the latest schema migrations, then restart the server. The demo seed runs once on first startup when `DEMO_MODE=true`.

### Developer Portal shows "No API keys yet"

This is expected in a fresh demo environment. Click **+ New API Key** to create a key for the `developer` demo user. Keys are stored per-user in the `api_keys` table and are visible only to the owning user via RLS.

---

*Document maintained by the TradeGateway™ NGSWTP platform team. Last updated: March 2026.*
