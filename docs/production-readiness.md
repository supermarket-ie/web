# supermarket.ie Production Readiness

Last audited: 2026-08-16

This document tracks the production-readiness work on `scrape-observability`. It is not authority to merge, enable production schedules, disable EC2, rotate secrets, or change/delete production data.

## Safety boundaries

Do not perform the following without explicit approval:

- merge `scrape-observability` to `main`
- enable a production scraper cron
- change or disable `supermarket-scrape.timer` / `supermarket-scrape.service`
- delete or rewrite production data
- rotate working secrets
- add paid proxy/egress services

## Current control planes

| Area | Current state | Target |
|---|---|---|
| Application | Vercel project `web` | Vercel |
| Database | Supabase `ytyzwiqnobxehdqrnzhx` | Supabase |
| Source / CI | GitHub `supermarket-ie/web` | GitHub Actions + protected `main` |
| Scheduled supermarket scrape | EC2 systemd, Mon/Thu 05:00 UTC | Proven replacement before retirement |
| Tesco Vercel worker | Preview-only / fail-closed | Vercel queue + proven egress |
| Scrape observability | Supabase tables + secured admin API | Ops dashboard + alerts |

## Repository / CI

- Working branch: `scrape-observability`
- Production branch: `main`
- No merge to main has been performed by this readiness pass.
- GitHub Actions runs `npm ci`, lint, tests, and production build.
- CI passed for the security hardening migration and legacy planner-profile normalization commits.
- Repository visibility was reported as **public** during audit. Change to private before production-readiness sign-off.
- Working branch is currently unprotected. Protect `main` at minimum with required CI, no force pushes, no deletion, and PR review before merge.

## Database security

Production currently has RLS disabled on:

- `subscribers`
- `products`
- `store_products`
- `price_observations`
- `shared_lists`
- `list_items`

The affected roles currently have broader table privileges than required. A branch-only migration has been prepared to:

- enable RLS
- make catalogue tables read-only to public clients
- keep subscriber/list data server-only
- make `latest_prices` a security-invoker view

Do not apply this migration to production until application access paths and Preview smoke tests are complete.

Scrape observability tables and `tesco_egress_pool` already use RLS with service-role-only access.

## Production jobs

### EC2 supermarket scrape

- Runtime: existing AWS EC2
- Trigger: `supermarket-scrape.timer`
- Frequency: Monday + Thursday, 05:00 UTC
- Service: `supermarket-scrape.service`
- Command: `scripts/scrape_all.sh`
- Status: production source of truth for scheduled refreshes until replacement is proven
- Action: do not modify/disable without explicit approval

### Vercel weekly digest

- Route: `/api/cron/weekly-digest`
- Schedule: Sunday 08:00 UTC
- Auth: `CRON_SECRET` bearer token
- Dependencies: Supabase, Resend, Anthropic for Tier 3
- Batch: maximum 50 subscribers per invocation
- Known issue: Tier-3 generation has no non-AI fallback if Anthropic is unavailable / out of credit

### Vercel price alerts

- Route: `/api/cron/check-alerts`
- Schedule: daily 07:30 UTC
- Auth: `CRON_SECRET` bearer token
- Dependencies: Supabase, Resend
- Current production data: zero `price_alerts` rows during 2026-08-16 audit
- Known issue: current query derives the minimum from historical observations rather than strictly the latest/current price. Fix before activating price alerts as a user-facing feature.

### Vercel price watchdog

- Route: `/api/cron/price-watchdog`
- Schedule: daily 07:30 UTC
- Thursday nudge: Thursday 09:00 UTC (`?nudge=thursday`)
- Auth: `CRON_SECRET` bearer token
- Dependencies: Supabase, Resend
- AI dependency: none
- Sunday: deliberately skips to avoid competing with weekly digest
- Thursday normal run: deliberately skips in favour of nudge run

### Tesco Vercel queue

