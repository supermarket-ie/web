# Bounded Tesco product and listing collection

## Cooldown interpretation

The egress-pool migration defines a **48-hour application quarantine**, with a
minimum of 24 hours in the legacy RPC. This is an operating policy, not evidence
of a retailer-defined block lifetime. The prior platform notes do not document
a successful same-IP recovery after 24 hours. Ordinary Vercel egress is not a
fixed IP: elapsed time plus a later success would not establish same-IP recovery.

The collector preserves the 48-hour challenge quarantine. HTTP 401/403 and
challenge pages stop immediately; HTTP 429 stops immediately and respects
`Retry-After`, with a minimum 15-minute pause. Longer retailer retry instructions
extend the pause. No challenge triggers retries, search fallback, cookies,
challenge solving, proxy rotation, or a switch to another pool identity.

The practical improvements are listing pages, a 24-hour request cache, renewal
before the seven-day freshness limit, and persistent diagnostics. If the
deployment path is blocked after a long idle period, a shorter timer is not an
evidenced solution. Stable, retailer-approved access or a bounded provider
fallback is then required for reliable operation.

## Operator controls

`/api/workers/tesco-direct-collect` requires `CRON_SECRET`, the existing
`TESCO_VERCEL_WORKER_ENABLED` flag, and exactly one enabled, available egress gate.
The gate represents the deployment path; its label must not imply a fixed IP
unless that infrastructure is actually configured. The collector neither enables
nor provisions an egress identity. A lease lasts 600 seconds, longer than the
240-second route limit, and covers the complete sequential collection.

Use the existing owner-issue dispatcher:

| Owner issue title | Operation |
| --- | --- |
| `[ops] Tesco direct probe` | At most one product and one milk listing request; no price writes |
| `[ops] Tesco direct products` | At most five distinct due product URLs |
| `[ops] Tesco direct listings` | At most five milk listing pages, following verified pagination |

A block on the first product suppresses the listing request. Results remain
private in `ops_manual_dispatches`, `scrape_runs`, and the RLS-protected
`tesco_direct_collection_pages` table. Dispatcher replay does not execute again.
The authenticated worker also accepts a bounded `query` and up to six `pages`.
No recurring schedule is added by this change.

## Evidence and price rules

- Parse `application/discover+json`, the Irish locale, and the page's exact Apollo
  `ROOT_QUERY` references. Exclude unrelated cached/recommended products.
- Use regular `ProductType.price.actual`. Irish pages can carry incorrect GBP
  JSON-LD; promotions can be conditional or future-dated and are excluded.
- Keep URLs/status, elapsed time, Retry-After, body hash, structured products,
  pagination and identity decisions. Do not retain cookies or raw HTML.
- Refresh existing resolved mappings only after exact SKU, brand, variant, pack,
  formulation and duplicate-canonical checks. Reject prepared meals mapped to
  raw meat ingredients. Listing discoveries do not silently repair mappings.
- Select stale/due prices with a four-day renewal threshold. Paginate mappings,
  fresh-price and demand reads; prior successful paid attempts remain eligible.
- Record accepted observations through the existing idempotent generic finaliser
  with `tesco_direct` provenance. Cached pages never acquire a new observation
  timestamp. Freshness policy remains seven days.

## Validation and rollout

Tests exercise parser scoping, currency/price separation, identity conflicts,
redirects, challenge/429 stop rules and Retry-After. PR #242 passed required CI,
Preview and production deployment verification. The deployed probe was denied
on its first request, stopped before listings, and wrote no prices. Quarantine
and private diagnostics were verified; accepted production access remains absent.

After a clean probe, run one bounded collection and verify page evidence, receipt
idempotency, accepted price identity and trusted freshness before scaling.
On a block, retain the cooldown and report the result; do not describe waiting
24 or 48 hours as a guaranteed fix.
