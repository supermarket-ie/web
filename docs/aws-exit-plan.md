# AWS scraper exit plan

Status: implementation in progress on `scrape-observability`. This document does not authorize production cutover.

## Target runtime

| Workload | Target | Transport | Scheduling status |
|---|---|---|---|
| Website / APIs | Vercel | Next.js functions | Existing production |
| Dunnes refresh | Vercel Queue | Dunnes Storefront JSON API | Disabled |
| SuperValu refresh | Vercel Queue | Direct validated product-page HTTP | Disabled |
| Aldi refresh | Vercel Queue | Direct validated product-page HTTP | Disabled |
| Tesco refresh | Vercel Queue | Pending accepted Vercel egress | Disabled |
| Scrape state / prices | Supabase | Service role only for worker writes | Existing production |
| Scrape watchdog | Vercel cron route | Supabase scrape health + optional Resend email | Disabled |
| Legacy scraper | AWS EC2 systemd | `scripts/scrape_all.sh` | Remains authoritative until explicit approval |
| Legacy failure alert | OpenClaw Telegram event | EC2 only | Remains until cutover |

## Non-Tesco Vercel workers

All three workers are fail-closed. No store can run through the multi-store orchestrator unless both the global `NON_TESCO_VERCEL_WORKERS_ENABLED=true` flag and its store-specific flag are enabled.

- `DUNNES_VERCEL_WORKER_ENABLED=true`
- `SUPERVALU_VERCEL_WORKER_ENABLED=true`
- `ALDI_VERCEL_WORKER_ENABLED=true`

The orchestrator is `GET /api/workers/store-scrape-trigger`, requires the existing `CRON_SECRET` bearer token, and is intentionally absent from `vercel.json` cron schedules until manual smoke tests pass.

Selection is service-role-only and stalest-first through `select_store_products_for_refresh`. SuperValu and Aldi require a real `/product/` mapping; search-result URLs are never queued as direct refresh targets.

Product completion is idempotent through `scrape_product_receipts` and `finalize_store_scrape_product`. A queue redelivery cannot write the same product twice for the same scrape run.

## Database prerequisites applied

The following additive runtime prerequisites have been applied to production Supabase without rewriting existing catalogue or price data:

- `finalize_store_scrape_product` — service-role-only generic idempotent finaliser.
- `select_store_products_for_refresh` — service-role-only stalest-first selector.
- `idx_price_obs_store_product_observed_at` — composite lookup index for latest-observation selection.

## Current verification gate

A Preview-only read-only endpoint, `/api/workers/store-direct-canary`, was added to prove retailer transport without writing price data. It must be removed before the final production merge.

The Preview deployment builds successfully, but Vercel Deployment Protection currently prevents the connected tooling from obtaining a bypass URL. This is an access-to-Preview issue, not a retailer transport result. No direct-runtime transport should be declared proven until the canary endpoint is actually executed from Vercel.

## Tesco

Tesco remains the only special transport blocker. Existing direct Vercel and GitHub/Azure identities were blocked by Akamai and must not be hammered. Strict matching, direct-URL-first validation, idempotent queue processing and the 48-hour egress quarantine helpers remain mandatory.

Vercel supports project Static IP egress configuration by region. Before considering paid third-party proxy transport, test a deliberate Vercel Static IP identity with one Tesco canary. Treat a Static IP pair/region as one quarantine unit unless individual routing can be proven controllable.

## Cutover gates

1. CI green and Preview READY.
2. Execute read-only Vercel direct canaries for Dunnes, SuperValu and Aldi.
3. Enable worker flags in Preview only and run very small queue smoke batches.
4. Verify `scrape_runs`, receipts, failures, price accuracy and idempotency.
5. Prove Tesco accepted egress with one canary; stop immediately on confirmed block.
6. Run a full Vercel cycle in parallel with EC2 and compare store coverage/results.
7. Obtain explicit approval before adding/enabling scraper production cron schedules.
8. Observe at least one full scheduled Vercel cycle while EC2 remains available.
9. Obtain explicit approval before disabling `supermarket-scrape.timer`.
10. Remove OpenClaw alerting and retire EC2 only after parity is confirmed.