- Trigger route: `/api/workers/tesco-scrape-trigger`
- Consumer route: `/api/queues/tesco-scrape-batch`
- Topic: `tesco-scrape-batches`
- Feature flag: `TESCO_VERCEL_WORKER_ENABLED=true` only in intended test scope
- Trigger auth: strict `CRON_SECRET` bearer token
- Queue design: small batches, idempotency receipts, transient retries, permanent data/match failures not retried
- Schedule: none enabled
- Transport gap: consumer still calls direct Vercel transport. It does not yet claim/use/quarantine entries from `tesco_egress_pool`.
- Rule: no broad Tesco run until a one-product canary succeeds from an accepted egress identity.

## Scraper safety / Tesco

Keep these protections:

- direct-URL-first refresh
- title/name validation
- product-type conflict detection
- strict +/-10% size tolerance
- guarded fuzzy search fallback
- `direct_name_mismatch` classification
- preserve existing URL unless replacement validates
- idempotent finalisation
- prefer missing price over false match

Known blocked transports from the current test window:

- Vercel direct HTTP
- Vercel Playwright/Chromium
- fresh GitHub/Azure-hosted Chromium

Treat a confirmed Akamai block as a 24-48 hour cooldown. Do not hammer blocked identities or add stealth/fingerprint bypasses.

## Application issues

### Planner

Verified production runtime issues over the audited period included:

- Anthropic insufficient-credit errors
- handled Epicure session failures
- legacy profile crash when `meals` was missing
- 60-second runtime timeouts

The legacy-profile crash has a branch fix that normalizes old/incomplete profiles before building the planner prompt.

Anthropic availability still requires a production resilience decision: restore provider billing and/or provide a tested fallback. Do not silently switch providers without verifying configuration, cost and output behaviour.

### Subscribe

Two `family_size` NOT NULL errors were found in production logs. Both were generated by a smoke-test address, not normal user traffic. The schema should stay strict; malformed requests should return a 400 instead of reaching the database as NULL.

### Browse / trust

- `/browse/null` appeared in production traffic and should be monitored/traced. Current BrowseClient derives product slugs from `canonical_name`, so the source may be stale links/bots or another code path.
- Browse page currently contains an unsupported marketing claim of `2,400+ families signed up`, while the audited `subscribers` table contained 59 rows. Remove or replace only with a verified metric.
- Sitemap `DATA_FRESHNESS` is hard-coded and should ultimately reflect actual verified data freshness rather than a stale static date.

## Scrape observability

Available foundation:

- `scrape_runs`
- `scrape_failures`
- `scrape_product_receipts`
- `scrape_fetch_attempts`
- Tesco egress health/cooldown state
- secured `/api/admin/scrape-health`

Ops view should expose at minimum:

- latest successful run per store
- coverage/failure rate
- stale-price counts
- transport block classifications
- queue backlog / delivery state where available
- cron health
- recent runtime errors

## Launch-blocker classification

### Blockers before production-readiness sign-off

1. Make repository private / complete secret-history review.
2. Resolve unsafe Supabase public-table access and verify the RLS migration in Preview before production application.
3. Resolve planner provider availability or implement a tested graceful fallback.
4. Complete Preview application smoke testing.
5. Reconcile production migration history with repository migrations.
6. Remove unsupported public trust/traction claims.

### Blockers before replacing EC2 scraping

1. Prove SuperValu, Dunnes and Aldi replacement runs with parity/observability.
2. Prove one Tesco canary from an accepted egress architecture.
3. Wire Tesco egress claiming + block quarantine into the queue consumer.
4. Observe at least one full scheduled cycle alongside EC2 and compare results.
5. Obtain explicit approval before disabling EC2.

## Staged deployment path

### Stage A

- clean working branch
- CI green
- Preview green
- migrations reconciled
- application smoke test
- security fixes prepared and tested

### Stage B

- background workers proven in Preview
- one-product Tesco canary succeeds
- other scraper jobs verified
- ops visibility verified

### Stage C

- review complete diff against `main`
- explicit merge approval
- production deployment
- production smoke test

### Stage D

- observe full scheduled scrape cycle
- compare new pipeline output to EC2
- confirm parity and data quality

### Stage E

Only with explicit approval:

- disable EC2 timer
- remove OpenClaw operational dependency
- retire obsolete infrastructure
