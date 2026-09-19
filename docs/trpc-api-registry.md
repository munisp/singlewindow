# tRPC External API Registry (Phase 20)

This registry records the disposition of tRPC routers that have **no in-repo
client caller** (web / react-native / flutter / e2e), as audited in Phase 20
(orphan-code audit, singlewindow finding 3). These routers are registered in
`server/routers.ts` and reachable via `POST/GET /api/trpc/<namespace>.<procedure>`
for **external tRPC-HTTP callers** (partner agencies, regulator integrations,
ops tooling). Reachable-but-unused surface is documented here deliberately so
security review can distinguish intentional external API from dead code.

## Kept — intentional external API surface

| Router | Procedures | Rationale |
|---|---|---|
| `fundFlow` (`server/routers/fund-flow.ts`) | 23 | Canonical API surface for all 20 fund-flow scenarios; delegates to Temporal workflows (TigerBeetle/Mojaloop execution). The TypeScript layer *is* the documented API boundary for payment integrations. |
| `complianceReporting` (`server/routers/complianceReporting.ts`) | 8 | Regulatory compliance surface (PCI-DSS, SOC 2, GDPR/NDPR data-subject rights, automated submission to CBN/NFIU/NAICOM/NCC). Designed for regulator/auditor callers. |
| `valuation` (`server/routers/valuation.ts`) | 7 | Customs valuation reference database (WTO CVA) — partner-agency query surface. |
| `wtoValuation` (`server/routers/wtoValuation.ts`) | 6 | Proxy to the Rust wto-valuation-engine; external integration surface. |
| `advanceRuling` (`server/routers/advanceRuling.ts`) | 7 | WTO TFA Art. 3 advance rulings + WCO SAFE AEO MRA validation — partner-country integration surface. |
| `crf` (`server/routers/crf.ts`) | 10 | Combined Reporting Form — statutory trade-statistics reporting to NBS/CBN. |
| `msw` (`server/routers/msw.ts`) | — | Phase 9 WP-C Maritime Single Window PBAC surface; producing boundary for topic `maritime.msw.v1` (contract: blueeconomy-contracts proto/blueeconomy/msw/v1). Callers are external FAL parties (agents, port health, agencies). |
| `openData` (`server/routers/openData.ts`) | 4 | Deliberately **public** citizen-facing open-data API (CC BY 4.0, aggregated/anonymized), IP-rate-limited, fail-closed. No in-repo caller is expected. |
| `redis` (`server/routers/redis.ts`) | 7 | Admin/ops surface for cache TTL management and key inspection. Production path queries real Redis `INFO` (test-only stub behind `REDIS_TEST_STUB`); intended for external ops tooling/consoles. |

## Wired in Phase 20 (no longer orphaned)

| Router | Action |
|---|---|
| `shorePass` | Officer UI wired: `/app/customs/shore-pass` (`client/src/pages/app/ShorePassBoard.tsx`). |
| `dangerousGoods` | Officer UI wired: `/app/customs/dangerous-goods` (`client/src/pages/app/DangerousGoodsBoard.tsx`). |

## Notes

- If access logs later confirm zero external traffic for any kept router, it
  should be removed in a follow-up cleanup rather than left registered.
- The `stream` router remains registered but reports an honest
  `STREAMING_NOT_CONFIGURED` / `STREAM_BACKEND_UNAVAILABLE` state (Fluvio
  backend deprecated, P0-9).
