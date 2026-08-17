# AWS scraper exit status

Verified 16 August 2026. This document describes the replacement for the EC2/OpenClaw scraper runtime. It does not authorize a production cutover by itself.

## Safety boundary

- Do not merge `scrape-observability` to `main` without explicit approval.
- Do not enable new production scraper schedules without explicit approval.
- Do not disable `supermarket-scrape.timer` or terminate EC2 until a parallel scrape cycle has passed.
- Prefer a missing price to an unvalidated match.

## Verified transport matrix

| Store | Target runtime | Verified transport | Notes |
| --- | --- | --- | --- |
| Dunnes | Vercel Queue | PASS | Direct Dunnes grocery JSON API returned usable candidates from Vercel Preview. |
| SuperValu | Vercel Queue | PASS | Direct validated product-page fetch returned title and price from Vercel Preview. |
| Aldi | GitHub Actions Playwright | PASS | Standard headless Chromium returned HTTP 200 and the real 32-product Dairy page. Vercel Dublin, Vercel London and Vercel Sandbox curl all returned Access Denied / 403, so Aldi is intentionally disabled on Vercel. |
| Tesco | Vercel Queue + controlled static egress | NOT YET PROVEN | Ordinary Vercel and GitHub/Azure egress are blocked. Static-IP egress must be provisioned and pass a one-product canary before any batch is queued. |

## Retained production architecture

### Dunnes and SuperValu

- Authenticated Vercel trigger using `CRON_SECRET`.
- Global and per-store feature flags remain fail-closed.
- Durable `@vercel/queue` batches.
- Stalest/unseen products selected first.
- Generic idempotent Supabase finalisation and durable receipts.
- No production scraper cron is currently enabled.

### Aldi

- Vercel Aldi queue code has been removed after repeated 403 verification.
- `.github/workflows/aldi-refresh.yml` is manual-only and uses standard Playwright.
- Default mode is `smoke`, limited to 10 exact stored-name matches from one Aldi category page.
- Full refresh requires explicitly choosing `full`.
- Production workflow requires a GitHub `production` environment secret named `SUPABASE_SERVICE_ROLE_KEY`.
- No Aldi GitHub schedule is currently enabled.

### Tesco

- `tesco_egress_pool` is the authoritative semaphore/cooldown gate.
- The pool is intentionally empty until a real egress identity is provisioned.
- Trigger claims an available identity before creating work.
- Exactly one product canary is processed before queue batches are published.
- Confirmed Akamai/security challenge stops immediately; it does not retry or fall through to search.
- Queue batches lease the egress identity, serialising a single static transport.
- First confirmed block fails the run, quarantines the identity for 48 hours, and later queued deliveries suppress themselves without another Tesco request.
- No third-party proxy or ScrapingBee dependency has been added.

## Production DB prerequisites already installed

The following additive, service-role-only scraper prerequisites are present in production Supabase:

- scrape observability tables/functions
- Tesco queue idempotency
- Tesco egress pool and cooldown helpers
- generic idempotent store finaliser
- stalest-first store refresh selector
- refresh-selection index

No historical mapping/price cleanup has been performed as part of these prerequisites.

## Remaining cutover gates

1. Current branch CI and Vercel Preview must both be green after cleanup.
2. Provision Vercel Static IP egress for the selected EU function region and add one corresponding enabled Tesco egress row.
3. Run a one-product Tesco canary only. Stop on any confirmed block.
4. Confirm the GitHub production environment has `SUPABASE_SERVICE_ROLE_KEY`, then run Aldi `smoke` mode only.
5. Run small Dunnes and SuperValu queue smoke runs with feature flags enabled only for the test environment.
6. Compare all smoke observations/failures through `scrape_runs` and receipts.
7. After explicit approval, schedule the new jobs in parallel with EC2.
8. Observe at least one complete scheduled cycle and compare store coverage/quality against EC2.
9. Only after explicit approval, disable `supermarket-scrape.timer` and retire OpenClaw/EC2.
