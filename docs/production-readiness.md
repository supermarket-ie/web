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
| Database | Supabase `ytyzwiqnobxehdqrnzhx` (`eu-west-1`) | Supabase |
| Source / CI | GitHub `supermarket-ie/web` | GitHub Actions + protected `main` |
| Scheduled supermarket scrape | EC2 systemd, Mon/Thu 05:00 UTC | Proven replacement before retirement |
| Tesco Vercel worker | Preview-only / fail-closed | Vercel queue + proven egress |
| Scrape observability | Supabase tables + secured admin API | Ops dashboard + alerts |

## Repository / CI

- Working branch: `scrape-observability`
- Production branch: `main`
- No merge to main has been performed by this readiness pass.
- Current audited branch head before this document update: `5158c4bbf27652fdc762bd09e0279e408907b3da`.
- GitHub Actions runs `npm ci`, lint, tests, and production build.
- CI is aligned to Node 24, matching the Vercel project runtime. The Node-24 validation run passed.
- The corresponding Vercel Preview deployment reached `READY`.
- `package-lock.json` is the active lockfile; no current `pnpm-lock.yaml` is present on the branch.
- Repository visibility is **public**. Change to private before production-readiness sign-off.
- GitHub secret-scanning alerts could not be read through the connected API; a full repository-history secret review therefore remains open.
- All inspected branches are unprotected. Protect `main` at minimum with required `validate` CI, no force pushes, no deletion, and PR review before merge.
- `staging`, `feat/retention-loop`, `feat/ai-driven-planner`, and `upgrade/plan-tool-use` are stale and strictly behind `main`; `master` is unrelated legacy history with no common ancestor.
- Local `.claude/settings.local.json` was removed from source control and is now ignored.
- The repository previously ignored the entire `scripts/` directory; that ignore rule was removed so scraper/ops changes cannot silently remain untracked.

## Vercel

- Project runtime: Node 24.x.
- Current observed Function region: `iad1`.
- Supabase is in `eu-west-1`; this region mismatch should be corrected independently of Tesco transport work.
- Static IP support exists on eligible Vercel plans. Secure Compute dedicated egress requires Enterprise. No networking change has been made.
- Preview and Production remain distinct; no Tesco production schedule has been enabled.

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

### Migration alignment

Production `supabase_migrations.schema_migrations` currently records only the recent scrape migrations, while the repository contains older application migrations as well. The recent migration timestamps also do not exactly match the repository filenames. Migration history must be reconciled before Stage A is complete; do not rewrite migration history blindly.

### Lidl freshness

Lidl is not part of the current scheduled refresh pipeline. Production audit found only two Lidl mappings with observations and the newest Lidl observation was from 2026-05-11. Public claims that all five stores were live have been removed on the branch.

A branch-only migration restricts `latest_prices` to the four actively refreshed stores:

- Tesco
- Dunnes
- SuperValu
- Aldi

Do not present Lidl as live again until it has a proven refresh pipeline and freshness monitoring.

## Production jobs

### EC2 supermarket scrape

- Runtime: existing AWS EC2
- Trigger: `supermarket-scrape.timer`
- Frequency: Monday + Thursday, 05:00 UTC
- Service: `supermarket-scrape.service`
- Command: `scripts/scrape_all.sh`
- Stores: Tesco, SuperValu, Dunnes, Aldi
- Status: production source of truth for scheduled refreshes until replacement is proven
- Action: do not modify/disable without explicit approval
- OpenClaw dependency: scraper execution itself does not require OpenClaw. `scripts/scrape_all.sh` uses `openclaw system event` only for Telegram failure notification. This alert path must be replaced before OpenClaw is retired.

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
- Production currently has zero `price_alerts` rows.
- Known correctness issue: the current alert query can use the historical minimum price rather than strictly the latest/current price. Fix before launching alerts to users.

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

## Scrape observability

Available foundation:

- `scrape_runs`
- `scrape_failures`
- `scrape_product_receipts`
- `scrape_fetch_attempts`
- Tesco egress health/cooldown state
- secured `/api/admin/scrape-health`

Current production `scrape_runs` evidence contains only recent manual Tesco runs. SuperValu, Dunnes and Aldi scheduled EC2 runs are not yet proven to write to the new observability tables. This is a Stage-B parity gap.

Ops view should expose at minimum:

- latest successful run per store
- coverage/failure rate
- stale-price counts
- transport block classifications
- queue backlog / delivery state where available
- cron health
- recent runtime errors

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

The Vercel direct worker validates the title returned from the known product URL before accepting a price. If the title does not confidently match, it does not publish that direct-page price and instead uses guarded search fallback.

Known blocked transports from the current test window:

- Vercel direct HTTP
- Vercel Playwright/Chromium
- fresh GitHub/Azure-hosted Chromium

Treat a confirmed Akamai block as a 24-48 hour cooldown. Do not hammer blocked identities or add stealth/fingerprint bypasses.

