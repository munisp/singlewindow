# WP-9 UX Audit — singlewindow client

Branch: `phase10/wp9-ux-polish`. Base: `main` @ 221b637 (remote head, fetched fresh — local mirror was stale/mid-merge).
Scope: 132 pages under `client/src/pages`, 46 shared + 40 ui components, PWA surface.

## Method
- Static audit: nav↔route cross-check (115 nav links vs 129 routes), placeholder/mock grep, loading/error/empty-state coverage scan, a11y scan (img alt, icon-only buttons, onClick divs), fail-closed doctrine review (fake success, swallowed errors, silent zero-stats).
- Baselines: `tsc --noEmit` clean before and after; `vite build` green; PWA assets verified in `dist/public`.

## Findings & dispositions

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| 1 | Critical | Dead nav: declaration toast action navigated to `/app/declarations` (no route → NotFound) | Fixed → `/app/trader/declarations` (DashboardLayout.tsx) |
| 2 | Critical | Manifest `start_url` `/app/dashboard` and shortcuts `/app/declarations/new`, `/app/oga/permits` were dead URLs | Fixed → `/app/trader`, `/app/trader/declarations/new`, `/app/oga` (manifest.json) |
| 3 | High | Offline fallback was an inline `<h1>` string; index.html deliberately uncached so `caches.match('/')` could never hit | Added honest `public/offline.html` (retry, queue disclosure, stale-data disclosure, WCAG alert role); SW v4 caches & serves it |
| 4 | High | SW served cached GET API responses with no staleness signal | SW now badges cached fallbacks with `X-SW-Stale` / `X-SW-Stale-Since` headers and returns honest 503 `{code:'OFFLINE'}` when nothing cached |
| 5 | High | Offline queue count never pushed to UI (`SW_QUEUE_COUNT` listener existed but SW never posted) | SW now broadcasts queue count on enqueue & after replay |
| 6 | High | No PWA install UX (`beforeinstallprompt` unused) | Added `InstallPrompt` component (native prompt, iOS manual guidance, 14-day dismiss respect, no fake success), mounted in App |
| 7 | High | DeveloperPortal playground returned fabricated `status:"ok"` responses | Changed to `status:"simulated"` with explicit "no request was sent" disclosure |
| 8 | High | BondedWarehouse, AseanSingleWindow: no loading/error gates — zeros rendered as if real | Added skeleton loading gates + fail-closed error panels with retry |
| 9 | High | CargoTrackingMap: stats rendered `?? 0` silently; no down-state disclosure | Stats show `—` until data; error banner with retry when tracking unavailable and WS not live; skeleton while loading |
| 10 | Critical | TraderOnboarding role selection advanced the wizard even when the role save failed (fake success) | Now advances only on confirmed save; actionable error toast otherwise |
| 11 | High | TraderOnboarding step-save errors swallowed silently | Honest toast: progress not persisted, kept on screen only |
| 12 | Medium | `ui/empty` shared component exists but 0 page adoptions; pages hand-roll empty states | Top screens already have honest empty states with CTAs (TraderDeclarations verified); full migration deferred (low risk, cosmetic inconsistency) |
| 13 | Medium | 11 of 99 app pages lacked explicit loading state | 4 highest-traffic fixed (#8,#9); remainder (GeoipSeed, ComplianceEmailSettings, BulkExport, NLFinancialQuery admin/utility screens) logged for next pass |
| 14 | Low | a11y scan: no `<img>` without alt; no icon-only buttons without aria-label; 1 onClick div is a modal stopPropagation (acceptable) | No action needed |

## Not done (and why)
- Client component tests: repo's vitest is configured for `server/**` only and has no jsdom/@testing-library deps; registry install fails in this environment. PWA/SW logic kept dependency-free so it can be tested plain later.
- Full `ui/empty` migration, chunk-splitting of the 927 kB bundle: cosmetic/perf, not correctness.

## Evidence
- `npx tsc --noEmit` — clean.
- `npx vite build` — ✓ built in 2.86s; `dist/public` contains manifest.json, sw.js, offline.html, icon-192/512.png.
- Server test suite untouched by these changes (client/public only).