### Historical Tesco mapping contamination

The production Tesco mapping problem is significantly broader than the three known butter examples.

Read-only audit on 2026-08-16 found:

- 324 duplicate Tesco URLs
- 740 resolved mappings attached to those duplicate URLs
- up to 6 canonical mappings sharing one Tesco URL
- 175 duplicate URLs had August activity
- 392 mappings sit on those August-active duplicate URLs
- 257 of those mappings were refreshed in August
- 192 were refreshed since 2026-08-10

Sample inspection confirms a mixture of legitimate near-variants and obvious false mappings. Examples of clear contamination include unrelated foods sharing a cornflakes URL, wrong milk sizes sharing one product URL, and loose vegetables mapped to loose-leaf tea.

Known butter contamination remains `resolved` and received observations through 2026-08-15:

- Butter Salted 250g -> Biona Organic Crunchy Peanut Butter 250G
- Butter Salted 500g -> Tesco Butter Me Up Lighter Spread 500G
- Butter Unsalted 250g -> Biona Organic Smooth Peanut Butter 250G

Do **not** delete observations or rewrite mappings yet. The new runtime/matcher must first be proven. Cleanup must distinguish legitimate shared-product variants from false mappings and then be explicitly approved.

A SELECT-only repeatable audit is stored at `scripts/audit_tesco_mapping_integrity.sql`.

## Application issues

### Planner

Verified production runtime issues over the audited period included:

- Anthropic insufficient-credit errors
- handled Epicure session failures
- legacy profile crash when `meals` was missing
- 60-second runtime timeouts

Branch fixes now:

- normalize old/incomplete profiles before prompt generation
- terminate AI-SDK work at 55 seconds, before Vercel's 60-second function limit

Both changes passed CI and reached Vercel Preview.

Anthropic availability still requires a production resilience decision: restore provider billing and/or provide a tested fallback. Do not silently switch providers without verifying configuration, cost and output behaviour.

### Subscribe

Two `family_size` NOT NULL errors were found in production logs. Both were generated by a smoke-test address, not normal user traffic. The schema should stay strict; malformed requests should return a 400 instead of reaching the database as NULL.

### Vendor authentication

A critical branch issue was fixed: public vendor signup previously returned the seven-day vendor JWT directly to the browser, so an arbitrary claimed email could obtain dashboard access without proving email ownership.

Branch fixes:

- signup no longer returns the JWT
- login credential is sent only to the claimed email
- signup UI stops at a check-email state
- team notification does not contain a login token
- user-controlled HTML in the email is escaped
- vendor sign-in returns generic success to reduce account enumeration

The signup/auth fix passed CI and reached Preview.

Residual hardening: vendor and normal-user magic links still use JWTs in page URLs and client session flows. The longer-term design should consume the emailed magic link and establish an HttpOnly, Secure, SameSite cookie rather than carrying the session credential in URLs.

### Public API abuse surfaces

The following public endpoints should receive platform-level rate limiting / WAF protection before high-volume launch:

- analytics/event ingestion
- contact email
- vendor signup/sign-in email issuance
- magic-link issuance

Do not use an in-memory serverless rate limiter as the sole control.

### Browse / trust

- `/browse/null` appeared in production traffic and should continue to be traced.
- Unsupported claims `2,400+ families signed up` and `Save €20+ a week` were removed on the branch.
- Stale Lidl five-store claims were removed on the branch.
- Sitemap `DATA_FRESHNESS` is hard-coded and should ultimately reflect verified data freshness rather than a static date.

## Launch-blocker classification

### Blockers before production-readiness sign-off

1. Make repository private and complete secret-history review.
2. Resolve unsafe Supabase public-table access and verify the RLS migration before production application.
3. Resolve planner provider availability or implement a tested graceful fallback.
4. Complete application smoke testing against the current Preview.
5. Reconcile production migration history with repository migrations.
6. Confirm historical Tesco contamination cannot enter live comparisons after the new pipeline/view changes.
7. Add platform-level controls for public email/event abuse surfaces.

### Blockers before replacing EC2 scraping

1. Prove SuperValu, Dunnes and Aldi replacement runs with parity/observability.
2. Prove one Tesco canary from an accepted egress architecture.
3. Wire Tesco egress claiming + block quarantine into the queue consumer.
4. Establish a reviewed cleanup/quarantine plan for contaminated Tesco mappings; do not delete historical data prematurely.
5. Observe at least one full scheduled cycle alongside EC2 and compare results.
6. Obtain explicit approval before disabling EC2.

## Staged deployment path

### Stage A

- clean working branch
- CI green on the same Node runtime as Vercel
- Preview green
- migrations reconciled
- application smoke test
- security fixes prepared and tested

### Stage B

- background workers proven in Preview
- one-product Tesco canary succeeds
- other scraper jobs verified
- ops visibility verified
- contaminated Tesco mappings cannot leak into current recommendations

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
